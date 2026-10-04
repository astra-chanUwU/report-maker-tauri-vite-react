package controlplane

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func marketingTestApp(t *testing.T, cfg Config) (*App, *httptest.Server) {
	t.Helper()
	if cfg.SigningKeyID == "" {
		cfg.SigningKeyID = "test-key"
	}
	if cfg.LeaseDays == 0 {
		cfg.LeaseDays = 30
	}
	if !cfg.AllowDevSeed {
		cfg.AllowDevSeed = true
	}
	if cfg.PublicBaseURL == "" {
		cfg.PublicBaseURL = "http://example.test"
	}
	if len(cfg.LicenseDeliveryKey) != 32 {
		key, _ := LoadDeliveryKey(EncodeBytes(make([]byte, 32)))
		cfg.LicenseDeliveryKey = key
	}
	app, err := NewApp(cfg)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(app.Handler())
	t.Cleanup(server.Close)
	app.cfg.PublicBaseURL = server.URL
	if dg, ok := app.cfg.Gateway.(DemoGateway); ok {
		dg.BaseURL = server.URL
		app.cfg.Gateway = dg
	}
	return app, server
}

func TestMarketingStaticPages(t *testing.T) {
	_, server := marketingTestApp(t, Config{})
	for _, path := range []string{"/privacy", "/refund", "/support", "/offline-use", "/install", "/faq"} {
		resp, err := server.Client().Get(server.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("%s status=%d", path, resp.StatusCode)
		}
		if !strings.Contains(string(body), "site-footer") {
			t.Fatalf("%s missing footer", path)
		}
	}
}

func TestMarketingPersianRTL(t *testing.T) {
	deliveryKey, _ := LoadDeliveryKey(EncodeBytes(make([]byte, 32)))
	_, server := marketingTestApp(t, Config{LicenseDeliveryKey: deliveryKey, SiteLang: "fa", SiteDir: "rtl"})
	resp, err := server.Client().Get(server.URL + "/")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	text := string(body)
	if !strings.Contains(text, `lang="fa"`) || !strings.Contains(text, `dir="rtl"`) {
		t.Fatal("home missing fa/rtl attributes")
	}
	if !strings.Contains(text, "قیمت") {
		t.Fatal("home missing Persian pricing nav label")
	}
}

func TestPaymentStatusBadges(t *testing.T) {
	app, server := marketingTestApp(t, Config{})
	resp, err := server.Client().Get(server.URL + "/payments/demo/callback?authority=bad&order=missing&status=OK")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if !strings.Contains(string(body), "status-badge failed") {
		t.Fatal("unmatched payment missing failed badge")
	}
	orderID := "ord_cancel_test"
	if err := app.store.PutOrder(&Order{ID: orderID, Authority: "auth_cancel", Status: "pending", Plan: "perpetual", AmountRials: 1000}); err != nil {
		t.Fatal(err)
	}
	resp, err = server.Client().Get(server.URL + "/payments/demo/callback?authority=auth_cancel&order=" + orderID + "&status=CANCEL")
	if err != nil {
		t.Fatal(err)
	}
	body, _ = io.ReadAll(resp.Body)
	resp.Body.Close()
	if !strings.Contains(string(body), "status-badge cancelled") {
		t.Fatal("cancelled payment missing cancelled badge")
	}
}

func TestPricingCSRFAndHTMX(t *testing.T) {
	_, server := marketingTestApp(t, Config{})
	resp, err := server.Client().Get(server.URL + "/pricing")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	text := string(body)
	if !strings.Contains(text, "csrf_token") || !strings.Contains(text, "Continue to payment") {
		t.Fatal("pricing missing CSRF or checkout form")
	}
	if !strings.Contains(text, "htmx.min.js") {
		t.Fatal("pricing missing HTMX")
	}
}
