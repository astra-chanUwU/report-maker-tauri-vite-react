package controlplane

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestZarinPalStartAndVerify(t *testing.T) {
	var requests []map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("method = %s, want POST", r.Method)
		}
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		requests = append(requests, payload)
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/pg/v4/payment/request.json":
			if payload["merchant_id"] != "merchant-test" || payload["amount"] != float64(1250000) {
				t.Fatalf("unexpected request payload: %#v", payload)
			}
			metadata, ok := payload["metadata"].(map[string]any)
			if !ok || metadata["order_id"] != "ord_123" || metadata["email"] != "buyer@example.com" || metadata["mobile"] != "09120000000" {
				t.Fatalf("unexpected metadata: %#v", payload["metadata"])
			}
			_, _ = w.Write([]byte(`{"data":{"code":100,"authority":"A-test-authority"},"errors":[]}`))
		case "/pg/v4/payment/verify.json":
			if payload["authority"] != "A-test-authority" {
				t.Fatalf("unexpected verify payload: %#v", payload)
			}
			_, _ = w.Write([]byte(`{"data":{"code":100,"ref_id":987654},"errors":[]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	gateway := ZarinPalGateway{MerchantID: "merchant-test", BaseURL: server.URL, Client: server.Client()}
	started, err := gateway.Start(context.Background(), PaymentRequest{
		OrderID: "ord_123", AmountRials: 1250000, Description: "Report Maker", CallbackURL: "https://reportmaker.ir/payments/zarinpal/callback", Email: "buyer@example.com", Mobile: "09120000000",
	})
	if err != nil {
		t.Fatal(err)
	}
	if started.Authority != "A-test-authority" || started.RedirectURL != server.URL+"/pg/StartPay/A-test-authority" {
		t.Fatalf("unexpected payment result: %#v", started)
	}
	verified, err := gateway.Verify(context.Background(), started.Authority, 1250000)
	if err != nil || !verified.Paid || verified.Reference != "987654" {
		t.Fatalf("unexpected verification: %#v, err=%v", verified, err)
	}
	if len(requests) != 2 {
		t.Fatalf("request count = %d, want 2", len(requests))
	}
}

func TestZarinPalAlreadyVerifiedIsPaid(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"code":101,"ref_id":"already-verified"},"errors":[]}`))
	}))
	defer server.Close()

	verified, err := (ZarinPalGateway{MerchantID: "merchant-test", BaseURL: server.URL, Client: server.Client()}).Verify(context.Background(), "A-test-authority", 1000)
	if err != nil || !verified.Paid || verified.Reference != "already-verified" {
		t.Fatalf("unexpected repeated verification: %#v, err=%v", verified, err)
	}
}

func TestZarinPalRejectsFailedCodes(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"code":-9,"message":"failed"},"errors":[]}`))
	}))
	defer server.Close()

	_, err := (ZarinPalGateway{MerchantID: "merchant-test", BaseURL: server.URL, Client: server.Client()}).Verify(context.Background(), "A-test-authority", 1000)
	if err == nil || !strings.Contains(err.Error(), "code -9") {
		t.Fatalf("expected provider failure, got %v", err)
	}
}
