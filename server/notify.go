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

// notifyAfterPaidOrder is the paymentCallback hook for S04/S02 delivery mail.
// Order payment must already be committed. Email failures are logged only.
//
// S02 HOOK: when license provisioning exists, call NotifyLicenseIssued after
// issuing the license (preferably from the license-issue function). Until then,
// this helper sends receipt-only unless a license ID is already known.
func (a *App) notifyAfterPaidOrder(ctx context.Context, order *Order) {
	if a == nil || order == nil {
		return
	}
	var customer *Customer
	if order.CustomerID != "" {
		if c, ok := a.store.GetCustomer(order.CustomerID); ok {
			customer = c
		}
	}
	_ = a.NotifyPurchaseReceipt(ctx, customer, order)
	// License mail is owned by S02 provisioning. Leave a clearly marked extension
	// point: if a future FindLicenseByOrder appears, call NotifyLicenseIssued here.
	_ = customer
}
