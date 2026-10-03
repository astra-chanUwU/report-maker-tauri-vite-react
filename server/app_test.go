package controlplane

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func testApp(t *testing.T) (*App, *httptest.Server, ed25519.PrivateKey, string) {
	t.Helper()
	_, device, _ := ed25519.GenerateKey(rand.Reader)
	deliveryKey, _ := LoadDeliveryKey(EncodeBytes(make([]byte, 32)))
	cfg := Config{SigningKeyID: "test-key", LeaseDays: 30, AllowDevSeed: true, PublicBaseURL: "http://example.test", LicenseDeliveryKey: deliveryKey}
	app, err := NewApp(cfg)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(app.Handler())
	t.Cleanup(server.Close)
	app.cfg.PublicBaseURL = server.URL
	app.cfg.Gateway = DemoGateway{BaseURL: server.URL}
	public := EncodeBytes(device.Public().(ed25519.PublicKey))
	return app, server, device, public
}

func TestHealthAndMarketingRoutes(t *testing.T) {
	_, server, _, _ := testApp(t)
	response, err := server.Client().Get(server.URL + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("health status %d", response.StatusCode)
	}
	response, err = server.Client().Get(server.URL + "/pricing")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(response.Body)
	if response.StatusCode != http.StatusOK || !strings.Contains(string(body), "Continue to payment") {
		t.Fatalf("pricing page missing checkout form: status=%d", response.StatusCode)
	}
}

func TestActivationRefreshAndRevoke(t *testing.T) {
	app, server, device, public := testApp(t)
	activationProof := map[string]any{"action": "activate", "license_key_hash": LicenseKeyHash("RM-TEST-1234-KEY0"), "device_public_key": public, "app_version": "0.1.0", "platform": "macos"}
	proof, _ := Sign(device, activationProof)
	body := `{"license_key":"RM-TEST-1234-KEY0","device_public_key":"` + public + `","app_version":"0.1.0","platform":"macos","device_proof":"` + proof + `"}`
	request, _ := http.NewRequest(http.MethodPost, server.URL+"/v1/activations", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Idempotency-Key", "activation-1")
	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("activation status=%d", response.StatusCode)
	}
	var signed signedLeaseResponse
	if err := json.NewDecoder(response.Body).Decode(&signed); err != nil {
		t.Fatal(err)
	}
	if !Verify(app.signingPublic, signed.Lease, signed.Signature) {
		t.Fatal("lease signature did not verify")
	}
	requestedAt := "2026-10-03T00:00:00Z"
	refreshProof, _ := Sign(device, map[string]any{"action": "refresh", "activation_id": signed.ActivationID, "request_id": "refresh-1", "requested_at": requestedAt})
	refreshJSON := `{"device_signature":"` + refreshProof + `","request_id":"refresh-1","requested_at":"` + requestedAt + `"}`
	refreshRequest, _ := http.NewRequest(http.MethodPost, server.URL+"/v1/activations/"+signed.ActivationID+"/refresh", strings.NewReader(refreshJSON))
	refreshRequest.Header.Set("Content-Type", "application/json")
	refreshResponse, err := server.Client().Do(refreshRequest)
	if err != nil {
		t.Fatal(err)
	}
	if refreshResponse.StatusCode != http.StatusOK {
		t.Fatalf("refresh status=%d", refreshResponse.StatusCode)
	}
	refreshResponse.Body.Close()
	revokeProof, _ := Sign(device, map[string]any{"action": "revoke", "activation_id": signed.ActivationID, "request_id": "revoke-1"})
	revokeJSON := `{"device_signature":"` + revokeProof + `","request_id":"revoke-1"}`
	revokeRequest, _ := http.NewRequest(http.MethodDelete, server.URL+"/v1/activations/"+signed.ActivationID, strings.NewReader(revokeJSON))
	revokeRequest.Header.Set("Content-Type", "application/json")
	revokeResponse, err := server.Client().Do(revokeRequest)
	if err != nil {
		t.Fatal(err)
	}
	if revokeResponse.StatusCode != http.StatusNoContent {
		t.Fatalf("revoke status=%d", revokeResponse.StatusCode)
	}
	revokeResponse.Body.Close()
}

func TestPaymentRedirectCallbackIsIdempotent(t *testing.T) {
	_, server, _, _ := testApp(t)
	client := server.Client()
	csrf, csrfCookies := fetchCSRF(t, client, server.URL)
	form := url.Values{"plan": {"perpetual"}, "first_name": {"Customer"}, "last_name": {"Example"}, "email": {"customer@example.com"}, "phone": {"09120000000"}, "csrf_token": {csrf}}
	request, _ := http.NewRequest(http.MethodPost, server.URL+"/checkout/start", strings.NewReader(form.Encode()))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	for _, c := range csrfCookies {
		request.AddCookie(c)
	}
	noRedirect := *client
	noRedirect.CheckRedirect = func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }
	response, err := noRedirect.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusSeeOther {
		t.Fatalf("checkout status=%d", response.StatusCode)
	}
	location := response.Header.Get("Location")
	if location == "" {
		t.Fatal("checkout did not redirect")
	}
	redirected, err := noRedirect.Get(location)
	if err != nil {
		t.Fatal(err)
	}
	callbackLocation := redirected.Header.Get("Location")
	redirected.Body.Close()
	if callbackLocation == "" {
		t.Fatal("gateway redirect did not produce callback")
	}
	callback, err := noRedirect.Get(server.URL + callbackLocation)
	if err != nil {
		t.Fatal(err)
	}
	defer callback.Body.Close()
	body, _ := io.ReadAll(callback.Body)
	if !strings.Contains(string(body), "Payment received") || !strings.Contains(string(body), "RM-") {
		t.Fatalf("callback did not complete payment with license: %s", body)
	}
}

func TestNormalizePhone(t *testing.T) {
	for input, want := range map[string]string{
		"0912 000 0000":  "09120000000",
		"+989120000000":  "09120000000",
		"00989120000000": "09120000000",
		"9120000000":     "09120000000",
		"02112345678":    "",
	} {
		got := normalizePhone(input)
		if want == "" {
			if got != "" {
				t.Fatalf("normalizePhone(%q) = %q, want empty", input, got)
			}
			continue
		}
		if got != want {
			t.Fatalf("normalizePhone(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestCustomerMagicLinkAndPasswordAuth(t *testing.T) {
	app, server, _, _ := testApp(t)
	now := time.Now().UTC()
	if err := app.store.PutCustomer(&Customer{ID: "cus_auth", FirstName: "Auth", LastName: "Example", Email: "auth@example.com", Phone: "09120000000", CreatedAt: now, UpdatedAt: now}); err != nil {
		t.Fatal(err)
	}

	client := server.Client()
	csrf, csrfCookies := fetchCSRF(t, client, server.URL)
	form := url.Values{"email": {"auth@example.com"}, "csrf_token": {csrf}}
	request, _ := http.NewRequest(http.MethodPost, server.URL+"/auth/magic-link/request", strings.NewReader(form.Encode()))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	for _, c := range csrfCookies {
		request.AddCookie(c)
	}
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusAccepted {
		t.Fatalf("magic-link request status=%d", response.StatusCode)
	}
	magicLink := response.Header.Get("X-Dev-Magic-Link")
	response.Body.Close()
	if magicLink == "" {
		t.Fatal("development magic-link header missing")
	}

	noRedirect := *server.Client()
	noRedirect.CheckRedirect = func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }
	response, err = noRedirect.Get(magicLink)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusSeeOther || response.Header.Get("Set-Cookie") == "" {
		t.Fatalf("magic-link consume status=%d cookie=%q", response.StatusCode, response.Header.Get("Set-Cookie"))
	}
	cookie := response.Cookies()[0]
	response.Body.Close()

	passwordRequest, _ := http.NewRequest(http.MethodPost, server.URL+"/auth/password/set", strings.NewReader(`{"password":"a-long-development-password"}`))
	passwordRequest.Header.Set("Content-Type", "application/json")
	passwordRequest.Header.Set("X-CSRF-Token", csrf)
	passwordRequest.AddCookie(cookie)
	for _, c := range csrfCookies {
		if c.Name == csrfCookieName {
			passwordRequest.AddCookie(c)
		}
	}
	passwordResponse, err := noRedirect.Do(passwordRequest)
	if err != nil {
		t.Fatal(err)
	}
	if passwordResponse.StatusCode != http.StatusOK {
		t.Fatalf("password set status=%d", passwordResponse.StatusCode)
	}
	passwordResponse.Body.Close()

	loginRequest, _ := http.NewRequest(http.MethodPost, server.URL+"/auth/password/login", strings.NewReader(`{"email":"auth@example.com","password":"a-long-development-password"}`))
	loginRequest.Header.Set("Content-Type", "application/json")
	loginRequest.Header.Set("X-CSRF-Token", csrf)
	for _, c := range csrfCookies {
		if c.Name == csrfCookieName {
			loginRequest.AddCookie(c)
		}
	}
	loginResponse, err := noRedirect.Do(loginRequest)
	if err != nil {
		t.Fatal(err)
	}
	if loginResponse.StatusCode != http.StatusOK || len(loginResponse.Cookies()) == 0 {
		t.Fatalf("password login status=%d cookies=%d", loginResponse.StatusCode, len(loginResponse.Cookies()))
	}
	loginResponse.Body.Close()
}
