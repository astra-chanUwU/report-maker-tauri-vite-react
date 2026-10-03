package controlplane

import (
	"context"
	"fmt"
	"log"
	"strings"
)

// LicenseNotifyMeta carries license fields safe to include in customer email.
// Raw signing keys and password hashes must never be placed here.
type LicenseNotifyMeta struct {
	LicenseID string
	Plan      string
	// DeliveryHint is a customer-visible license reference (e.g. masked key prefix).
	// Prefer a non-secret identifier until S02 defines recoverable delivery data.
	DeliveryHint string
}

// NotifyPurchaseReceipt sends a paid-order receipt. Failures are returned to the
// caller but must not roll back order payment state.
func (a *App) NotifyPurchaseReceipt(ctx context.Context, customer *Customer, order *Order) error {
	if a == nil || a.email == nil || order == nil {
		return nil
	}
	to := strings.TrimSpace(order.Email)
	if customer != nil && strings.TrimSpace(customer.Email) != "" {
		to = strings.TrimSpace(customer.Email)
	}
	if to == "" {
		return fmt.Errorf("receipt recipient missing for order %s", order.ID)
	}
	name := strings.TrimSpace(order.FirstName + " " + order.LastName)
	if customer != nil {
		if n := strings.TrimSpace(customer.FirstName + " " + customer.LastName); n != "" {
			name = n
		}
	}
	body := fmt.Sprintf(
		"Hello %s,\n\nWe received your payment for Report Maker (%s).\nOrder ID: %s\nAmount (rials): %d\nPayment reference: %s\n\nKeep this receipt for support.\n",
		valueOr(name, "customer"), order.Plan, order.ID, order.AmountRials, order.PaymentRef,
	)
	err := a.email.Send(ctx, EmailMessage{
		To: to, Subject: "Report Maker purchase receipt",
		Body: body, Kind: EmailKindReceipt,
		OrderID: order.ID, IdempotencyKey: "receipt:" + order.ID,
	})
	if err != nil {
		log.Printf("receipt email failed order=%s err=%s", order.ID, redactSecrets(err.Error()))
	}
	return err
}

// NotifyLicenseIssued sends license-access email after a license is provisioned.
// S02 should call this from the license-issue path. paymentCallback may call it
// when a license is already associated; otherwise receipt-only is sent.
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
	body := fmt.Sprintf(
		"Your Report Maker license is ready.\n\nOrder ID: %s\nLicense ID: %s\nPlan: %s\n\n%s\n",
		orderID, licenseMeta.LicenseID, plan, hint,
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

// NotifyDownloadAccess sends a download-access message (stub until S03 wires artifacts).
func (a *App) NotifyDownloadAccess(ctx context.Context, customer *Customer, order *Order, downloadURL string) error {
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
		return fmt.Errorf("download email recipient missing")
	}
	orderID := ""
	if order != nil {
		orderID = order.ID
	}
	link := strings.TrimSpace(downloadURL)
	if link == "" {
		link = a.cfg.PublicBaseURL + "/download"
	}
	body := fmt.Sprintf(
		"Your Report Maker download is available.\n\nOrder ID: %s\nDownload: %s\n\nLinks may be renewed after sign-in.\n",
		orderID, link,
	)
	err := a.email.Send(ctx, EmailMessage{
		To: to, Subject: "Report Maker download access",
		Body: body, Kind: EmailKindDownloadAccess,
		OrderID: orderID, IdempotencyKey: "download_access:" + orderID,
	})
	if err != nil {
		log.Printf("download email failed order=%s err=%s", orderID, redactSecrets(err.Error()))
	}
	return err
}

// notifyAfterPaidOrder sends receipt and license/download mail after payment fulfillment.
// Order payment and license provisioning must already be committed. Email failures are logged only.
func (a *App) notifyAfterPaidOrder(ctx context.Context, fulfilled *FulfillResult) {
	if a == nil || fulfilled == nil || fulfilled.Order == nil {
		return
	}
	order := fulfilled.Order
	var customer *Customer
	if order.CustomerID != "" {
		if c, ok := a.store.GetCustomer(order.CustomerID); ok {
			customer = c
		}
	}
	_ = a.NotifyPurchaseReceipt(ctx, customer, order)
	if fulfilled.License != nil && order.LicenseID != "" {
		hint := MaskLicenseKey(fulfilled.LicenseKey)
		if hint == "" {
			hint = "Sign in to your account to view license access details."
		}
		_ = a.NotifyLicenseIssued(ctx, customer, order, LicenseNotifyMeta{
			LicenseID: order.LicenseID, Plan: fulfilled.License.Plan, DeliveryHint: hint,
		})
		if entitled, ok := a.store.CustomerDownloadEntitlement(order.CustomerID); ok && entitled.LicenseID != "" {
			_ = a.NotifyDownloadAccess(ctx, customer, order, a.cfg.PublicBaseURL+"/account/downloads")
		}
	}
}
