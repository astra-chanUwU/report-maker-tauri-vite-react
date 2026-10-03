package controlplane

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func testDeliveryKey(t *testing.T) []byte {
	t.Helper()
	key, err := LoadDeliveryKey(EncodeBytes(make([]byte, 32)))
	if err != nil {
		t.Fatal(err)
	}
	return key
}

func testAppWithGateway(t *testing.T, gateway PaymentGateway) (*App, *httptest.Server) {
	t.Helper()
	cfg := Config{
		SigningKeyID: "test-key", LeaseDays: 30, AllowDevSeed: false,
		PublicBaseURL: "http://example.test", LicenseDeliveryKey: testDeliveryKey(t),
		Gateway: gateway,
	}
	app, err := NewApp(cfg)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(app.Handler())
	t.Cleanup(server.Close)
	app.cfg.PublicBaseURL = server.URL
	if demo, ok := gateway.(DemoGateway); ok {
		demo.BaseURL = server.URL
		app.cfg.Gateway = demo
	} else {
		app.cfg.Gateway = gateway
	}
	return app, server
}

func completeDemoCheckout(t *testing.T, server *httptest.Server) (orderID string) {
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
	callback, err := noRedirect.Get(server.URL + callbackLocation)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(callback.Body)
	callback.Body.Close()
	if !strings.Contains(string(body), "Payment received") {
		t.Fatalf("callback body missing success: %s", body)
	}
	parsed, _ := url.Parse(server.URL + callbackLocation)
	orderID = parsed.Query().Get("order")
	if orderID == "" {
		t.Fatal("missing order id in callback")
	}
	return orderID
}

func TestDemoGatewayProvisionsOneLicense(t *testing.T) {
	app, server := testAppWithGateway(t, DemoGateway{})
	orderID := completeDemoCheckout(t, server)
	if app.store.CountProvisionedLicenses() != 1 {
		t.Fatalf("license count = %d, want 1", app.store.CountProvisionedLicenses())
	}
	if app.store.CountLicensesForOrder(orderID) != 1 {
		t.Fatalf("order license count = %d, want 1", app.store.CountLicensesForOrder(orderID))
	}
	order, ok := app.store.GetOrder(orderID)
	if !ok || order.Status != "paid" || order.LicenseID == "" {
		t.Fatalf("order not fulfilled: %#v, ok=%v", order, ok)
	}
	license, ok := app.store.FindLicenseByID(order.LicenseID)
	if !ok || license.OrderID != orderID || license.CustomerID != order.CustomerID {
		t.Fatalf("license not linked: %#v", license)
	}
}

func TestDemoGatewayCallbackRetryIsIdempotent(t *testing.T) {
	app, server := testAppWithGateway(t, DemoGateway{})
	client := server.Client()
	noRedirect := *client
	noRedirect.CheckRedirect = func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }
	csrf, csrfCookies := fetchCSRF(t, client, server.URL)
	form := url.Values{
		"plan": {"perpetual"}, "first_name": {"Retry"}, "last_name": {"Customer"},
		"email": {"retry@example.com"}, "phone": {"09121111111"}, "csrf_token": {csrf},
	}
	request, _ := http.NewRequest(http.MethodPost, server.URL+"/checkout/start", strings.NewReader(form.Encode()))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	for _, c := range csrfCookies {
		request.AddCookie(c)
	}
	response, err := noRedirect.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	redirected, err := noRedirect.Get(response.Header.Get("Location"))
	response.Body.Close()
	if err != nil {
		t.Fatal(err)
	}
	callbackURL := server.URL + redirected.Header.Get("Location")
	redirected.Body.Close()
	first, err := noRedirect.Get(callbackURL)
	if err != nil {
		t.Fatal(err)
	}
	first.Body.Close()
	second, err := noRedirect.Get(callbackURL)
	if err != nil {
		t.Fatal(err)
	}
	second.Body.Close()
	if app.store.CountProvisionedLicenses() != 1 {
		t.Fatalf("license count after retry = %d, want 1", app.store.CountProvisionedLicenses())
	}
}

func TestCancelledCallbackCreatesNoLicense(t *testing.T) {
	app, server := testAppWithGateway(t, DemoGateway{})
	orderID := placePendingOrder(t, app, server)
	callback := server.URL + "/payments/demo-domestic/callback?authority=demo_x&order=" + orderID + "&status=CANCELLED"
	response, err := server.Client().Get(callback)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if app.store.CountProvisionedLicenses() != 0 {
		t.Fatalf("license count = %d, want 0", app.store.CountProvisionedLicenses())
	}
}

func TestUnmatchedCallbackCreatesNoLicense(t *testing.T) {
	app, server := testAppWithGateway(t, DemoGateway{})
	response, err := server.Client().Get(server.URL + "/payments/demo-domestic/callback?authority=unknown&order=ord_missing&status=OK")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if app.store.CountProvisionedLicenses() != 0 {
		t.Fatalf("license count = %d, want 0", app.store.CountProvisionedLicenses())
	}
}

type failingVerifyGateway struct{}

func (failingVerifyGateway) Name() string { return "demo-domestic" }
func (failingVerifyGateway) Start(_ context.Context, request PaymentRequest) (PaymentResult, error) {
	return DemoGateway{}.Start(context.Background(), request)
}
func (failingVerifyGateway) Verify(_ context.Context, _ string, _ int64) (PaymentVerification, error) {
	return PaymentVerification{}, context.Canceled
}

func TestFailedVerifyCreatesNoLicense(t *testing.T) {
	app, server := testAppWithGateway(t, failingVerifyGateway{})
	orderID := placePendingOrder(t, app, server)
	order, _ := app.store.GetOrder(orderID)
	callback := server.URL + "/payments/demo-domestic/callback?authority=" + order.Authority + "&order=" + orderID + "&status=OK"
	response, err := server.Client().Get(callback)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if app.store.CountProvisionedLicenses() != 0 {
		t.Fatalf("license count = %d, want 0", app.store.CountProvisionedLicenses())
	}
}

func TestZarinPalVerifyProvisionsOneLicense(t *testing.T) {
	var verifyCount int
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/pg/v4/payment/request.json":
			_, _ = w.Write([]byte(`{"data":{"code":100,"authority":"A-zarin-test"},"errors":[]}`))
		case "/pg/v4/payment/verify.json":
			verifyCount++
			_, _ = w.Write([]byte(`{"data":{"code":100,"ref_id":424242},"errors":[]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer provider.Close()

	gateway := ZarinPalGateway{MerchantID: "merchant-test", BaseURL: provider.URL, Client: provider.Client()}
	app, server := testAppWithGateway(t, gateway)
	orderID := checkoutWithGateway(t, app, server, gateway.Name())
	if app.store.CountProvisionedLicenses() != 1 {
		t.Fatalf("license count = %d, want 1", app.store.CountProvisionedLicenses())
	}
	order, ok := app.store.GetOrder(orderID)
	if !ok || order.PaymentRef != "424242" || order.LicenseID == "" {
		t.Fatalf("unexpected order: %#v", order)
	}
	if verifyCount != 1 {
		t.Fatalf("verify calls = %d, want 1", verifyCount)
	}
}

func TestZarinPalAlreadyVerifiedProvisionsOnce(t *testing.T) {
	var verifyCount int
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/pg/v4/payment/request.json":
			_, _ = w.Write([]byte(`{"data":{"code":100,"authority":"A-zarin-101"},"errors":[]}`))
		case "/pg/v4/payment/verify.json":
			verifyCount++
			_, _ = w.Write([]byte(`{"data":{"code":101,"ref_id":"already"},"errors":[]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer provider.Close()

	gateway := ZarinPalGateway{MerchantID: "merchant-test", BaseURL: provider.URL, Client: provider.Client()}
	app, server := testAppWithGateway(t, gateway)
	orderID := startZarinPalPendingOrder(t, app, server, gateway)
	callbackURL := buildCallbackURL(t, app, server, orderID, gateway.Name())
	client := server.Client()
	for i := 0; i < 2; i++ {
		response, err := client.Get(callbackURL)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
	}
	if app.store.CountProvisionedLicenses() != 1 {
		t.Fatalf("license count = %d, want 1", app.store.CountProvisionedLicenses())
	}
	if verifyCount != 2 {
		t.Fatalf("verify calls = %d, want 2", verifyCount)
	}
}

func startZarinPalPendingOrder(t *testing.T, app *App, server *httptest.Server, gateway ZarinPalGateway) string {
	t.Helper()
	csrf, csrfCookies := fetchCSRF(t, server.Client(), server.URL)
	form := url.Values{
		"plan": {"perpetual"}, "first_name": {"Zarin"}, "last_name": {"Pending"},
		"email": {"zarin-pending@example.com"}, "phone": {"09125555555"}, "csrf_token": {csrf},
	}
	request, _ := http.NewRequest(http.MethodPost, server.URL+"/checkout/start", strings.NewReader(form.Encode()))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	for _, c := range csrfCookies {
		request.AddCookie(c)
	}
	noRedirect := *server.Client()
	noRedirect.CheckRedirect = func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }
	response, err := noRedirect.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	location := response.Header.Get("Location")
	response.Body.Close()
	parsed, err := url.Parse(location)
	if err != nil {
		t.Fatal(err)
	}
	authority := strings.TrimPrefix(parsed.Path, "/pg/StartPay/")
	order, ok := app.store.FindOrderByAuthority(authority)
	if !ok {
		t.Fatalf("order not found for authority %q", authority)
	}
	return order.ID
}

func placePendingOrder(t *testing.T, app *App, server *httptest.Server) string {
	t.Helper()
	csrf, csrfCookies := fetchCSRF(t, server.Client(), server.URL)
	form := url.Values{
		"plan": {"perpetual"}, "first_name": {"Pending"}, "last_name": {"Order"},
		"email": {"pending@example.com"}, "phone": {"09122222222"}, "csrf_token": {csrf},
	}
	request, _ := http.NewRequest(http.MethodPost, server.URL+"/checkout/start", strings.NewReader(form.Encode()))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	for _, c := range csrfCookies {
		request.AddCookie(c)
	}
	noRedirect := *server.Client()
	noRedirect.CheckRedirect = func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }
	response, err := noRedirect.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	location := response.Header.Get("Location")
	response.Body.Close()
	parsed, _ := url.Parse(location)
	orderID := parsed.Query().Get("order")
	if orderID == "" {
		if order, ok := app.store.FindOrderByAuthority(parsed.Query().Get("authority")); ok {
			orderID = order.ID
		}
	}
	if orderID == "" {
		t.Fatal("could not determine order id")
	}
	return orderID
}

func checkoutWithGateway(t *testing.T, app *App, server *httptest.Server, provider string) string {
	t.Helper()
	csrf, csrfCookies := fetchCSRF(t, server.Client(), server.URL)
	form := url.Values{
		"plan": {"perpetual"}, "first_name": {"Zarin"}, "last_name": {"Buyer"},
		"email": {"zarin@example.com"}, "phone": {"09123333333"}, "csrf_token": {csrf},
	}
	request, _ := http.NewRequest(http.MethodPost, server.URL+"/checkout/start", strings.NewReader(form.Encode()))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	for _, c := range csrfCookies {
		request.AddCookie(c)
	}
	noRedirect := *server.Client()
	noRedirect.CheckRedirect = func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }
	response, err := noRedirect.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	location := response.Header.Get("Location")
	response.Body.Close()
	var orderID string
	if provider == "zarinpal" {
		parsed, err := url.Parse(location)
		if err != nil {
			t.Fatal(err)
		}
		authority := strings.TrimPrefix(parsed.Path, "/pg/StartPay/")
		order, ok := app.store.FindOrderByAuthority(authority)
		if !ok {
			t.Fatalf("order not found for authority %q", authority)
		}
		orderID = order.ID
		location = buildCallbackURL(t, app, server, orderID, provider)
	} else {
		redirected, err := noRedirect.Get(location)
		if err != nil {
			t.Fatal(err)
		}
		location = server.URL + redirected.Header.Get("Location")
		redirected.Body.Close()
		parsed, _ := url.Parse(location)
		orderID = parsed.Query().Get("order")
	}
	callback, err := noRedirect.Get(location)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(callback.Body)
	callback.Body.Close()
	if !strings.Contains(string(body), "Payment received") {
		t.Fatalf("missing payment success: %s", body)
	}
	if orderID == "" {
		parsed, _ := url.Parse(location)
		orderID = parsed.Query().Get("order")
	}
	return orderID
}

func buildCallbackURL(t *testing.T, app *App, server *httptest.Server, orderID, provider string) string {
	t.Helper()
	order, ok := app.store.GetOrder(orderID)
	if !ok {
		t.Fatalf("order %s not found", orderID)
	}
	return server.URL + "/payments/" + provider + "/callback?authority=" + url.QueryEscape(order.Authority) + "&order=" + url.QueryEscape(orderID) + "&status=OK"
}

func TestLicenseKeyRoundTripEncryption(t *testing.T) {
	key := testDeliveryKey(t)
	plain := "RM-ABCD-EFGH-IJKL"
	encoded, err := EncryptLicenseKey(key, plain)
	if err != nil {
		t.Fatal(err)
	}
	got, err := DecryptLicenseKey(key, encoded)
	if err != nil || got != plain {
		t.Fatalf("round trip = %q err=%v", got, err)
	}
}

func TestGenerateLicenseKeyFormat(t *testing.T) {
	key, err := GenerateLicenseKey()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(key, "RM-") || len(key) < 15 {
		t.Fatalf("unexpected key format: %q", key)
	}
}

func TestCatalogRejectsUnknownPlanCheckout(t *testing.T) {
	_, server := testAppWithGateway(t, DemoGateway{})
	csrf, csrfCookies := fetchCSRF(t, server.Client(), server.URL)
	form := url.Values{
		"plan": {"enterprise"}, "first_name": {"Bad"}, "last_name": {"Plan"},
		"email": {"bad@example.com"}, "phone": {"09124444444"}, "csrf_token": {csrf},
	}
	request, _ := http.NewRequest(http.MethodPost, server.URL+"/checkout/start", strings.NewReader(form.Encode()))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	for _, c := range csrfCookies {
		request.AddCookie(c)
	}
	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", response.StatusCode)
	}
}

func TestPurchasesPageRequiresAuth(t *testing.T) {
	_, server := testAppWithGateway(t, DemoGateway{})
	noRedirect := *server.Client()
	noRedirect.CheckRedirect = func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }
	response, err := noRedirect.Get(server.URL + "/account/purchases")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusSeeOther {
		t.Fatalf("status = %d, want 303", response.StatusCode)
	}
}

func TestPaidLicenseActivatesDesktop(t *testing.T) {
	app, server := testAppWithGateway(t, DemoGateway{})
	orderID := completeDemoCheckout(t, server)
	order, _ := app.store.GetOrder(orderID)
	license, _ := app.store.FindLicenseByID(order.LicenseID)
	plain, err := DecryptLicenseKey(app.cfg.LicenseDeliveryKey, license.DeliveryCiphertext)
	if err != nil {
		t.Fatal(err)
	}
	_, device, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	public := EncodeBytes(device.Public().(ed25519.PublicKey))
	body := map[string]string{
		"license_key": plain, "device_public_key": public, "app_version": "0.1.0", "platform": "windows",
	}
	encoded, _ := json.Marshal(body)
	response, err := server.Client().Post(server.URL+"/v1/activations", "application/json", strings.NewReader(string(encoded)))
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("activation status=%d", response.StatusCode)
	}
}
