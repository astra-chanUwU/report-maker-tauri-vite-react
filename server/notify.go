package controlplane

import (
	"context"
	"fmt"
	"log"
	"strings"
)

// LicenseNotifyMeta carries license fields safe to include in customer email.
// Raw signing keys, delivery AES keys, and plaintext license keys must never
// be placed here — use DeliveryHint for a masked reference only.
type LicenseNotifyMeta struct {
	LicenseID string
	Plan      string
	// DeliveryHint is a customer-visible masked license reference.
	DeliveryHint string
}

// NotifyLicenseIssued sends license-access email after a license is provisioned.
// Body and logs must not contain the plaintext license key or secrets in URLs.
// C04 will keep this wired as the canonical post-provision notify path.
func (a *App) NotifyLicenseIssued(ctx context.Context, customer *Customer, order *Order, licenseMeta LicenseNotifyMeta) error {
	if a == nil || a.email == nil {
		return nil
	}
	to := ""
	if customer != nil {
		to = strings.TrimSpace(customer.Email)
	}
	if to == "" && order != nil {
		to = strings.TrimSpace(order.Email)
	}
	if to == "" {
		return fmt.Errorf("license email recipient missing")
	}
	orderID := ""
	plan := licenseMeta.Plan
	if order != nil {
		orderID = order.ID
		if plan == "" {
			plan = order.Plan
		}
	}
	hint := strings.TrimSpace(licenseMeta.DeliveryHint)
	if hint == "" {
		hint = "Sign in to your account to view license access details."
	}
	accountURL := strings.TrimRight(a.cfg.PublicBaseURL, "/") + "/account/purchases"
	body := fmt.Sprintf(
		"Your Report Maker license is ready.\n\nOrder ID: %s\nLicense ID: %s\nPlan: %s\nLicense reference: %s\n\nSign in at %s to reveal your full license key. Do not share this email publicly.\n",
		orderID, licenseMeta.LicenseID, plan, hint, accountURL,
	)
	key := licenseMeta.LicenseID
	if key == "" {
		key = orderID
	}
	err := a.email.Send(ctx, EmailMessage{
		To: to, Subject: "Your Report Maker license access",
		Body: body, Kind: EmailKindLicenseAccess,
		OrderID: orderID, LicenseID: licenseMeta.LicenseID,
		IdempotencyKey: "license_access:" + key,
	})
	if err != nil {
		log.Printf("license email failed order=%s license=%s err=%s", orderID, licenseMeta.LicenseID, redactSecrets(err.Error()))
	}
	return err
}

// afterLicenseProvisioned is the S02/C03 post-provision hook.
// Email failures are logged only and must not roll back payment or license state.
func (a *App) afterLicenseProvisioned(ctx context.Context, fulfilled *FulfillResult) {
	if a == nil || fulfilled == nil || fulfilled.Order == nil {
		return
	}
	var customer *Customer
	if fulfilled.Order.CustomerID != "" {
		if c, ok := a.store.GetCustomer(fulfilled.Order.CustomerID); ok {
			customer = c
		}
	}
	licenseID := ""
	plan := fulfilled.Order.Plan
	if fulfilled.License != nil {
		licenseID = fulfilled.License.ID
		if fulfilled.License.Plan != "" {
			plan = fulfilled.License.Plan
		}
	}
	hint := MaskLicenseKey(fulfilled.LicenseKey)
	if hint == "" {
		hint = "Sign in to your account to view license access details."
	}
	// C04: NotifyLicenseIssued — keep this call site when merging S04 outbox/adapters.
	_ = a.NotifyLicenseIssued(ctx, customer, fulfilled.Order, LicenseNotifyMeta{
		LicenseID:    licenseID,
		Plan:         plan,
		DeliveryHint: hint,
	})
}
