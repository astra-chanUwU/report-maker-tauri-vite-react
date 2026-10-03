package controlplane

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// C04 integrated end-to-end tests: checkout → payment verify → license → emails →
// account visibility → repeatable download. Covers demo gateway, mocked ZarinPal,
// callback idempotency, provider outage recovery, disclosure, and account linking.

func c04DownloadApp(t *testing.T, email EmailSender) (*App, *httptest.Server, string) {
	t.Helper()
	root := t.TempDir()
	payload := []byte("report-maker-c04-artifact")
	sum := sha256.Sum256(payload)
	artifactPath := filepath.Join(root, "windows-x64", "ReportMaker_1.0.0_x64-setup.exe")
	if err := os.MkdirAll(filepath.Dir(artifactPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(artifactPath, payload, 0o644); err != nil {
		t.Fatal(err)
	}
	manifest := filepath.Join(root, "releases-c04.json")
	manifestBody := `[{"id":"desktop-windows-x64","version":"1.0.0","filename":"ReportMaker_1.0.0_x64-setup.exe","sha256":"` + hex.EncodeToString(sum[:]) + `","relative_path":"windows-x64/ReportMaker_1.0.0_x64-setup.exe","platform":"Windows x64","description":"C04 test build"}]`
	if err := os.WriteFile(manifest, []byte(manifestBody), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg := Config{
		SigningKeyID: "test-key", LeaseDays: 30, AllowDevSeed: false,
		PublicBaseURL: "http://example.test", LicenseDeliveryKey: testDeliveryKey(t),
		Gateway: DemoGateway{}, EmailSender: email, SMSSender: &FakeSMS{},
		ArtifactRoot: root, ReleaseManifest: manifest,
		DownloadLinkTTLHours: 24, DownloadRateLimit: 100,
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
	return app, server, hex.EncodeToString(sum[:])
}

func emailsByKind(t *testing.T, outbox *LocalOutbox) map[string]EmailMessage {
	t.Helper()
	msgs := outbox.Snapshot()
	byKind := make(map[string]EmailMessage, len(msgs))
	for _, m := range msgs {
		byKind[m.Kind] = m
	}
	return byKind
}

func TestC04DemoCheckoutFullFlow(t *testing.T) {
	outbox := &LocalOutbox{}
	app, server, checksum := c04DownloadApp(t, outbox)
	email := "customer@example.com"

	orderID, callbackURL, firstBody := completeDemoCheckoutURL(t, server)
	plain := plainLicenseForOrder(t, app, orderID)
	assertBodyHidesFullKey(t, firstBody, plain)

	if app.store.CountProvisionedLicenses() != 1 {
		t.Fatalf("license count = %d, want 1", app.store.CountProvisionedLicenses())
	}
	order, ok := app.store.GetOrder(orderID)
	if !ok || order.Status != "paid" || order.LicenseID == "" {
		t.Fatalf("order not fulfilled: %#v ok=%v", order, ok)
	}

	byKind := emailsByKind(t, outbox)
	for _, kind := range []string{EmailKindReceipt, EmailKindLicenseAccess, EmailKindDownloadAccess} {
		if _, ok := byKind[kind]; !ok {
			t.Fatalf("missing %s email after paid fulfill; got %#v", kind, outbox.Snapshot())
		}
	}
	if strings.Contains(byKind[EmailKindLicenseAccess].Body, plain) {
		t.Fatal("license email must not contain plaintext key")
	}

	client := signInViaMagicLink(t, app, server, email)
	purchases, err := client.Get(server.URL + "/account/purchases")
	if err != nil {
		t.Fatal(err)
	}
	purchasesBody, _ := io.ReadAll(purchases.Body)
	purchases.Body.Close()
	if purchases.StatusCode != http.StatusOK || !strings.Contains(string(purchasesBody), orderID) {
		t.Fatalf("purchases page missing order: status=%d body=%s", purchases.StatusCode, purchasesBody)
	}

	serverURL, _ := url.Parse(server.URL)
	for i := 0; i < 2; i++ {
		dlReq, _ := http.NewRequest(http.MethodGet, server.URL+"/downloads/desktop-windows-x64", nil)
		for _, c := range client.Jar.Cookies(serverURL) {
			dlReq.AddCookie(c)
		}
		dlResp, err := client.Do(dlReq)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(dlResp.Body)
		dlResp.Body.Close()
		if dlResp.StatusCode != http.StatusOK {
			t.Fatalf("download %d status=%d", i, dlResp.StatusCode)
		}
		if got := sha256.Sum256(body); hex.EncodeToString(got[:]) != checksum {
			t.Fatalf("download %d checksum mismatch", i)
		}
	}

	paymentEmailCount := len(outbox.Snapshot())

	retry, err := server.Client().Get(callbackURL)
	if err != nil {
		t.Fatal(err)
	}
	retryBody, _ := io.ReadAll(retry.Body)
	retry.Body.Close()
	assertBodyHidesFullKey(t, string(retryBody), plain)
	if app.store.CountProvisionedLicenses() != 1 {
		t.Fatalf("callback retry created extra license: count=%d", app.store.CountProvisionedLicenses())
	}
	if len(outbox.Snapshot()) != paymentEmailCount {
		t.Fatalf("callback retry duplicated payment emails: before=%d after=%d", paymentEmailCount, len(outbox.Snapshot()))
	}
}

func TestC04ZarinPalMockedFullFlow(t *testing.T) {
	t.Run("code 100", func(t *testing.T) {
		outbox := &LocalOutbox{}
		provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			switch r.URL.Path {
			case "/pg/v4/payment/request.json":
				_, _ = w.Write([]byte(`{"data":{"code":100,"authority":"A-c04-100"},"errors":[]}`))
			case "/pg/v4/payment/verify.json":
				_, _ = w.Write([]byte(`{"data":{"code":100,"ref_id":100100},"errors":[]}`))
			default:
				http.NotFound(w, r)
			}
		}))
		t.Cleanup(provider.Close)

		gateway := ZarinPalGateway{MerchantID: "merchant-test", BaseURL: provider.URL, Client: provider.Client()}
		app, server, _ := c04DownloadApp(t, outbox)
		app.cfg.Gateway = gateway

		orderID := checkoutWithGateway(t, app, server, gateway.Name())
		order, _ := app.store.GetOrder(orderID)
		if order.PaymentRef != "100100" || order.LicenseID == "" {
			t.Fatalf("unexpected order: %#v", order)
		}
		if len(emailsByKind(t, outbox)) < 3 {
			t.Fatalf("expected receipt+license+download emails: %#v", outbox.Snapshot())
		}
	})

	t.Run("code 101 idempotent", func(t *testing.T) {
		outbox := &LocalOutbox{}
		var verifyCount atomic.Int32
		provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			switch r.URL.Path {
			case "/pg/v4/payment/request.json":
				_, _ = w.Write([]byte(`{"data":{"code":100,"authority":"A-c04-101"},"errors":[]}`))
			case "/pg/v4/payment/verify.json":
				verifyCount.Add(1)
				_, _ = w.Write([]byte(`{"data":{"code":101,"ref_id":"already-101"},"errors":[]}`))
			default:
				http.NotFound(w, r)
			}
		}))
		t.Cleanup(provider.Close)

		gateway := ZarinPalGateway{MerchantID: "merchant-test", BaseURL: provider.URL, Client: provider.Client()}
		app, server, _ := c04DownloadApp(t, outbox)
		app.cfg.Gateway = gateway

		orderID := startZarinPalPendingOrder(t, app, server, gateway)
		callbackURL := buildCallbackURL(t, app, server, orderID, gateway.Name())
		client := server.Client()
		for i := 0; i < 2; i++ {
			resp, err := client.Get(callbackURL)
			if err != nil {
				t.Fatal(err)
			}
			resp.Body.Close()
		}
		if app.store.CountProvisionedLicenses() != 1 {
			t.Fatalf("101 retry license count = %d", app.store.CountProvisionedLicenses())
		}
		if verifyCount.Load() != 2 {
			t.Fatalf("verify calls = %d, want 2", verifyCount.Load())
		}
		if len(outbox.Snapshot()) != 3 {
			t.Fatalf("101 retry duplicated emails: %#v", outbox.Snapshot())
		}
	})
}

func TestC04ProviderOutageAfterPaymentRecoverable(t *testing.T) {
	failing := &failingEmailSender{err: errors.New("smtp timeout")}
	app, server := testPaidCallbackApp(t, failing)
	order := seedPendingOrder(t, app, "ord_c04_outage", "cus_c04_outage", "outage@example.com")
	resp, err := server.Client().Get(server.URL + "/payments/demo-domestic/callback?authority=" + url.QueryEscape(order.Authority) + "&order=" + order.ID + "&status=OK")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	paid, ok := app.store.GetOrder(order.ID)
	if !ok || paid.Status != "paid" || paid.LicenseID == "" {
		t.Fatalf("paid order must remain recoverable after email outage: %#v ok=%v", paid, ok)
	}
	if failing.calls.Load() < 1 {
		t.Fatal("expected email send attempt despite outage")
	}
}

func TestC04ExpiredDownloadLinkRenewAfterAuth(t *testing.T) {
	app, server, _ := c04DownloadApp(t, &LocalOutbox{})
	orderID, _, _ := completeDemoCheckoutURL(t, server)
	order, _ := app.store.GetOrder(orderID)
	cookie := sessionCookieForCustomer(t, app, order.CustomerID)

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

	pageReq, _ := http.NewRequest(http.MethodGet, server.URL+"/account/downloads", nil)
	pageReq.AddCookie(cookie)
	pageResp, err := server.Client().Do(pageReq)
	if err != nil {
		t.Fatal(err)
	}
	pageBody, _ := io.ReadAll(pageResp.Body)
	pageResp.Body.Close()
	if pageResp.StatusCode != http.StatusOK || !strings.Contains(string(pageBody), "/downloads/link/") {
		t.Fatalf("downloads page missing renewed link: status=%d", pageResp.StatusCode)
	}

	directReq, _ := http.NewRequest(http.MethodGet, server.URL+"/downloads/desktop-windows-x64", nil)
	directReq.AddCookie(cookie)
	directResp, err := server.Client().Do(directReq)
	if err != nil {
		t.Fatal(err)
	}
	directResp.Body.Close()
	if directResp.StatusCode != http.StatusOK {
		t.Fatalf("authenticated download after renew status=%d", directResp.StatusCode)
	}
}

func TestC04TwoCheckoutsSameEmailOneCustomer(t *testing.T) {
	app, server := checkoutTestApp(t)
	email := "repeat-c04@example.com"
	first := submitCheckout(t, server, url.Values{
		"first_name": {"First"}, "last_name": {"Buyer"}, "email": {email}, "phone": {"09120001111"},
	})
	second := submitCheckout(t, server, url.Values{
		"first_name": {"Second"}, "last_name": {"Checkout"}, "email": {strings.ToUpper(email)}, "phone": {"09120002222"},
	})
	order1, _ := app.store.GetOrder(first)
	order2, _ := app.store.GetOrder(second)
	if order1.CustomerID != order2.CustomerID {
		t.Fatalf("expected one customer: %s vs %s", order1.CustomerID, order2.CustomerID)
	}
	if app.store.CountCustomers() != 1 {
		t.Fatalf("customer count = %d, want 1", app.store.CountCustomers())
	}
	customer, ok := app.store.FindCustomerByEmail(normalizeEmail(email))
	if !ok || customer.ID != order1.CustomerID {
		t.Fatalf("normalized email lookup failed: ok=%v customer=%#v", ok, customer)
	}
}
