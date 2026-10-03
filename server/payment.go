package controlplane

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type PaymentRequest struct {
	OrderID     string
	AmountRials int64
	Description string
	CallbackURL string
	Email       string
	Mobile      string
}

type PaymentResult struct {
	Authority   string
	RedirectURL string
}

type PaymentVerification struct {
	Paid      bool
	Reference string
}

type PaymentGateway interface {
	Name() string
	Start(context.Context, PaymentRequest) (PaymentResult, error)
	Verify(context.Context, string, int64) (PaymentVerification, error)
}

// DomesticGateway is the production boundary for ZarinPal/ZarinPay-style redirect gateways.
// The adapter owns provider-specific request signing and verification; the control plane owns orders.
type DomesticGateway interface{ PaymentGateway }

type DemoGateway struct{ BaseURL string }

func (g DemoGateway) Name() string { return "demo-domestic" }
func (g DemoGateway) Start(_ context.Context, request PaymentRequest) (PaymentResult, error) {
	authority := fmt.Sprintf("demo_%s_%d", request.OrderID, time.Now().UnixNano())
	target, _ := url.Parse(g.BaseURL + "/payments/" + g.Name() + "/redirect")
	query := target.Query()
	query.Set("authority", authority)
	query.Set("order", request.OrderID)
	target.RawQuery = query.Encode()
	return PaymentResult{Authority: authority, RedirectURL: target.String()}, nil
}
func (g DemoGateway) Verify(_ context.Context, authority string, _ int64) (PaymentVerification, error) {
	if authority == "" {
		return PaymentVerification{}, fmt.Errorf("missing authority")
	}
	return PaymentVerification{Paid: true, Reference: "ref_" + authority}, nil
}

// ZarinPalGateway implements PaymentGateway for ZarinPal's v4 API.
type ZarinPalGateway struct {
	MerchantID string
	BaseURL    string
	Client     *http.Client
}

func (g ZarinPalGateway) Name() string { return "zarinpal" }

func (g ZarinPalGateway) httpClient() *http.Client {
	if g.Client != nil {
		return g.Client
	}
	return &http.Client{Timeout: defaultProviderTimeout}
}

func (g ZarinPalGateway) baseURL() string {
	if strings.TrimSpace(g.BaseURL) == "" {
		return "https://api.zarinpal.com"
	}
	return strings.TrimRight(g.BaseURL, "/")
}

func (g ZarinPalGateway) Start(ctx context.Context, request PaymentRequest) (PaymentResult, error) {
	if strings.TrimSpace(g.MerchantID) == "" {
		return PaymentResult{}, fmt.Errorf("missing merchant_id")
	}
	payload := map[string]any{
		"merchant_id":  g.MerchantID,
		"amount":       request.AmountRials,
		"description":  request.Description,
		"callback_url": request.CallbackURL,
	}
	metadata := map[string]string{}
	if request.OrderID != "" {
		metadata["order_id"] = request.OrderID
	}
	if request.Email != "" {
		metadata["email"] = request.Email
	}
	if request.Mobile != "" {
		metadata["mobile"] = request.Mobile
	}
	if len(metadata) > 0 {
		payload["metadata"] = metadata
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return PaymentResult{}, err
	}
	endpoint := g.baseURL() + "/pg/v4/payment/request.json"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return PaymentResult{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	resp, err := g.httpClient().Do(req)
	if err != nil {
		return PaymentResult{}, fmt.Errorf("zarinpal request transport: %w", err)
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(io.LimitReader(resp.Body, maxProviderResponse))
	if err != nil {
		return PaymentResult{}, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return PaymentResult{}, fmt.Errorf("zarinpal request failed: status %d body %s", resp.StatusCode, redactSecrets(string(respBody)))
	}
	var parsed struct {
		Data struct {
			Code      int    `json:"code"`
			Message   string `json:"message"`
			Authority string `json:"authority"`
		} `json:"data"`
		Errors json.RawMessage `json:"errors"`
	}
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return PaymentResult{}, fmt.Errorf("invalid zarinpal response: %w", err)
	}
	if parsed.Data.Code != 100 {
		return PaymentResult{}, fmt.Errorf("zarinpal request failed: code %d message %s errors %s", parsed.Data.Code, redactSecrets(parsed.Data.Message), redactSecrets(string(parsed.Errors)))
	}
	if strings.TrimSpace(parsed.Data.Authority) == "" {
		return PaymentResult{}, fmt.Errorf("zarinpal request missing authority")
	}
	redirect := g.baseURL() + "/pg/StartPay/" + parsed.Data.Authority
	return PaymentResult{Authority: parsed.Data.Authority, RedirectURL: redirect}, nil
}

func (g ZarinPalGateway) Verify(ctx context.Context, authority string, amount int64) (PaymentVerification, error) {
	if strings.TrimSpace(g.MerchantID) == "" {
		return PaymentVerification{}, fmt.Errorf("missing merchant_id")
	}
	if strings.TrimSpace(authority) == "" {
		return PaymentVerification{}, fmt.Errorf("missing authority")
	}
	payload := map[string]any{
		"merchant_id": g.MerchantID,
		"amount":      amount,
		"authority":   authority,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return PaymentVerification{}, err
	}
	endpoint := g.baseURL() + "/pg/v4/payment/verify.json"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return PaymentVerification{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	resp, err := g.httpClient().Do(req)
	if err != nil {
		return PaymentVerification{}, fmt.Errorf("zarinpal verify transport: %w", err)
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(io.LimitReader(resp.Body, maxProviderResponse))
	if err != nil {
		return PaymentVerification{}, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return PaymentVerification{}, fmt.Errorf("zarinpal verify failed: status %d body %s", resp.StatusCode, redactSecrets(string(respBody)))
	}
	var parsed struct {
		Data struct {
			Code    int             `json:"code"`
			Message string          `json:"message"`
			RefID   json.RawMessage `json:"ref_id"`
		} `json:"data"`
		Errors json.RawMessage `json:"errors"`
	}
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return PaymentVerification{}, fmt.Errorf("invalid zarinpal verify response: %w", err)
	}
	if parsed.Data.Code != 100 && parsed.Data.Code != 101 {
		return PaymentVerification{}, fmt.Errorf("zarinpal verify failed: code %d message %s errors %s", parsed.Data.Code, redactSecrets(parsed.Data.Message), redactSecrets(string(parsed.Errors)))
	}
	ref := ""
	if len(parsed.Data.RefID) > 0 && string(parsed.Data.RefID) != "null" {
		var asString string
		if err := json.Unmarshal(parsed.Data.RefID, &asString); err == nil {
			ref = asString
		} else {
			var asInt int64
			if err := json.Unmarshal(parsed.Data.RefID, &asInt); err == nil {
				ref = fmt.Sprintf("%d", asInt)
			} else {
				ref = strings.Trim(string(parsed.Data.RefID), `"`)
			}
		}
	}
	return PaymentVerification{Paid: true, Reference: ref}, nil
}
