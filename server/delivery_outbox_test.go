package controlplane

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"
)

type outboxFailingEmailSender struct{ calls int }

func (f *outboxFailingEmailSender) Send(context.Context, EmailMessage) error {
	f.calls++
	return errors.New("email provider transport: simulated outage")
}

type outboxCountingEmailSender struct{ calls int }

func (c *outboxCountingEmailSender) Send(context.Context, EmailMessage) error {
	c.calls++
	return nil
}

func TestDeliveryOutboxSurvivesReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "outbox.db")
	store, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	fail := &outboxFailingEmailSender{}
	sender := wrapPersistentEmail(store, fail).(*persistentEmailSender)
	sender.maxAttempts = 5
	msg := EmailMessage{
		To: "user@example.com", Subject: "Test", Body: "Body", Kind: EmailKindReceipt,
		OrderID: "ord_test", IdempotencyKey: "receipt:ord_test",
	}
	if err := sender.Send(context.Background(), msg); err == nil {
		t.Fatal("expected failing provider error")
	}
	store.Close()

	store2, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store2.Close()
	pending, err := store2.ListPendingDeliveries(10)
	if err != nil {
		t.Fatal(err)
	}
	if len(pending) != 1 {
		t.Fatalf("pending rows after reopen = %d want 1", len(pending))
	}
	if pending[0].Status != deliveryStatusPending {
		t.Fatalf("expected pending status, got %s", pending[0].Status)
	}
}

func TestDeliveryOutboxRetryOnFailure(t *testing.T) {
	store, err := OpenStore(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	underlying := &outboxFailingEmailSender{}
	sender := wrapPersistentEmail(store, underlying).(*persistentEmailSender)
	sender.maxAttempts = 3

	msg := EmailMessage{
		To: "user@example.com", Subject: "Retry", Body: "Body", Kind: EmailKindReceipt,
		OrderID: "ord_retry", IdempotencyKey: "receipt:ord_retry",
	}
	if err := sender.Send(context.Background(), msg); err == nil {
		t.Fatal("expected send error from failing provider")
	}
	row, ok, err := store.findDeliveryByIdempotency(deliveryChannelEmail, msg.IdempotencyKey)
	if err != nil || !ok {
		t.Fatalf("missing row: ok=%v err=%v", ok, err)
	}
	if row.Status != deliveryStatusPending || row.AttemptCount != 1 {
		t.Fatalf("expected pending after first failure: %+v", row)
	}

	counter := &outboxCountingEmailSender{}
	sender.underlying = counter
	if err := sender.dispatch(context.Background(), row); err != nil {
		t.Fatalf("dispatch success: %v", err)
	}
	row, ok, _ = store.findDeliveryByIdempotency(deliveryChannelEmail, msg.IdempotencyKey)
	if !ok || row.Status != deliveryStatusSent {
		t.Fatalf("expected sent after retry: %+v", row)
	}
}

func TestDeliveryOutboxIdempotency(t *testing.T) {
	store, err := OpenStore(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	counter := &outboxCountingEmailSender{}
	sender := wrapPersistentEmail(store, counter)
	msg := EmailMessage{
		To: "user@example.com", Subject: "Once", Body: "Body", Kind: EmailKindReceipt,
		IdempotencyKey: "receipt:ord_once",
	}
	if err := sender.Send(context.Background(), msg); err != nil {
		t.Fatal(err)
	}
	if err := sender.Send(context.Background(), msg); err != nil {
		t.Fatal(err)
	}
	if counter.calls != 1 {
		t.Fatalf("underlying send calls = %d want 1", counter.calls)
	}
}

func TestEmailSenderFromEnvProviders(t *testing.T) {
	t.Setenv("REPORT_EMAIL_PROVIDER", "smtp")
	t.Setenv("REPORT_SMTP_HOST", "mail.example.ir")
	if _, ok := EmailSenderFromEnv(true).(*SMTPEmailSender); !ok {
		t.Fatal("expected SMTPEmailSender")
	}
	t.Setenv("REPORT_EMAIL_PROVIDER", "outbox")
	if EmailSenderFromEnv(false) != nil {
		t.Fatal("outbox mode should return nil underlying sender")
	}
	t.Setenv("REPORT_SMS_PROVIDER", "kavenegar")
	t.Setenv("REPORT_SMS_API_KEY", "test-key")
	if _, ok := SMSSenderFromEnv(true).(*KavenegarSMSSender); !ok {
		t.Fatal("expected KavenegarSMSSender")
	}
}

func TestRedactSecretsInDeliveryErrors(t *testing.T) {
	raw := "Authorization: Bearer super-secret-token-abcdefghijklmnopqrstuvwxyz"
	redacted := redactSecrets(raw)
	if strings.Contains(redacted, "super-secret") {
		t.Fatalf("secret leaked in redaction: %q", redacted)
	}
	if !strings.Contains(redacted, "[REDACTED]") {
		t.Fatalf("expected redaction marker: %q", redacted)
	}
}

func TestExplicitFakesSkipPersistentWrap(t *testing.T) {
	cfg := Config{
		SigningKeyID: "test-key", LeaseDays: 30, AllowDevSeed: false,
		PublicBaseURL: "http://example.test", LicenseDeliveryKey: testDeliveryKey(t),
		Gateway: DemoGateway{}, EmailSender: &LocalOutbox{}, SMSSender: &FakeSMS{},
	}
	app, err := NewApp(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer app.Close()
	if _, ok := app.email.(*LocalOutbox); !ok {
		t.Fatalf("expected LocalOutbox without persistent wrap, got %T", app.email)
	}
	if _, ok := app.sms.(*FakeSMS); !ok {
		t.Fatalf("expected FakeSMS without persistent wrap, got %T", app.sms)
	}
}
