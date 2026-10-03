package controlplane

import (
	"crypto/ed25519"
	"crypto/rand"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func TestProductionConfigRejectsUnsafeDefaults(t *testing.T) {
	t.Setenv("REPORT_ENV", "production")
	t.Setenv("REPORT_ALLOW_DEV_SEED", "")
	t.Setenv("REPORT_ALLOW_DEMO_PAYMENTS", "")
	t.Setenv("REPORT_SIGNING_PRIVATE_KEY", "")
	t.Setenv("REPORT_LICENSE_DELIVERY_KEY", "")
	t.Setenv("REPORT_DB_PATH", "")
	t.Setenv("PUBLIC_BASE_URL", "")
	t.Setenv("ZARINPAL_MERCHANT_ID", "")
	t.Setenv("REPORT_EMAIL_PROVIDER", "")
	t.Setenv("REPORT_SMS_PROVIDER", "")

	cfg := ConfigFromEnv()
	if cfg.DevMode {
		t.Fatal("production env must not enable DevMode")
	}
	if _, ok := cfg.Gateway.(DemoGateway); ok {
		t.Fatal("production must not silently select DemoGateway")
	}
	if cfg.EmailSender != nil {
		if _, ok := cfg.EmailSender.(*LocalOutbox); ok {
			t.Fatal("production must not silently select LocalOutbox")
		}
	}
	if cfg.SMSSender != nil {
		if _, ok := cfg.SMSSender.(*FakeSMS); ok {
			t.Fatal("production must not silently select FakeSMS")
		}
	}
	if err := ValidateConfig(cfg); err == nil {
		t.Fatal("expected production config validation failure")
	} else if !strings.Contains(err.Error(), "missing required settings") && !strings.Contains(err.Error(), "rejects") && !strings.Contains(err.Error(), "requires") {
		t.Fatalf("unexpected validation error: %v", err)
	}
	if _, err := NewApp(cfg); err == nil {
		t.Fatal("NewApp must fail closed on unsafe production defaults")
	}
}

func TestProductionConfigRejectsDemoPaymentsFlag(t *testing.T) {
	seed := make([]byte, ed25519.SeedSize)
	if _, err := rand.Read(seed); err != nil {
		t.Fatal(err)
	}
	delivery := make([]byte, 32)
	if _, err := rand.Read(delivery); err != nil {
		t.Fatal(err)
	}
	cfg := Config{
		DevMode:            false,
		AllowDemoPayments:  true,
		SigningPrivateKey:  EncodeBytes(seed),
		SigningKeyID:       "lease-prod-1",
		LicenseDeliveryKey: delivery,
		DatabasePath:       filepath.Join(t.TempDir(), "prod.db"),
		PublicBaseURL:      "https://shop.example.ir",
		Gateway:            DemoGateway{BaseURL: "https://shop.example.ir"},
		EmailSender:        &HTTPEmailSender{APIURL: "https://mail.example.ir/send", APIKey: "secret"},
		SMSSender:          &HTTPSMSSender{APIURL: "https://sms.example.ir/send", APIKey: "secret"},
	}
	if err := ValidateConfig(cfg); err == nil || !strings.Contains(err.Error(), "REPORT_ALLOW_DEMO_PAYMENTS") {
		t.Fatalf("expected demo payments rejection, got %v", err)
	}
}

func TestDevelopmentConfigRunsWithoutExternalCredentials(t *testing.T) {
	t.Setenv("REPORT_ENV", "development")
	t.Setenv("REPORT_ALLOW_DEV_SEED", "1")
	t.Setenv("REPORT_ALLOW_DEMO_PAYMENTS", "1")
	t.Setenv("REPORT_SIGNING_PRIVATE_KEY", "")
	t.Setenv("REPORT_LICENSE_DELIVERY_KEY", "")
	t.Setenv("ZARINPAL_MERCHANT_ID", "")
	t.Setenv("REPORT_EMAIL_PROVIDER", "")
	t.Setenv("REPORT_SMS_PROVIDER", "")
	t.Setenv("REPORT_EMAIL_API_URL", "")
	t.Setenv("REPORT_EMAIL_API_KEY", "")
	t.Setenv("REPORT_SMS_API_URL", "")
	t.Setenv("REPORT_SMS_API_KEY", "")
	t.Setenv("PUBLIC_BASE_URL", "http://localhost:8080")
	t.Setenv("REPORT_DB_PATH", filepath.Join(t.TempDir(), "dev.db"))

	cfg := ConfigFromEnv()
	if !cfg.DevMode {
		t.Fatal("expected DevMode")
	}
	if !cfg.AllowDemoPayments {
		t.Fatal("expected AllowDemoPayments")
	}
	if _, ok := cfg.Gateway.(DemoGateway); !ok {
		t.Fatalf("expected DemoGateway in development with flag, got %T", cfg.Gateway)
	}
	if _, ok := cfg.EmailSender.(*LocalOutbox); !ok {
		t.Fatalf("expected LocalOutbox in development, got %T", cfg.EmailSender)
	}
	if _, ok := cfg.SMSSender.(*FakeSMS); !ok {
		t.Fatalf("expected FakeSMS in development, got %T", cfg.SMSSender)
	}
	app, err := NewApp(cfg)
	if err != nil {
		t.Fatalf("development NewApp failed: %v", err)
	}
	t.Cleanup(func() { _ = app.Close() })
}

func TestDemoPaymentsRequireExplicitFlag(t *testing.T) {
	t.Setenv("REPORT_ENV", "development")
	t.Setenv("REPORT_ALLOW_DEMO_PAYMENTS", "")
	t.Setenv("ZARINPAL_MERCHANT_ID", "")
	t.Setenv("REPORT_ALLOW_DEV_SEED", "")
	cfg := ConfigFromEnv()
	if cfg.Gateway != nil {
		t.Fatalf("without demo flag, gateway should be nil, got %T", cfg.Gateway)
	}
	cfg.AllowDemoPayments = false
	cfg.Gateway = DemoGateway{BaseURL: "http://localhost:8080"}
	if err := ValidateConfig(cfg); err == nil {
		t.Fatal("DemoGateway without flag must fail validation")
	}
}

func TestSecurityHeadersCSPAndLocalHTMX(t *testing.T) {
	app, err := NewApp(Config{
		DevMode: true, AllowDemoPayments: true, AllowDevSeed: true,
		SigningKeyID: "test-key", LeaseDays: 30, PublicBaseURL: "http://example.test",
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = app.Close() })
	server := httptest.NewServer(app.Handler())
	t.Cleanup(server.Close)

	resp, err := http.Get(server.URL + "/")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if got := resp.Header.Get("Content-Security-Policy"); !strings.Contains(got, "default-src 'self'") {
		t.Fatalf("missing CSP: %q", got)
	}
	if resp.Header.Get("X-Frame-Options") != "DENY" {
		t.Fatalf("missing X-Frame-Options")
	}
	body := readBody(t, resp)
	if strings.Contains(body, "unpkg.com") {
		t.Fatal("page still references unpkg CDN")
	}
	if !strings.Contains(body, `/static/htmx.min.js`) {
		t.Fatalf("page missing local htmx asset: %s", body[:min(200, len(body))])
	}

	asset, err := http.Get(server.URL + "/static/htmx.min.js")
	if err != nil {
		t.Fatal(err)
	}
	defer asset.Body.Close()
	if asset.StatusCode != http.StatusOK {
		t.Fatalf("local htmx status=%d", asset.StatusCode)
	}
	js := readBody(t, asset)
	if !strings.Contains(js, "htmx") {
		t.Fatal("htmx asset body unexpected")
	}
}

func TestSecureCookieFlagWhenHTTPS(t *testing.T) {
	cfg := Config{PublicBaseURL: "https://shop.example.ir"}
	if !cfg.cookieSecure() {
		t.Fatal("https origin should set Secure cookies")
	}
	cfg.PublicBaseURL = "http://localhost:8080"
	if cfg.cookieSecure() {
		t.Fatal("http origin must not force Secure cookies")
	}
}

func TestProviderErrorsAreRedacted(t *testing.T) {
	raw := "Bearer super-secret-token-value-abcdef and RM-ABCD-EFGH-IJKL"
	got := redactSecrets(raw)
	if strings.Contains(got, "super-secret-token-value-abcdef") || strings.Contains(got, "RM-ABCD-EFGH-IJKL") {
		t.Fatalf("secrets not redacted: %q", got)
	}
}

func readBody(t *testing.T, resp *http.Response) string {
	t.Helper()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}
