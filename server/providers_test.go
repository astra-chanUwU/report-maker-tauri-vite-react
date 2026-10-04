package controlplane

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type failingEmailSender struct {
	err   error
	calls atomic.Int32
}

func (f *failingEmailSender) Send(context.Context, EmailMessage) error {
	f.calls.Add(1)
	if f.err != nil {
		return f.err
	}
	return errors.New("email provider unavailable")
}

func TestLocalOutboxIdempotencyAndKinds(t *testing.T) {
	outbox := &LocalOutbox{}
	msg := EmailMessage{
		To: "buyer@example.com", Subject: "Receipt", Body: "Order ord_1 paid",
		Kind: EmailKindReceipt, OrderID: "ord_1", IdempotencyKey: "receipt:ord_1",
	}
	if err := outbox.Send(context.Background(), msg); err != nil {
		t.Fatal(err)
	}
	if err := outbox.Send(context.Background(), msg); err != nil {
		t.Fatal(err)
	}
	got := outbox.Snapshot()
	if len(got) != 1 {
		t.Fatalf("messages=%d, want 1 after idempotent retry", len(got))
	}
	if got[0].Kind != EmailKindReceipt || got[0].To != "buyer@example.com" || got[0].OrderID != "ord_1" {
		t.Fatalf("unexpected message: %#v", got[0])
	}
}

func TestNotifyPurchaseReceiptAndLicenseAccess(t *testing.T) {
	outbox := &LocalOutbox{}
	app, err := NewApp(Config{
		SigningKeyID: "test-key", LeaseDays: 30, PublicBaseURL: "http://example.test",
		EmailSender: outbox, SMSSender: &FakeSMS{},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = app.Close() })

	now := time.Now().UTC()
	customer := &Customer{ID: "cus_1", FirstName: "Ada", LastName: "Lovelace", Email: "ada@example.com", CreatedAt: now, UpdatedAt: now}
	order := &Order{ID: "ord_42", CustomerID: customer.ID, Plan: "perpetual", Email: customer.Email, AmountRials: 1250000, Status: "paid", PaymentRef: "ref_1", PaidAt: &now, CreatedAt: now}

	if err := app.NotifyPurchaseReceipt(context.Background(), customer, order); err != nil {
		t.Fatal(err)
	}
	if err := app.NotifyLicenseIssued(context.Background(), customer, order, LicenseNotifyMeta{
		LicenseID: "lic_9", Plan: "perpetual", DeliveryHint: "License reference lic_9",
	}); err != nil {
		t.Fatal(err)
	}
	if err := app.NotifyDownloadAccess(context.Background(), customer, order, "http://example.test/download?token=super-secret-download-token-value"); err != nil {
		t.Fatal(err)
	}

	msgs := outbox.Snapshot()
	if len(msgs) != 3 {
		t.Fatalf("messages=%d, want 3", len(msgs))
	}
	byKind := map[string]EmailMessage{}
	for _, m := range msgs {
		byKind[m.Kind] = m
	}
	receipt := byKind[EmailKindReceipt]
	if receipt.To != "ada@example.com" || receipt.OrderID != "ord_42" || !strings.Contains(receipt.Body, "ord_42") {
		t.Fatalf("receipt mismatch: %#v", receipt)
	}
	license := byKind[EmailKindLicenseAccess]
	if license.LicenseID != "lic_9" || license.OrderID != "ord_42" || !strings.Contains(license.Body, "lic_9") {
		t.Fatalf("license mismatch: %#v", license)
	}
	download := byKind[EmailKindDownloadAccess]
	if download.OrderID != "ord_42" || download.Kind != EmailKindDownloadAccess {
		t.Fatalf("download mismatch: %#v", download)
	}
}

func TestPaymentCallbackSendsReceiptAndSurvivesEmailOutage(t *testing.T) {
	t.Run("receipt on paid", func(t *testing.T) {
		outbox := &LocalOutbox{}
		app, server := testPaidCallbackApp(t, outbox)
		order := seedPendingOrder(t, app, "ord_ok", "cus_ok", "ok@example.com")
		resp, err := server.Client().Get(server.URL + "/payments/demo-domestic/callback?authority=" + url.QueryEscape(order.Authority) + "&order=" + order.ID + "&status=OK")
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("status=%d body=%s", resp.StatusCode, body)
		}
		paid, ok := app.store.GetOrder(order.ID)
		if !ok || paid.Status != "paid" {
			t.Fatalf("order not paid: %#v", paid)
		}
		msgs := outbox.Snapshot()
		if len(msgs) != 3 {
			t.Fatalf("expected receipt, license, and download emails: %#v", msgs)
		}
		byKind := map[string]EmailMessage{}
		for _, msg := range msgs {
			byKind[msg.Kind] = msg
		}
		receipt := byKind[EmailKindReceipt]
		if receipt.To != "ok@example.com" || receipt.OrderID != order.ID {
			t.Fatalf("receipt outbox mismatch: %#v", receipt)
		}
		if license := byKind[EmailKindLicenseAccess]; license.OrderID != order.ID || license.LicenseID == "" {
			t.Fatalf("license email missing after provisioning: %#v", license)
		}
		if download := byKind[EmailKindDownloadAccess]; download.OrderID != order.ID {
			t.Fatalf("download email missing after provisioning: %#v", download)
		}
	})

	t.Run("provider outage keeps paid order", func(t *testing.T) {
		failing := &failingEmailSender{err: errors.New("smtp timeout")}
		app, server := testPaidCallbackApp(t, failing)
		order := seedPendingOrder(t, app, "ord_down", "cus_down", "down@example.com")
		resp, err := server.Client().Get(server.URL + "/payments/demo-domestic/callback?authority=" + url.QueryEscape(order.Authority) + "&order=" + order.ID + "&status=OK")
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("status=%d", resp.StatusCode)
		}
		paid, ok := app.store.GetOrder(order.ID)
		if !ok || paid.Status != "paid" || paid.PaymentRef == "" {
			t.Fatalf("order must remain recoverable as paid after email outage: %#v ok=%v", paid, ok)
		}
		if failing.calls.Load() < 1 {
			t.Fatal("expected email send attempt")
		}
	})
}

func TestRedactSecretsOmitsTokensAndKeys(t *testing.T) {
	raw := `Authorization: Bearer super-secret-api-key-value-123456 email?token=abcdef0123456789abcdef0123456789 api_key=KAVENEGAR_SECRET_VALUE_XYZ`
	got := redactSecrets(raw)
	if strings.Contains(got, "super-secret-api-key-value-123456") || strings.Contains(got, "abcdef0123456789") || strings.Contains(got, "KAVENEGAR_SECRET_VALUE_XYZ") {
		t.Fatalf("secrets leaked in redacted output: %q", got)
	}
	if !strings.Contains(got, "[REDACTED]") {
		t.Fatalf("expected redaction markers: %q", got)
	}
}

func TestHTTPEmailSenderTimeoutRetriesAndRedactedLogs(t *testing.T) {
	var hits atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		auth := r.Header.Get("Authorization")
		if !strings.HasPrefix(auth, "Bearer ") {
			t.Fatalf("missing bearer auth")
		}
		if r.Header.Get("Idempotency-Key") != "receipt:ord_http" {
			t.Fatalf("missing idempotency header: %q", r.Header.Get("Idempotency-Key"))
		}
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(`{"error":"Bearer live-provider-secret-should-not-appear"}`))
	}))
	t.Cleanup(server.Close)

	var logBuf bytes.Buffer
	sender := &HTTPEmailSender{
		APIURL: server.URL, APIKey: "live-provider-secret-should-not-appear",
		FromEmail: "noreply@example.test", Client: server.Client(), MaxRetries: 1,
		Log: log.New(&logBuf, "", 0),
	}
	err := sender.Send(context.Background(), EmailMessage{
		To: "buyer@example.com", Subject: "Receipt", Body: "paid",
		Kind: EmailKindReceipt, OrderID: "ord_http", IdempotencyKey: "receipt:ord_http",
	})
	if err == nil {
		t.Fatal("expected provider error")
	}
	if hits.Load() != 2 {
		t.Fatalf("hits=%d, want 2 (initial + 1 retry)", hits.Load())
	}
	logs := logBuf.String()
	if strings.Contains(logs, "live-provider-secret-should-not-appear") {
		t.Fatalf("api key leaked into logs: %q", logs)
	}
	if strings.Contains(logs, "Bearer live-provider") {
		t.Fatalf("bearer token leaked into logs: %q", logs)
	}
}

func TestHTTPSMSSenderRedactsAndFakeSMSKinds(t *testing.T) {
	fake := &FakeSMS{}
	if err := fake.Send(context.Background(), SMSMessage{
		To: "09120000000", Body: "Your Report Maker verification code is 123456",
		Kind: SMSKindPhoneVerify, IdempotencyKey: "phone_verify:phc_1",
	}); err != nil {
		t.Fatal(err)
	}
	if err := fake.Send(context.Background(), SMSMessage{
		To: "09120000000", Body: "retry", Kind: SMSKindPhoneVerify, IdempotencyKey: "phone_verify:phc_1",
	}); err != nil {
		t.Fatal(err)
	}
	msgs := fake.Snapshot()
	if len(msgs) != 1 || msgs[0].Kind != SMSKindPhoneVerify {
		t.Fatalf("unexpected fake sms: %#v", msgs)
	}

	var hits atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"return":{"status":200}}`))
	}))
	t.Cleanup(server.Close)
	var logBuf bytes.Buffer
	sms := &HTTPSMSSender{
		APIURL: server.URL, APIKey: "sms-secret-key-value-abcdefgh", Sender: "1000",
		Client: server.Client(), MaxRetries: 0, Log: log.New(&logBuf, "", 0),
	}
	if err := sms.Send(context.Background(), SMSMessage{
		To: "09123334444", Body: "code 654321", Kind: SMSKindPhoneRecovery, IdempotencyKey: "phone_recovery:1",
	}); err != nil {
		t.Fatal(err)
	}
	if hits.Load() != 1 {
		t.Fatalf("hits=%d", hits.Load())
	}
	if strings.Contains(logBuf.String(), "sms-secret-key-value-abcdefgh") || strings.Contains(logBuf.String(), "654321") {
		t.Fatalf("sms secret or code leaked: %q", logBuf.String())
	}
	if !strings.Contains(logBuf.String(), "phone_recovery") {
		t.Fatalf("expected kind in logs: %q", logBuf.String())
	}
}

func TestMagicLinkKindUsesEmailInterface(t *testing.T) {
	app, server, outbox := testAppWithOutbox(t, false)
	now := time.Now().UTC()
	if err := app.store.PutCustomer(&Customer{ID: "cus_ml", Email: "ml@example.com", CreatedAt: now, UpdatedAt: now}); err != nil {
		t.Fatal(err)
	}
	client := server.Client()
	token, cookies := fetchCSRF(t, client, server.URL)
	form := url.Values{"email": {"ml@example.com"}, "csrf_token": {token}}
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
	msgs := outbox.Snapshot()
	if len(msgs) != 1 || msgs[0].Kind != EmailKindMagicLink || msgs[0].To != "ml@example.com" {
		t.Fatalf("magic link message mismatch: %#v", msgs)
	}
	if msgs[0].IdempotencyKey == "" || !strings.HasPrefix(msgs[0].IdempotencyKey, "magic_link:") {
		t.Fatalf("expected magic_link idempotency key: %#v", msgs[0])
	}
}

func testPaidCallbackApp(t *testing.T, email EmailSender) (*App, *httptest.Server) {
	t.Helper()
	cfg := Config{
		SigningKeyID: "test-key", LeaseDays: 30, AllowDevSeed: true,
		PublicBaseURL: "http://example.test", EmailSender: email, SMSSender: &FakeSMS{},
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
	return app, server
}

func seedPendingOrder(t *testing.T, app *App, orderID, customerID, email string) *Order {
	t.Helper()
	now := time.Now().UTC()
	if err := app.store.PutCustomer(&Customer{ID: customerID, Email: email, FirstName: "Test", LastName: "User", Phone: "09120000000", CreatedAt: now, UpdatedAt: now}); err != nil {
		t.Fatal(err)
	}
	order := &Order{
		ID: orderID, CustomerID: customerID, Plan: "perpetual", FirstName: "Test", LastName: "User",
		Email: email, Phone: "09120000000", AmountRials: 1250000, Authority: "demo_" + orderID, Status: "pending", CreatedAt: now,
	}
	if err := app.store.PutOrder(order); err != nil {
		t.Fatal(err)
	}
	return order
}
