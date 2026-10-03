package controlplane

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func plainLicenseForOrder(t *testing.T, app *App, orderID string) string {
	t.Helper()
	order, ok := app.store.GetOrder(orderID)
	if !ok || order.LicenseID == "" {
		t.Fatalf("order %s missing license", orderID)
	}
	license, ok := app.store.FindLicenseByID(order.LicenseID)
	if !ok || license.DeliveryCiphertext == "" {
		t.Fatalf("license missing for order %s", orderID)
	}
	plain, err := DecryptLicenseKey(app.cfg.LicenseDeliveryKey, license.DeliveryCiphertext)
	if err != nil {
		t.Fatal(err)
	}
	return plain
}

func sessionCookieForCustomer(t *testing.T, app *App, customerID string) *http.Cookie {
	t.Helper()
	token, err := randomToken(32)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	if err := app.store.PutCustomerSession(&CustomerSession{
		ID: randomID("ses_"), CustomerID: customerID, TokenHash: hashToken(token),
		ExpiresAt: now.Add(time.Hour), CreatedAt: now, LastSeenAt: now,
	}); err != nil {
		t.Fatal(err)
	}
	return &http.Cookie{Name: customerSessionCookie, Value: token}
}

func completeDemoCheckoutURL(t *testing.T, server *httptest.Server) (orderID, callbackURL string, firstBody string) {
	t.Helper()
	client := server.Client()
	csrf, csrfCookies := fetchCSRF(t, client, server.URL)
	form := url.Values{
		"plan": {"perpetual"}, "first_name": {"Customer"}, "last_name": {"Example"},
		"email": {"customer@example.com"}, "phone": {"09120000000"}, "csrf_token": {csrf},
	}
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
	redirected, err := noRedirect.Get(response.Header.Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	callbackLocation := redirected.Header.Get("Location")
	redirected.Body.Close()
	if callbackLocation == "" {
		t.Fatal("missing callback redirect")
	}
	callbackURL = server.URL + callbackLocation
	callback, err := noRedirect.Get(callbackURL)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(callback.Body)
	callback.Body.Close()
	firstBody = string(body)
	parsed, _ := url.Parse(callbackURL)
	orderID = parsed.Query().Get("order")
	if orderID == "" {
		t.Fatal("missing order id in callback")
	}
	return orderID, callbackURL, firstBody
}

func assertBodyHidesFullKey(t *testing.T, body, plain string) {
	t.Helper()
	if plain == "" || !strings.HasPrefix(plain, "RM-") {
		t.Fatalf("unexpected plaintext key %q", plain)
	}
	if strings.Contains(body, plain) {
		t.Fatalf("response leaked full license key %q", plain)
	}
	masked := MaskLicenseKey(plain)
	if !strings.Contains(body, masked) {
		t.Fatalf("response missing masked key %q; body=%s", masked, body)
	}
}

func TestUnauthenticatedCallbackDoesNotRevealFullKey(t *testing.T) {
	app, server := testAppWithGateway(t, DemoGateway{})
	orderID, callbackURL, firstBody := completeDemoCheckoutURL(t, server)
	plain := plainLicenseForOrder(t, app, orderID)

	if !strings.Contains(firstBody, "Payment received") {
		t.Fatalf("first callback missing success: %s", firstBody)
	}
	assertBodyHidesFullKey(t, firstBody, plain)

	retry, err := server.Client().Get(callbackURL)
	if err != nil {
		t.Fatal(err)
	}
	retryBody, _ := io.ReadAll(retry.Body)
	retry.Body.Close()
	assertBodyHidesFullKey(t, string(retryBody), plain)

	status, err := server.Client().Get(server.URL + "/checkout/status?order=" + url.QueryEscape(orderID))
	if err != nil {
		t.Fatal(err)
	}
	statusBody, _ := io.ReadAll(status.Body)
	status.Body.Close()
	assertBodyHidesFullKey(t, string(statusBody), plain)
}

func TestOwningCustomerCanRevealLicenseAfterSignIn(t *testing.T) {
	app, server := testAppWithGateway(t, DemoGateway{})
	orderID, _, _ := completeDemoCheckoutURL(t, server)
	order, ok := app.store.GetOrder(orderID)
	if !ok {
		t.Fatal("order missing")
	}
	plain := plainLicenseForOrder(t, app, orderID)
	cookie := sessionCookieForCustomer(t, app, order.CustomerID)

	csrf, csrfCookies := fetchCSRF(t, server.Client(), server.URL)
	form := url.Values{"order_id": {orderID}, "csrf_token": {csrf}}
	req, _ := http.NewRequest(http.MethodPost, server.URL+"/account/purchases/reveal", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	req.AddCookie(cookie)
	for _, c := range csrfCookies {
		req.AddCookie(c)
	}
	resp, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("reveal status=%d body=%s", resp.StatusCode, body)
	}
	if !strings.Contains(string(body), plain) {
		t.Fatalf("owner reveal missing plaintext key; body=%s", body)
	}

	statusReq, _ := http.NewRequest(http.MethodGet, server.URL+"/checkout/status?order="+url.QueryEscape(orderID), nil)
	statusReq.AddCookie(cookie)
	statusResp, err := server.Client().Do(statusReq)
	if err != nil {
		t.Fatal(err)
	}
	statusBody, _ := io.ReadAll(statusResp.Body)
	statusResp.Body.Close()
	if !strings.Contains(string(statusBody), plain) {
		t.Fatalf("owner status page missing plaintext; body=%s", statusBody)
	}
}

func TestOtherCustomerCannotRevealLicense(t *testing.T) {
	app, server := testAppWithGateway(t, DemoGateway{})
	orderID, _, _ := completeDemoCheckoutURL(t, server)
	plain := plainLicenseForOrder(t, app, orderID)

	now := time.Now().UTC()
	otherID := "cus_other_disclosure"
	if err := app.store.PutCustomer(&Customer{
		ID: otherID, FirstName: "Other", LastName: "Buyer", Email: "other@example.com",
		Phone: "09129999999", CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatal(err)
	}
	cookie := sessionCookieForCustomer(t, app, otherID)

	csrf, csrfCookies := fetchCSRF(t, server.Client(), server.URL)
	form := url.Values{"order_id": {orderID}, "csrf_token": {csrf}}
	req, _ := http.NewRequest(http.MethodPost, server.URL+"/account/purchases/reveal", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	req.AddCookie(cookie)
	for _, c := range csrfCookies {
		req.AddCookie(c)
	}
	resp, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode == http.StatusOK {
		t.Fatalf("other customer must not reveal license; body=%s", body)
	}
	if strings.Contains(string(body), plain) {
		t.Fatalf("other customer response leaked key; body=%s", body)
	}

	statusReq, _ := http.NewRequest(http.MethodGet, server.URL+"/checkout/status?order="+url.QueryEscape(orderID), nil)
	statusReq.AddCookie(cookie)
	statusResp, err := server.Client().Do(statusReq)
	if err != nil {
		t.Fatal(err)
	}
	statusBody, _ := io.ReadAll(statusResp.Body)
	statusResp.Body.Close()
	assertBodyHidesFullKey(t, string(statusBody), plain)
}

func TestLicenseAccessEmailUsesMaskedKeyOnly(t *testing.T) {
	outbox := &LocalOutbox{}
	cfg := Config{
		SigningKeyID: "test-key", LeaseDays: 30, AllowDevSeed: false,
		PublicBaseURL: "http://example.test", LicenseDeliveryKey: testDeliveryKey(t),
		Gateway: DemoGateway{}, EmailSender: outbox,
	}
	app, err := NewApp(cfg)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(app.Handler())
	t.Cleanup(server.Close)
	app.cfg.PublicBaseURL = server.URL
	if demo, ok := app.cfg.Gateway.(DemoGateway); ok {
		demo.BaseURL = server.URL
		app.cfg.Gateway = demo
	}

	orderID, _, _ := completeDemoCheckoutURL(t, server)
	plain := plainLicenseForOrder(t, app, orderID)
	messages := outbox.Snapshot()
	if len(messages) == 0 {
		t.Fatal("expected license access email in outbox")
	}
	var licenseMail *EmailMessage
	for i := range messages {
		if messages[i].Kind == EmailKindLicenseAccess {
			licenseMail = &messages[i]
			break
		}
	}
	if licenseMail == nil {
		t.Fatalf("missing license_access mail; got %#v", messages)
	}
	if strings.Contains(licenseMail.Body, plain) {
		t.Fatalf("license email contained plaintext key: %s", licenseMail.Body)
	}
	if !strings.Contains(licenseMail.Body, MaskLicenseKey(plain)) {
		t.Fatalf("license email missing masked hint: %s", licenseMail.Body)
	}
	if strings.Contains(licenseMail.Body, "license_key=") || strings.Contains(licenseMail.Body, plain) {
		t.Fatalf("license email must not embed secrets in URLs: %s", licenseMail.Body)
	}
	if !strings.Contains(licenseMail.Body, "/account/purchases") {
		t.Fatalf("license email missing account purchases link: %s", licenseMail.Body)
	}
}
