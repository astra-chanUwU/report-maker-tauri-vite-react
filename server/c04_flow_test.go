package controlplane

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// C04 end-to-end flow suite (authoritative package for feat/c04-e2e-flow-tests).
//
// Covers checkout → payment → one license → LocalOutbox → magic-link session →
// entitled repeat download, plus ZarinPal 100/101, retries, cancel/mismatch,
// email outage recoverability, expired-link renewal, anonymous key masking,
// and privacy redaction. Helpers are c04*-prefixed to avoid colliding with
// C02/C03 test helpers.

func c04FlowApp(t *testing.T, gateway PaymentGateway) (*App, *httptest.Server, *LocalOutbox, string) {
	t.Helper()
	root := t.TempDir()
	payload := []byte("report-maker-c04-artifact")
	sum := sha256.Sum256(payload)
	checksum := hex.EncodeToString(sum[:])
	artifactPath := filepath.Join(root, "windows-x64", "ReportMaker_1.0.0_x64-setup.exe")
	if err := os.MkdirAll(filepath.Dir(artifactPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(artifactPath, payload, 0o644); err != nil {
		t.Fatal(err)
	}
	manifest := filepath.Join(root, "releases-c04.json")
	manifestBody := `[{"id":"desktop-windows-x64","version":"1.0.0","filename":"ReportMaker_1.0.0_x64-setup.exe","sha256":"` + checksum + `","relative_path":"windows-x64/ReportMaker_1.0.0_x64-setup.exe","platform":"Windows x64","description":"C04 test build"}]`
	if err := os.WriteFile(manifest, []byte(manifestBody), 0o644); err != nil {
		t.Fatal(err)
	}

	outbox := &LocalOutbox{}
	deliveryKey := testDeliveryKey(t)
	cfg := Config{
		SigningKeyID: "test-key", LeaseDays: 30, AllowDevSeed: false,
		PublicBaseURL: "http://example.test", LicenseDeliveryKey: deliveryKey,
		ArtifactRoot: root, ReleaseManifest: manifest,
		DownloadLinkTTLHours: 24, DownloadRateLimit: 100,
		EmailSender: outbox, SMSSender: &FakeSMS{},
		Gateway: gateway,
	}
	app, err := NewApp(cfg)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(app.Handler())
	t.Cleanup(server.Close)
	t.Cleanup(func() { _ = app.Close() })
	app.cfg.PublicBaseURL = server.URL
	if demo, ok := gateway.(DemoGateway); ok {
		demo.BaseURL = server.URL
		app.cfg.Gateway = demo
	} else if gateway == nil {
		app.cfg.Gateway = DemoGateway{BaseURL: server.URL}
	} else {
		app.cfg.Gateway = gateway
	}
	return app, server, outbox, checksum
}

func c04CheckoutForm(email, phone, first, last string) url.Values {
	return url.Values{
		"plan": {"perpetual"}, "first_name": {first}, "last_name": {last},
		"email": {email}, "phone": {phone},
	}
}

// c04StartCheckout posts /checkout/start with CSRF and returns the gateway redirect Location.
func c04StartCheckout(t *testing.T, server *httptest.Server, form url.Values) string {
	t.Helper()
	client := server.Client()
	csrf, csrfCookies := fetchCSRF(t, client, server.URL)
	form.Set("csrf_token", csrf)
	req, _ := http.NewRequest(http.MethodPost, server.URL+"/checkout/start", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	for _, c := range csrfCookies {
		req.AddCookie(c)
	}
	noRedirect := *client
	noRedirect.CheckRedirect = func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }
	resp, err := noRedirect.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusSeeOther {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("checkout status=%d body=%s", resp.StatusCode, body)
	}
	location := resp.Header.Get("Location")
	if location == "" {
		t.Fatal("checkout missing redirect Location")
	}
	return location
}

// c04CompleteDemoCheckout runs checkout → demo redirect → callback OK.
func c04CompleteDemoCheckout(t *testing.T, server *httptest.Server, form url.Values) (orderID, callbackURL, body string) {
	t.Helper()
	location := c04StartCheckout(t, server, form)
	noRedirect := *server.Client()
	noRedirect.CheckRedirect = func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }
	redirected, err := noRedirect.Get(location)
	if err != nil {
		t.Fatal(err)
	}
	callbackLocation := redirected.Header.Get("Location")
	redirected.Body.Close()
	if callbackLocation == "" {
		t.Fatal("demo gateway missing callback redirect")
	}
	callbackURL = server.URL + callbackLocation
	callback, err := noRedirect.Get(callbackURL)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := io.ReadAll(callback.Body)
	callback.Body.Close()
	body = string(raw)
	if !strings.Contains(body, "Payment received") {
		t.Fatalf("callback missing success: %s", body)
	}
	parsed, _ := url.Parse(callbackURL)
	orderID = parsed.Query().Get("order")
	if orderID == "" {
		t.Fatal("missing order id in callback")
	}
	return orderID, callbackURL, body
}

func c04PlainLicense(t *testing.T, app *App, orderID string) string {
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

func c04SessionCookie(t *testing.T, app *App, customerID string) *http.Cookie {
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

// c04SignInViaMagicLink requests a magic link (CSRF required) and returns a jar client with session.
func c04SignInViaMagicLink(t *testing.T, app *App, server *httptest.Server, outbox *LocalOutbox, email string) *http.Client {
	t.Helper()
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	client := &http.Client{Jar: jar}
	csrf, cookies := fetchCSRF(t, client, server.URL)
	before := len(outbox.Snapshot())
	form := url.Values{"email": {email}, "csrf_token": {csrf}}
	req, _ := http.NewRequest(http.MethodPost, server.URL+"/auth/magic-link/request", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	for _, c := range cookies {
		req.AddCookie(c)
	}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusAccepted {
		t.Fatalf("magic-link request status=%d", resp.StatusCode)
	}

	msgs := outbox.Snapshot()
	var linkBody string
	for i := len(msgs) - 1; i >= before; i-- {
		if msgs[i].Kind == EmailKindMagicLink {
			linkBody = msgs[i].Body
			break
		}
	}
	if linkBody == "" {
		t.Fatal("magic_link message missing from outbox")
	}
	const marker = "/auth/magic-link/consume?token="
	start := strings.LastIndex(linkBody, marker)
	if start < 0 {
		t.Fatalf("magic link URL missing: %q", linkBody)
	}
	token := strings.TrimSpace(linkBody[start+len(marker):])
	if i := strings.IndexAny(token, " \n\r\t\"'"); i >= 0 {
		token = token[:i]
	}
	noRedirect := *client
	noRedirect.CheckRedirect = func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }
	consume, err := noRedirect.Get(server.URL + marker + url.QueryEscape(token))
	if err != nil {
		t.Fatal(err)
	}
	consume.Body.Close()
	if consume.StatusCode != http.StatusSeeOther {
		t.Fatalf("magic-link consume status=%d", consume.StatusCode)
	}
	parsed, _ := url.Parse(server.URL)
	jar.SetCookies(parsed, consume.Cookies())
	return client
}

func c04OutboxByKind(msgs []EmailMessage) map[string]EmailMessage {
	byKind := map[string]EmailMessage{}
	for _, m := range msgs {
		byKind[m.Kind] = m
	}
	return byKind
}

// c04AssertAnonymousMask requires C03 masked disclosure on anonymous HTML.
func c04AssertAnonymousMask(t *testing.T, body, plain string) {
	t.Helper()
	if plain == "" || !strings.HasPrefix(plain, "RM-") {
		t.Fatalf("unexpected plaintext key %q", plain)
	}
	if strings.Contains(body, plain) {
		t.Fatalf("anonymous response leaked full license key %q", plain)
	}
	masked := MaskLicenseKey(plain)
	if !strings.Contains(body, masked) {
		t.Fatalf("response missing masked key %q; body=%s", masked, body)
	}
}

// c04AssertDurableCustomer requires C02 EnsureCheckoutCustomer reuse across orders.
func c04AssertDurableCustomer(t *testing.T, app *App, orderID1, orderID2 string) {
	t.Helper()
	o1, ok1 := app.store.GetOrder(orderID1)
	o2, ok2 := app.store.GetOrder(orderID2)
	if !ok1 || !ok2 || o1.CustomerID == "" || o2.CustomerID == "" {
		t.Fatalf("orders missing customer link: %#v %#v", o1, o2)
	}
	if o1.CustomerID != o2.CustomerID {
		t.Fatalf("expected durable customer_id across checkouts; got %q vs %q", o1.CustomerID, o2.CustomerID)
	}
}

func TestC04FullDemoFlowCheckoutToRepeatDownload(t *testing.T) {
	app, server, outbox, checksum := c04FlowApp(t, DemoGateway{})
	email := "c04-full@example.com"
	orderID, _, body := c04CompleteDemoCheckout(t, server, c04CheckoutForm(email, "09120000010", "C04", "Buyer"))

	if app.store.CountProvisionedLicenses() != 1 {
		t.Fatalf("license count = %d, want 1", app.store.CountProvisionedLicenses())
	}
	if app.store.CountLicensesForOrder(orderID) != 1 {
		t.Fatalf("order license count = %d, want 1", app.store.CountLicensesForOrder(orderID))
	}
	order, ok := app.store.GetOrder(orderID)
	if !ok || order.Status != "paid" || order.LicenseID == "" || order.CustomerID == "" {
		t.Fatalf("order not fulfilled with durable customer_id: %#v", order)
	}
	if !strings.Contains(body, "Payment received") {
		t.Fatalf("callback body missing success: %s", body)
	}

	msgs := outbox.Snapshot()
	byKind := c04OutboxByKind(msgs)
	receipt, ok := byKind[EmailKindReceipt]
	if !ok || receipt.OrderID != orderID || receipt.To != email {
		t.Fatalf("receipt missing/wrong: %#v msgs=%#v", receipt, msgs)
	}
	if licenseMail, ok := byKind[EmailKindLicenseAccess]; ok {
		if licenseMail.OrderID != orderID || licenseMail.LicenseID == "" {
			t.Fatalf("license_access email incomplete: %#v", licenseMail)
		}
		plain := c04PlainLicense(t, app, orderID)
		if strings.Contains(licenseMail.Body, plain) {
			t.Fatalf("license_access email leaked plaintext key")
		}
	} else {
		t.Fatalf("license_access email not wired; outbox=%#v", msgs)
	}

	client := c04SignInViaMagicLink(t, app, server, outbox, email)
	purchases, err := client.Get(server.URL + "/account/purchases")
	if err != nil {
		t.Fatal(err)
	}
	purchBody, _ := io.ReadAll(purchases.Body)
	purchases.Body.Close()
	if purchases.StatusCode != http.StatusOK || !strings.Contains(string(purchBody), orderID) {
		t.Fatalf("purchases page missing order: status=%d body=%s", purchases.StatusCode, purchBody)
	}

	for i := 0; i < 2; i++ {
		resp, err := client.Get(server.URL + "/downloads/desktop-windows-x64")
		if err != nil {
			t.Fatal(err)
		}
		dl, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("download %d status=%d body=%q", i, resp.StatusCode, dl)
		}
		if got := sha256.Sum256(dl); hex.EncodeToString(got[:]) != checksum {
			t.Fatalf("download %d checksum mismatch", i)
		}
	}
}

func TestC04ZarinPal100And101StillOneLicense(t *testing.T) {
	t.Run("code100", func(t *testing.T) {
		var verifyCount int
		provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			switch r.URL.Path {
			case "/pg/v4/payment/request.json":
				_, _ = w.Write([]byte(`{"data":{"code":100,"authority":"A-c04-100"},"errors":[]}`))
			case "/pg/v4/payment/verify.json":
				verifyCount++
				_, _ = w.Write([]byte(`{"data":{"code":100,"ref_id":100100},"errors":[]}`))
			default:
				http.NotFound(w, r)
			}
		}))
		t.Cleanup(provider.Close)

		gateway := ZarinPalGateway{MerchantID: "merchant-c04", BaseURL: provider.URL, Client: provider.Client()}
		app, server, outbox, _ := c04FlowApp(t, gateway)
		orderID := checkoutWithGateway(t, app, server, gateway.Name())
		if app.store.CountProvisionedLicenses() != 1 {
			t.Fatalf("license count = %d, want 1", app.store.CountProvisionedLicenses())
		}
		order, ok := app.store.GetOrder(orderID)
		if !ok || order.PaymentRef != "100100" || order.LicenseID == "" {
			t.Fatalf("unexpected order: %#v", order)
		}
		if verifyCount != 1 {
			t.Fatalf("verify calls = %d, want 1", verifyCount)
		}
		if _, ok := c04OutboxByKind(outbox.Snapshot())[EmailKindReceipt]; !ok {
			t.Fatalf("expected receipt after zarinpal 100: %#v", outbox.Snapshot())
		}
	})

	t.Run("code101_idempotent", func(t *testing.T) {
		var verifyCount int
		provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			switch r.URL.Path {
			case "/pg/v4/payment/request.json":
				_, _ = w.Write([]byte(`{"data":{"code":100,"authority":"A-c04-101"},"errors":[]}`))
			case "/pg/v4/payment/verify.json":
				verifyCount++
				_, _ = w.Write([]byte(`{"data":{"code":101,"ref_id":"already-c04"},"errors":[]}`))
			default:
				http.NotFound(w, r)
			}
		}))
		t.Cleanup(provider.Close)

		gateway := ZarinPalGateway{MerchantID: "merchant-c04", BaseURL: provider.URL, Client: provider.Client()}
		app, server, _, _ := c04FlowApp(t, gateway)
		orderID := startZarinPalPendingOrder(t, app, server, gateway)
		callbackURL := buildCallbackURL(t, app, server, orderID, gateway.Name())
		for i := 0; i < 2; i++ {
			resp, err := server.Client().Get(callbackURL)
			if err != nil {
				t.Fatal(err)
			}
			resp.Body.Close()
		}
		if app.store.CountProvisionedLicenses() != 1 {
			t.Fatalf("license count = %d, want 1", app.store.CountProvisionedLicenses())
		}
		if app.store.CountLicensesForOrder(orderID) != 1 {
			t.Fatalf("order licenses = %d, want 1", app.store.CountLicensesForOrder(orderID))
		}
		if verifyCount != 2 {
			t.Fatalf("verify calls = %d, want 2", verifyCount)
		}
	})
}

func TestC04CallbackRetryIdempotent(t *testing.T) {
	app, server, outbox, _ := c04FlowApp(t, DemoGateway{})
	orderID, callbackURL, _ := c04CompleteDemoCheckout(t, server, c04CheckoutForm("c04-retry@example.com", "09120000011", "Retry", "Buyer"))
	second, err := server.Client().Get(callbackURL)
	if err != nil {
		t.Fatal(err)
	}
	second.Body.Close()
	if app.store.CountProvisionedLicenses() != 1 {
		t.Fatalf("license count after retry = %d, want 1", app.store.CountProvisionedLicenses())
	}
	if app.store.CountLicensesForOrder(orderID) != 1 {
		t.Fatalf("order licenses after retry = %d, want 1", app.store.CountLicensesForOrder(orderID))
	}
	receipts := 0
	for _, m := range outbox.Snapshot() {
		if m.Kind == EmailKindReceipt && m.OrderID == orderID {
			receipts++
		}
	}
	if receipts != 1 {
		t.Fatalf("receipt emails = %d, want 1 (LocalOutbox idempotency)", receipts)
	}
}

func TestC04CancelledAndMismatchedCallbackZeroLicenses(t *testing.T) {
	t.Run("cancelled", func(t *testing.T) {
		app, server, _, _ := c04FlowApp(t, DemoGateway{})
		location := c04StartCheckout(t, server, c04CheckoutForm("c04-cancel@example.com", "09120000012", "Cancel", "Buyer"))
		parsed, _ := url.Parse(location)
		orderID := parsed.Query().Get("order")
		if orderID == "" {
			if order, ok := app.store.FindOrderByAuthority(parsed.Query().Get("authority")); ok {
				orderID = order.ID
			}
		}
		if orderID == "" {
			t.Fatal("could not resolve pending order")
		}
		order, _ := app.store.GetOrder(orderID)
		callback := server.URL + "/payments/demo-domestic/callback?authority=" + url.QueryEscape(order.Authority) + "&order=" + url.QueryEscape(orderID) + "&status=CANCELLED"
		resp, err := server.Client().Get(callback)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if app.store.CountProvisionedLicenses() != 0 {
			t.Fatalf("license count = %d, want 0", app.store.CountProvisionedLicenses())
		}
		paid, ok := app.store.GetOrder(orderID)
		if !ok || paid.Status == "paid" {
			t.Fatalf("cancelled order must not be paid: %#v", paid)
		}
	})

	t.Run("mismatched", func(t *testing.T) {
		app, server, _, _ := c04FlowApp(t, DemoGateway{})
		resp, err := server.Client().Get(server.URL + "/payments/demo-domestic/callback?authority=unknown&order=ord_missing&status=OK")
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if app.store.CountProvisionedLicenses() != 0 {
			t.Fatalf("license count = %d, want 0", app.store.CountProvisionedLicenses())
		}
	})
}

func TestC04ProviderOutageAfterFulfillRemainsRecoverable(t *testing.T) {
	failing := &failingEmailSender{err: errors.New("smtp timeout")}
	deliveryKey := testDeliveryKey(t)
	cfg := Config{
		SigningKeyID: "test-key", LeaseDays: 30, AllowDevSeed: false,
		PublicBaseURL: "http://example.test", LicenseDeliveryKey: deliveryKey,
		EmailSender: failing, SMSSender: &FakeSMS{},
	}
	app, err := NewApp(cfg)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(app.Handler())
	t.Cleanup(server.Close)
	t.Cleanup(func() { _ = app.Close() })
	app.cfg.PublicBaseURL = server.URL
	app.cfg.Gateway = DemoGateway{BaseURL: server.URL}

	order := seedPendingOrder(t, app, "ord_c04_outage", "cus_c04_outage", "c04-outage@example.com")
	resp, err := server.Client().Get(server.URL + "/payments/demo-domestic/callback?authority=" + url.QueryEscape(order.Authority) + "&order=" + order.ID + "&status=OK")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("callback status=%d", resp.StatusCode)
	}

	paid, ok := app.store.GetOrder(order.ID)
	if !ok || paid.Status != "paid" || paid.PaymentRef == "" {
		t.Fatalf("order must remain recoverable as paid after email outage: %#v ok=%v", paid, ok)
	}
	if paid.LicenseID == "" || app.store.CountLicensesForOrder(order.ID) != 1 {
		t.Fatalf("fulfill must commit license before notify; order=%#v licenses=%d", paid, app.store.CountLicensesForOrder(order.ID))
	}
	if failing.calls.Load() < 1 {
		t.Fatal("expected email send attempt")
	}
}

func TestC04ExpiredDownloadLinkRenewAfterAuth(t *testing.T) {
	app, server, outbox, checksum := c04FlowApp(t, DemoGateway{})
	email := "c04-renew@example.com"
	orderID, _, _ := c04CompleteDemoCheckout(t, server, c04CheckoutForm(email, "09120000013", "Renew", "Buyer"))
	order, ok := app.store.GetOrder(orderID)
	if !ok {
		t.Fatal("order missing")
	}
	client := c04SignInViaMagicLink(t, app, server, outbox, email)

	entitlement, ok := app.store.CustomerDownloadEntitlement(order.CustomerID)
	if !ok {
		t.Fatal("expected download entitlement after paid order")
	}
	expiredToken, _, err := app.issueDownloadToken(order.CustomerID, "desktop-windows-x64", entitlement.OrderID, entitlement.LicenseID, -time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	expiredResp, err := server.Client().Get(server.URL + "/downloads/link/" + expiredToken)
	if err != nil {
		t.Fatal(err)
	}
	expiredResp.Body.Close()
	if expiredResp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expired token status=%d, want 401", expiredResp.StatusCode)
	}

	pageResp, err := client.Get(server.URL + "/account/downloads")
	if err != nil {
		t.Fatal(err)
	}
	pageBody, _ := io.ReadAll(pageResp.Body)
	pageResp.Body.Close()
	if pageResp.StatusCode != http.StatusOK || !strings.Contains(string(pageBody), "/downloads/link/") {
		t.Fatalf("downloads page missing renewed link: status=%d body=%s", pageResp.StatusCode, pageBody)
	}

	dlResp, err := client.Get(server.URL + "/downloads/desktop-windows-x64")
	if err != nil {
		t.Fatal(err)
	}
	dlBody, _ := io.ReadAll(dlResp.Body)
	dlResp.Body.Close()
	if dlResp.StatusCode != http.StatusOK {
		t.Fatalf("authenticated download status=%d", dlResp.StatusCode)
	}
	if got := sha256.Sum256(dlBody); hex.EncodeToString(got[:]) != checksum {
		t.Fatal("download checksum mismatch after renew")
	}
}

func TestC04UnauthenticatedStatusAndCallbackHideFullKey(t *testing.T) {
	app, server, _, _ := c04FlowApp(t, DemoGateway{})
	orderID, callbackURL, firstBody := c04CompleteDemoCheckout(t, server, c04CheckoutForm("c04-mask@example.com", "09120000014", "Mask", "Buyer"))
	plain := c04PlainLicense(t, app, orderID)
	masked := MaskLicenseKey(plain)

	t.Run("status_anonymous_masked", func(t *testing.T) {
		status, err := server.Client().Get(server.URL + "/checkout/status?order=" + url.QueryEscape(orderID))
		if err != nil {
			t.Fatal(err)
		}
		statusBody, _ := io.ReadAll(status.Body)
		status.Body.Close()
		if strings.Contains(string(statusBody), plain) {
			t.Fatalf("unauthenticated status page leaked full key %q", plain)
		}
		if !strings.Contains(string(statusBody), masked) {
			t.Fatalf("status page missing masked key %q; body=%s", masked, statusBody)
		}
	})

	t.Run("status_owner_can_reveal", func(t *testing.T) {
		order, _ := app.store.GetOrder(orderID)
		cookie := c04SessionCookie(t, app, order.CustomerID)
		ownedReq, _ := http.NewRequest(http.MethodGet, server.URL+"/checkout/status?order="+url.QueryEscape(orderID), nil)
		ownedReq.AddCookie(cookie)
		ownedResp, err := server.Client().Do(ownedReq)
		if err != nil {
			t.Fatal(err)
		}
		ownedBody, _ := io.ReadAll(ownedResp.Body)
		ownedResp.Body.Close()
		if !strings.Contains(string(ownedBody), plain) {
			t.Fatalf("owning session status should reveal full key; body=%s", ownedBody)
		}
	})

	t.Run("callback_anonymous_masked", func(t *testing.T) {
		c04AssertAnonymousMask(t, firstBody, plain)
		retry, err := server.Client().Get(callbackURL)
		if err != nil {
			t.Fatal(err)
		}
		retryBody, _ := io.ReadAll(retry.Body)
		retry.Body.Close()
		c04AssertAnonymousMask(t, string(retryBody), plain)
	})
}

func TestC04PrivacyOutboxAndLogsRedactSecrets(t *testing.T) {
	app, server, outbox, _ := c04FlowApp(t, DemoGateway{})
	email := "c04-privacy@example.com"
	orderID, _, _ := c04CompleteDemoCheckout(t, server, c04CheckoutForm(email, "09120000015", "Privacy", "Buyer"))
	plain := c04PlainLicense(t, app, orderID)

	t.Run("purchase_outbox_no_full_key", func(t *testing.T) {
		for _, msg := range outbox.Snapshot() {
			switch msg.Kind {
			case EmailKindReceipt, EmailKindLicenseAccess, EmailKindDownloadAccess:
				if strings.Contains(msg.Body, plain) {
					t.Fatalf("%s outbox leaked full license key", msg.Kind)
				}
			}
			if msg.Kind == EmailKindLicenseAccess {
				if !strings.Contains(msg.Body, MaskLicenseKey(plain)) {
					t.Fatalf("license_access missing masked hint: %s", msg.Body)
				}
			}
		}
	})

	t.Run("logs_redact_magic_link_token", func(t *testing.T) {
		// Magic-link email intentionally carries a consume token for delivery.
		_ = c04SignInViaMagicLink(t, app, server, outbox, email)
		var magicToken string
		for _, msg := range outbox.Snapshot() {
			if msg.Kind != EmailKindMagicLink {
				continue
			}
			const marker = "token="
			if i := strings.Index(msg.Body, marker); i >= 0 {
				magicToken = strings.TrimSpace(msg.Body[i+len(marker):])
				if j := strings.IndexAny(magicToken, " \n\r\t\"'"); j >= 0 {
					magicToken = magicToken[:j]
				}
			}
		}
		if magicToken == "" {
			t.Fatal("expected magic-link token in outbox for redaction check")
		}
		logLine := "auth failed url=/auth/magic-link/consume?token=" + magicToken
		redacted := redactSecrets(logLine)
		if strings.Contains(redacted, magicToken) {
			t.Fatalf("redactSecrets left magic-link token intact: %q", redacted)
		}
	})

	t.Run("logs_redact_full_license_key", func(t *testing.T) {
		sample := "issued license " + plain
		redacted := redactSecrets(sample)
		if strings.Contains(redacted, plain) {
			t.Fatalf("redactSecrets left full license key intact: %q", redacted)
		}
		_ = orderID
	})
}

func TestC04CheckoutDurableCustomer(t *testing.T) {
	app, server, _, _ := c04FlowApp(t, DemoGateway{})
	email := "c04-durable@example.com"
	form := c04CheckoutForm(email, "09120000016", "Durable", "Buyer")
	order1, _, _ := c04CompleteDemoCheckout(t, server, cloneURLValues(form))
	order2, _, _ := c04CompleteDemoCheckout(t, server, cloneURLValues(form))
	c04AssertDurableCustomer(t, app, order1, order2)
	if app.store.CountLicensesForOrder(order1) != 1 || app.store.CountLicensesForOrder(order2) != 1 {
		t.Fatalf("each paid order should have exactly one license")
	}
	customer, ok := app.store.FindCustomerByEmail(normalizeEmail(email))
	if !ok {
		t.Fatal("normalizeEmail lookup failed")
	}
	o1, _ := app.store.GetOrder(order1)
	if customer.ID != o1.CustomerID {
		t.Fatalf("FindCustomerByEmail mismatch: %q vs %q", customer.ID, o1.CustomerID)
	}
}

func cloneURLValues(values url.Values) url.Values {
	copy := url.Values{}
	for key, items := range values {
		copy[key] = append([]string(nil), items...)
	}
	return copy
}
