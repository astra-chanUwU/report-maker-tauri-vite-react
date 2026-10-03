package controlplane

import (
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
)

// Environment variable matrix (C06 fail-closed production config):
//
//	REPORT_ENV                     development|dev|local enables DevMode; unset/production is fail-closed
//	REPORT_ALLOW_DEV_SEED=1        also enables DevMode and seeds RM-TEST-1234-KEY0
//	REPORT_ALLOW_DEMO_PAYMENTS=1   allows DemoGateway (DevMode only; rejected in production)
//	REPORT_SIGNING_PRIVATE_KEY     required in production (base64url 32-byte seed)
//	REPORT_SIGNING_KEY_ID          required in production (default lease-dev-1 only in development)
//	REPORT_LICENSE_DELIVERY_KEY    required in production (base64url 32-byte AES key)
//	REPORT_DB_PATH                 required in production (persistent file; not :memory:)
//	PUBLIC_BASE_URL                required; https:// enables Secure cookies (required in production)
//	ZARINPAL_MERCHANT_ID           required in production
//	ZARINPAL_BASE_URL              optional ZarinPal API base
//	ZARINPAL_TIMEOUT_MS            optional payment HTTP timeout (default 8000)
//	REPORT_EMAIL_PROVIDER          http|transactional required in production (not local/outbox)
//	REPORT_EMAIL_API_URL/API_KEY   required for http email
//	REPORT_SMS_PROVIDER            http|kavenegar required in production (not fake/local)
//	REPORT_SMS_API_URL/API_KEY     required for http sms
//	REPORT_ADMIN_PASSWORD          optional; enables /admin when set

func isDevEnvValue(raw string) bool {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "development", "dev", "local":
		return true
	default:
		return false
	}
}

// DevModeFromEnv reports whether development relaxations are enabled.
// Production is the default (fail closed) unless REPORT_ENV is a known
// development value or REPORT_ALLOW_DEV_SEED=1.
func DevModeFromEnv() bool {
	if isDevEnvValue(os.Getenv("REPORT_ENV")) {
		return true
	}
	return os.Getenv("REPORT_ALLOW_DEV_SEED") == "1"
}

func ConfigFromEnv() Config {
	days := 30
	if raw := os.Getenv("REPORT_LEASE_DAYS"); raw != "" {
		if value, err := strconv.Atoi(raw); err == nil && value > 0 && value <= 365 {
			days = value
		}
	}
	devMode := DevModeFromEnv()
	allowSeed := os.Getenv("REPORT_ALLOW_DEV_SEED") == "1"
	allowDemo := os.Getenv("REPORT_ALLOW_DEMO_PAYMENTS") == "1"
	base := os.Getenv("PUBLIC_BASE_URL")
	if base == "" && devMode {
		base = "http://localhost:8080"
	}
	databasePath := strings.TrimSpace(os.Getenv("REPORT_DB_PATH"))
	if databasePath == "" && devMode {
		databasePath = "report-maker.db"
	}
	rpID := strings.TrimSpace(os.Getenv("REPORT_WEB_AUTHN_RP_ID"))
	if rpID == "" && base != "" {
		if parsed, err := url.Parse(base); err == nil && parsed.Hostname() != "" {
			rpID = parsed.Hostname()
		}
	}
	if rpID == "" && devMode {
		rpID = "localhost"
	}
	origins := strings.Fields(strings.ReplaceAll(os.Getenv("REPORT_WEB_AUTHN_ORIGINS"), ",", " "))
	if len(origins) == 0 && base != "" {
		origins = []string{strings.TrimRight(base, "/")}
	}
	rpName := valueOr(os.Getenv("REPORT_WEB_AUTHN_RP_NAME"), "Report Maker")

	gateway := gatewayFromEnv(base, allowDemo && devMode)
	deliveryRaw := strings.TrimSpace(os.Getenv("REPORT_LICENSE_DELIVERY_KEY"))
	var deliveryKey []byte
	if deliveryRaw != "" {
		if key, err := LoadDeliveryKey(deliveryRaw); err == nil {
			deliveryKey = key
		}
	}

	signingKeyID := strings.TrimSpace(os.Getenv("REPORT_SIGNING_KEY_ID"))
	if signingKeyID == "" && devMode {
		signingKeyID = "lease-dev-1"
	}

	return Config{
		SigningPrivateKey:    strings.TrimSpace(os.Getenv("REPORT_SIGNING_PRIVATE_KEY")),
		SigningKeyID:         signingKeyID,
		LicenseDeliveryKey:   deliveryKey,
		LeaseDays:            days,
		AllowDevSeed:         allowSeed,
		AllowDemoPayments:    allowDemo && devMode,
		DevMode:              devMode,
		PublicBaseURL:        strings.TrimRight(base, "/"),
		DatabasePath:         databasePath,
		WebAuthnRPID:         rpID,
		WebAuthnOrigins:      origins,
		WebAuthnRPName:       rpName,
		AdminPassword:        os.Getenv("REPORT_ADMIN_PASSWORD"),
		Gateway:              gateway,
		ArtifactRoot:         os.Getenv("REPORT_ARTIFACT_ROOT"),
		ReleaseManifest:      os.Getenv("REPORT_RELEASE_MANIFEST"),
		DownloadLinkTTLHours: downloadTokenExpiryFromEnv(os.Getenv("REPORT_DOWNLOAD_LINK_TTL_HOURS"), 24),
		DownloadRateLimit:    downloadTokenExpiryFromEnv(os.Getenv("REPORT_DOWNLOAD_RATE_LIMIT"), 30),
	}
}

func gatewayFromEnv(base string, allowDemo bool) PaymentGateway {
	if merchant := strings.TrimSpace(os.Getenv("ZARINPAL_MERCHANT_ID")); merchant != "" {
		apiBase := strings.TrimSpace(os.Getenv("ZARINPAL_BASE_URL"))
		if apiBase == "" {
			apiBase = strings.TrimSpace(os.Getenv("ZARINPAL_API_URL"))
		}
		if apiBase == "" {
			apiBase = "https://api.zarinpal.com"
		}
		timeout := envDurationMS("ZARINPAL_TIMEOUT_MS", defaultProviderTimeout)
		return ZarinPalGateway{
			MerchantID: merchant,
			BaseURL:    apiBase,
			Client:     &http.Client{Timeout: timeout},
		}
	}
	if allowDemo {
		return DemoGateway{BaseURL: strings.TrimRight(base, "/")}
	}
	return nil
}

// ValidateConfig enforces fail-closed production requirements.
func ValidateConfig(cfg Config) error {
	if cfg.DevMode {
		return validateDevConfig(cfg)
	}
	return validateProductionConfig(cfg)
}

func validateDevConfig(cfg Config) error {
	if cfg.Gateway != nil {
		if _, ok := cfg.Gateway.(DemoGateway); ok && !cfg.AllowDemoPayments {
			return fmt.Errorf("DemoGateway requires REPORT_ALLOW_DEMO_PAYMENTS=1 in development")
		}
	}
	return nil
}

func validateProductionConfig(cfg Config) error {
	var missing []string
	if strings.TrimSpace(cfg.SigningPrivateKey) == "" {
		missing = append(missing, "REPORT_SIGNING_PRIVATE_KEY")
	}
	if len(cfg.LicenseDeliveryKey) != 32 {
		missing = append(missing, "REPORT_LICENSE_DELIVERY_KEY")
	}
	if strings.TrimSpace(cfg.DatabasePath) == "" || cfg.DatabasePath == ":memory:" {
		missing = append(missing, "REPORT_DB_PATH")
	}
	if strings.TrimSpace(cfg.SigningKeyID) == "" {
		missing = append(missing, "REPORT_SIGNING_KEY_ID")
	}
	if strings.TrimSpace(cfg.PublicBaseURL) == "" {
		missing = append(missing, "PUBLIC_BASE_URL")
	}
	if cfg.AllowDevSeed {
		return fmt.Errorf("production config rejects REPORT_ALLOW_DEV_SEED")
	}
	if cfg.AllowDemoPayments {
		return fmt.Errorf("production config rejects REPORT_ALLOW_DEMO_PAYMENTS")
	}
	if cfg.Gateway == nil {
		missing = append(missing, "ZARINPAL_MERCHANT_ID")
	} else if _, ok := cfg.Gateway.(DemoGateway); ok {
		return fmt.Errorf("production config rejects DemoGateway; set ZARINPAL_MERCHANT_ID")
	}
	if err := requireProductionEmail(cfg.EmailSender); err != nil {
		return err
	}
	if err := requireProductionSMS(cfg.SMSSender); err != nil {
		return err
	}
	if len(missing) > 0 {
		return fmt.Errorf("production config missing required settings: %s", strings.Join(missing, ", "))
	}
	if !strings.HasPrefix(strings.ToLower(cfg.PublicBaseURL), "https://") {
		return fmt.Errorf("production PUBLIC_BASE_URL must use https://")
	}
	return nil
}

func requireProductionEmail(sender EmailSender) error {
	switch typed := sender.(type) {
	case nil:
		return fmt.Errorf("production config requires REPORT_EMAIL_PROVIDER=http (or transactional) with API credentials")
	case *LocalOutbox:
		return fmt.Errorf("production config rejects LocalOutbox; configure REPORT_EMAIL_PROVIDER=http")
	case NoopEmailSender:
		return fmt.Errorf("production config rejects NoopEmailSender; configure REPORT_EMAIL_PROVIDER=http")
	case *HTTPEmailSender:
		if strings.TrimSpace(typed.APIURL) == "" || strings.TrimSpace(typed.APIKey) == "" {
			return fmt.Errorf("production email requires REPORT_EMAIL_API_URL and REPORT_EMAIL_API_KEY")
		}
		return nil
	default:
		return nil
	}
}

func requireProductionSMS(sender SMSSender) error {
	switch typed := sender.(type) {
	case nil:
		return fmt.Errorf("production config requires REPORT_SMS_PROVIDER=http (or kavenegar) with API credentials")
	case *FakeSMS:
		return fmt.Errorf("production config rejects FakeSMS; configure REPORT_SMS_PROVIDER=http")
	case NoopSMSSender:
		return fmt.Errorf("production config rejects NoopSMSSender; configure REPORT_SMS_PROVIDER=http")
	case *HTTPSMSSender:
		if strings.TrimSpace(typed.APIURL) == "" || strings.TrimSpace(typed.APIKey) == "" {
			return fmt.Errorf("production sms requires REPORT_SMS_API_URL and REPORT_SMS_API_KEY")
		}
		return nil
	default:
		return nil
	}
}

// cookieSecure reports whether Set-Cookie should include Secure (HTTPS public origin).
func (c Config) cookieSecure() bool {
	return strings.HasPrefix(strings.ToLower(c.PublicBaseURL), "https://")
}
