package controlplane

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Email message kinds used across receipts, auth, and downloads.
const (
	EmailKindReceipt         = "receipt"
	EmailKindLicenseAccess   = "license_access"
	EmailKindMagicLink       = "magic_link"
	EmailKindDownloadAccess  = "download_access"
)

// SMS message kinds for phone verification and recovery.
const (
	SMSKindPhoneVerify   = "phone_verify"
	SMSKindPhoneRecovery = "phone_recovery"
)

const (
	defaultProviderTimeout = 8 * time.Second
	defaultProviderRetries = 2
	maxProviderResponse    = 64 << 10
)

type EmailMessage struct {
	To, Subject, Body, Kind string
	OrderID, LicenseID      string
	IdempotencyKey          string
}

type EmailSender interface {
	Send(ctx context.Context, msg EmailMessage) error
}

type LocalOutbox struct {
	mu       sync.Mutex
	Messages []EmailMessage
}

func (o *LocalOutbox) Send(_ context.Context, msg EmailMessage) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	if msg.IdempotencyKey != "" {
		for _, existing := range o.Messages {
			if existing.IdempotencyKey == msg.IdempotencyKey {
				return nil
			}
		}
	}
	o.Messages = append(o.Messages, msg)
	return nil
}

// Snapshot returns a copy of recorded messages for tests.
func (o *LocalOutbox) Snapshot() []EmailMessage {
	o.mu.Lock()
	defer o.mu.Unlock()
	out := make([]EmailMessage, len(o.Messages))
	copy(out, o.Messages)
	return out
}

// NoopEmailSender discards messages. Used when production email is intentionally disabled.
type NoopEmailSender struct{}

func (NoopEmailSender) Send(context.Context, EmailMessage) error { return nil }

// HTTPEmailSender is a production-shaped transactional email HTTP client.
// Configure via REPORT_EMAIL_* env vars. API keys must never be logged.
type HTTPEmailSender struct {
	APIURL     string
	APIKey     string
	FromEmail  string
	FromName   string
	Client     *http.Client
	MaxRetries int
	Log        *log.Logger
}

func (s *HTTPEmailSender) Send(ctx context.Context, msg EmailMessage) error {
	if strings.TrimSpace(s.APIURL) == "" {
		return errors.New("email provider api url not configured")
	}
	if strings.TrimSpace(s.APIKey) == "" {
		return errors.New("email provider api key not configured")
	}
	payload := map[string]any{
		"from": map[string]string{
			"email": valueOr(s.FromEmail, "noreply@localhost"),
			"name":  valueOr(s.FromName, "Report Maker"),
		},
		"to":               []map[string]string{{"email": msg.To}},
		"subject":          msg.Subject,
		"text":             msg.Body,
		"tags":             []string{msg.Kind},
		"idempotency_key":  msg.IdempotencyKey,
		"order_id":         msg.OrderID,
		"license_id":       msg.LicenseID,
		"message_kind":     msg.Kind,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	retries := s.MaxRetries
	if retries < 0 {
		retries = 0
	}
	var lastErr error
	for attempt := 0; attempt <= retries; attempt++ {
		if attempt > 0 {
			if err := sleepBackoff(ctx, attempt); err != nil {
				return err
			}
		}
		lastErr = s.doSend(ctx, body, msg)
		if lastErr == nil {
			s.logf("email send ok kind=%s to=%s order=%s license=%s idem=%s", msg.Kind, redactEmail(msg.To), msg.OrderID, msg.LicenseID, msg.IdempotencyKey)
			return nil
		}
		if !retryableProviderError(lastErr) {
			break
		}
		s.logf("email send retry kind=%s attempt=%d err=%s", msg.Kind, attempt+1, redactSecrets(lastErr.Error()))
	}
	s.logf("email send failed kind=%s to=%s order=%s err=%s", msg.Kind, redactEmail(msg.To), msg.OrderID, redactSecrets(fmt.Sprint(lastErr)))
	return lastErr
}

func (s *HTTPEmailSender) doSend(ctx context.Context, body []byte, msg EmailMessage) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.APIURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+s.APIKey)
	if msg.IdempotencyKey != "" {
		req.Header.Set("Idempotency-Key", msg.IdempotencyKey)
	}
	resp, err := s.httpClient().Do(req)
	if err != nil {
		return fmt.Errorf("email provider transport: %w", err)
	}
	defer resp.Body.Close()
	limited := io.LimitReader(resp.Body, maxProviderResponse)
	respBody, _ := io.ReadAll(limited)
	if resp.StatusCode >= 500 || resp.StatusCode == http.StatusTooManyRequests {
		return transientProviderError{msg: fmt.Sprintf("email provider status %d", resp.StatusCode)}
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("email provider status %d: %s", resp.StatusCode, redactSecrets(string(respBody)))
	}
	return nil
}

func (s *HTTPEmailSender) httpClient() *http.Client {
	if s.Client != nil {
		return s.Client
	}
	return &http.Client{Timeout: defaultProviderTimeout}
}

func (s *HTTPEmailSender) logf(format string, args ...any) {
	logger := s.Log
	if logger == nil {
		logger = log.Default()
	}
	logger.Printf(format, args...)
}

type SMSMessage struct {
	To, Body, Kind string
	IdempotencyKey string
}

type SMSSender interface {
	Send(ctx context.Context, msg SMSMessage) error
}

type FakeSMS struct {
	mu       sync.Mutex
	Messages []SMSMessage
}

func (f *FakeSMS) Send(_ context.Context, msg SMSMessage) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if msg.IdempotencyKey != "" {
		for _, existing := range f.Messages {
			if existing.IdempotencyKey == msg.IdempotencyKey {
				return nil
			}
		}
	}
	f.Messages = append(f.Messages, msg)
	return nil
}

// Snapshot returns a copy of recorded SMS messages for tests.
func (f *FakeSMS) Snapshot() []SMSMessage {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]SMSMessage, len(f.Messages))
	copy(out, f.Messages)
	return out
}

// NoopSMSSender discards SMS messages.
type NoopSMSSender struct{}

func (NoopSMSSender) Send(context.Context, SMSMessage) error { return nil }

// HTTPSMSSender is a production-shaped SMS HTTP client (Kavenegar-style skeleton).
type HTTPSMSSender struct {
	APIURL     string
	APIKey     string
	Sender     string
	Client     *http.Client
	MaxRetries int
	Log        *log.Logger
}

func (s *HTTPSMSSender) Send(ctx context.Context, msg SMSMessage) error {
	if strings.TrimSpace(s.APIURL) == "" {
		return errors.New("sms provider api url not configured")
	}
	if strings.TrimSpace(s.APIKey) == "" {
		return errors.New("sms provider api key not configured")
	}
	payload := map[string]any{
		"receptor":        msg.To,
		"sender":          valueOr(s.Sender, "1000"),
		"message":         msg.Body,
		"kind":            msg.Kind,
		"idempotency_key": msg.IdempotencyKey,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	retries := s.MaxRetries
	if retries < 0 {
		retries = 0
	}
	var lastErr error
	for attempt := 0; attempt <= retries; attempt++ {
		if attempt > 0 {
			if err := sleepBackoff(ctx, attempt); err != nil {
				return err
			}
		}
		lastErr = s.doSend(ctx, body, msg)
		if lastErr == nil {
			s.logf("sms send ok kind=%s to=%s idem=%s", msg.Kind, redactPhone(msg.To), msg.IdempotencyKey)
			return nil
		}
		if !retryableProviderError(lastErr) {
			break
		}
		s.logf("sms send retry kind=%s attempt=%d err=%s", msg.Kind, attempt+1, redactSecrets(lastErr.Error()))
	}
	s.logf("sms send failed kind=%s to=%s err=%s", msg.Kind, redactPhone(msg.To), redactSecrets(fmt.Sprint(lastErr)))
	return lastErr
}

func (s *HTTPSMSSender) doSend(ctx context.Context, body []byte, msg SMSMessage) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.APIURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+s.APIKey)
	if msg.IdempotencyKey != "" {
		req.Header.Set("Idempotency-Key", msg.IdempotencyKey)
	}
	resp, err := s.httpClient().Do(req)
	if err != nil {
		return fmt.Errorf("sms provider transport: %w", err)
	}
	defer resp.Body.Close()
	limited := io.LimitReader(resp.Body, maxProviderResponse)
	respBody, _ := io.ReadAll(limited)
	if resp.StatusCode >= 500 || resp.StatusCode == http.StatusTooManyRequests {
		return transientProviderError{msg: fmt.Sprintf("sms provider status %d", resp.StatusCode)}
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("sms provider status %d: %s", resp.StatusCode, redactSecrets(string(respBody)))
	}
	return nil
}

func (s *HTTPSMSSender) httpClient() *http.Client {
	if s.Client != nil {
		return s.Client
	}
	return &http.Client{Timeout: defaultProviderTimeout}
}

func (s *HTTPSMSSender) logf(format string, args ...any) {
	logger := s.Log
	if logger == nil {
		logger = log.Default()
	}
	logger.Printf(format, args...)
}

type transientProviderError struct{ msg string }

func (e transientProviderError) Error() string { return e.msg }

func retryableProviderError(err error) bool {
	if err == nil || errors.Is(err, context.Canceled) {
		return false
	}
	var transient transientProviderError
	if errors.As(err, &transient) {
		return true
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	msg := err.Error()
	return strings.Contains(msg, "provider transport")
}

func sleepBackoff(ctx context.Context, attempt int) error {
	delay := time.Duration(attempt) * 200 * time.Millisecond
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

var (
	bearerRE     = regexp.MustCompile(`(?i)(bearer\s+)[A-Za-z0-9._\-]+`)
	apiKeyRE     = regexp.MustCompile(`(?i)(api[_-]?key|token|secret|password)(=|:|"\s*:\s*")\s*["']?[^\s"',}]+`)
	queryTokenRE = regexp.MustCompile(`(?i)([?&](?:token|code|key)=)[^&\s]+`)
	longTokenRE  = regexp.MustCompile(`[A-Za-z0-9_-]{24,}`)
)

// redactSecrets strips credentials and long opaque tokens from log/error text.
func redactSecrets(value string) string {
	if value == "" {
		return value
	}
	out := bearerRE.ReplaceAllString(value, "${1}[REDACTED]")
	out = apiKeyRE.ReplaceAllString(out, "${1}[REDACTED]")
	out = queryTokenRE.ReplaceAllString(out, "${1}[REDACTED]")
	out = longTokenRE.ReplaceAllString(out, "[REDACTED]")
	return out
}

func redactEmail(email string) string {
	email = strings.TrimSpace(email)
	at := strings.LastIndex(email, "@")
	if at <= 1 {
		return "[redacted]"
	}
	return email[:1] + "***" + email[at:]
}

func redactPhone(phone string) string {
	phone = strings.TrimSpace(phone)
	if len(phone) < 4 {
		return "[redacted]"
	}
	return "***" + phone[len(phone)-4:]
}

// EmailSenderFromEnv builds the production email adapter from environment variables.
// Defaults to LocalOutbox when unset so local/dev remains safe without secrets.
func EmailSenderFromEnv() EmailSender {
	provider := strings.ToLower(strings.TrimSpace(os.Getenv("REPORT_EMAIL_PROVIDER")))
	switch provider {
	case "noop", "none", "disabled":
		return NoopEmailSender{}
	case "http", "api", "transactional":
		return newHTTPEmailSenderFromEnv()
	case "local", "outbox", "":
		if apiURL := strings.TrimSpace(os.Getenv("REPORT_EMAIL_API_URL")); apiURL != "" && strings.TrimSpace(os.Getenv("REPORT_EMAIL_API_KEY")) != "" {
			return newHTTPEmailSenderFromEnv()
		}
		return &LocalOutbox{}
	default:
		return &LocalOutbox{}
	}
}

func newHTTPEmailSenderFromEnv() *HTTPEmailSender {
	timeout := envDurationMS("REPORT_EMAIL_TIMEOUT_MS", defaultProviderTimeout)
	retries := envInt("REPORT_EMAIL_MAX_RETRIES", defaultProviderRetries)
	return &HTTPEmailSender{
		APIURL:     strings.TrimSpace(os.Getenv("REPORT_EMAIL_API_URL")),
		APIKey:     strings.TrimSpace(os.Getenv("REPORT_EMAIL_API_KEY")),
		FromEmail:  strings.TrimSpace(os.Getenv("REPORT_EMAIL_FROM")),
		FromName:   valueOr(strings.TrimSpace(os.Getenv("REPORT_EMAIL_FROM_NAME")), "Report Maker"),
		Client:     &http.Client{Timeout: timeout},
		MaxRetries: retries,
	}
}

// SMSSenderFromEnv builds the production SMS adapter from environment variables.
func SMSSenderFromEnv() SMSSender {
	provider := strings.ToLower(strings.TrimSpace(os.Getenv("REPORT_SMS_PROVIDER")))
	switch provider {
	case "noop", "none", "disabled":
		return NoopSMSSender{}
	case "http", "api", "kavenegar":
		return newHTTPSMSSenderFromEnv()
	case "fake", "local", "":
		if apiURL := strings.TrimSpace(os.Getenv("REPORT_SMS_API_URL")); apiURL != "" && strings.TrimSpace(os.Getenv("REPORT_SMS_API_KEY")) != "" {
			return newHTTPSMSSenderFromEnv()
		}
		return &FakeSMS{}
	default:
		return &FakeSMS{}
	}
}

func newHTTPSMSSenderFromEnv() *HTTPSMSSender {
	timeout := envDurationMS("REPORT_SMS_TIMEOUT_MS", defaultProviderTimeout)
	retries := envInt("REPORT_SMS_MAX_RETRIES", defaultProviderRetries)
	return &HTTPSMSSender{
		APIURL:     strings.TrimSpace(os.Getenv("REPORT_SMS_API_URL")),
		APIKey:     strings.TrimSpace(os.Getenv("REPORT_SMS_API_KEY")),
		Sender:     strings.TrimSpace(os.Getenv("REPORT_SMS_SENDER")),
		Client:     &http.Client{Timeout: timeout},
		MaxRetries: retries,
	}
}

func envInt(name string, fallback int) int {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return value
}

func envDurationMS(name string, fallback time.Duration) time.Duration {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback
	}
	ms, err := strconv.Atoi(raw)
	if err != nil || ms <= 0 {
		return fallback
	}
	return time.Duration(ms) * time.Millisecond
}
