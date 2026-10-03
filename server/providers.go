package controlplane

import (
	"context"
	"regexp"
	"sync"
)

// Email message kinds used across receipts, auth, and license access.
const (
	EmailKindReceipt        = "receipt"
	EmailKindLicenseAccess  = "license_access"
	EmailKindMagicLink      = "magic_link"
	EmailKindDownloadAccess = "download_access"
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

var (
	bearerRE     = regexp.MustCompile(`(?i)(bearer\s+)[a-z0-9._\-]+`)
	apiKeyRE     = regexp.MustCompile(`(?i)(api[_-]?key["']?\s*[:=]\s*["']?)[a-z0-9._\-]+`)
	queryTokenRE = regexp.MustCompile(`(?i)([?&](?:token|key|secret|code)=)[^&\s]+`)
	longTokenRE  = regexp.MustCompile(`\b[A-Za-z0-9_-]{32,}\b`)
	licenseKeyRE = regexp.MustCompile(`\bRM-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}\b`)
)

func redactSecrets(value string) string {
	if value == "" {
		return value
	}
	out := bearerRE.ReplaceAllString(value, "${1}[REDACTED]")
	out = apiKeyRE.ReplaceAllString(out, "${1}[REDACTED]")
	out = queryTokenRE.ReplaceAllString(out, "${1}[REDACTED]")
	out = licenseKeyRE.ReplaceAllString(out, "[REDACTED_LICENSE]")
	out = longTokenRE.ReplaceAllString(out, "[REDACTED]")
	return out
}

type SMSMessage struct {
	To, Body string
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
	f.Messages = append(f.Messages, msg)
	return nil
}
