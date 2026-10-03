package controlplane

import ("strings"; "time")

type AdminPaymentAttemptView struct{ ID, Provider, AuthorityHint, Reference, Status, CreatedAt, VerifiedAt string; AmountRials int64 }
type AdminDeliveryView struct{ ID, Channel, ToAddress, Subject, Kind, Status, LastError, CreatedAt, SentAt string; AttemptCount int }
type AdminDownloadView struct{ ID, Artifact, CreatedAt string }
type AdminActivationView struct{ ID, Platform, AppVersion, DeviceKeyHint, Status, CreatedAt, LastSeen, RevokedAt string }
type AdminSupportNoteView struct{ ID, AdminSessionHint, Body, CreatedAt string }
type AdminAuditView struct{ ID, Action, TargetType, TargetID, Detail, CreatedAt string }
type AdminLicenseView struct{ ID, Plan, Status, CreatedAt string; MaxDevices, ActiveDevices int }
type AdminOrderView struct {
	OrderID, CustomerID, Plan, Status, FirstName, LastName, Email, Phone string
	AmountRials int64; AuthorityHint, PaymentRef, CreatedAt, PaidAt string
	License *AdminLicenseView; Payments []AdminPaymentAttemptView; Deliveries []AdminDeliveryView
	Downloads []AdminDownloadView; Activations []AdminActivationView; SupportNotes []AdminSupportNoteView; AuditLog []AdminAuditView
}

func truncateOpaque(v string, k int) string { v = strings.TrimSpace(v); if k <= 0 || len(v) <= k { return v }; return v[:k] + "…" }
func formatAdminTime(t time.Time) string { if t.IsZero() { return "" }; return t.UTC().Format("2006-01-02 15:04 UTC") }
func formatAdminTimePtr(t *time.Time) string { if t == nil { return "" }; return formatAdminTime(*t) }
func buildAdminSearchHits(h []AdminOrderSearchHit) []AdminOrderSearchHit { return h }

func buildAdminOrderView(store *Store, order *Order) (*AdminOrderView, error) {
	if order == nil { return nil, nil }
	v := &AdminOrderView{OrderID: order.ID, CustomerID: order.CustomerID, Plan: order.Plan, Status: order.Status, FirstName: order.FirstName, LastName: order.LastName, Email: order.Email, Phone: order.Phone, AmountRials: order.AmountRials, AuthorityHint: truncateOpaque(order.Authority, 12), PaymentRef: order.PaymentRef, CreatedAt: formatAdminTime(order.CreatedAt), PaidAt: formatAdminTimePtr(order.PaidAt)}
	if order.LicenseID != "" { if lic, ok := store.FindLicenseByID(order.LicenseID); ok { v.License = &AdminLicenseView{ID: lic.ID, Plan: lic.Plan, Status: lic.Status, MaxDevices: lic.MaxDevices, ActiveDevices: store.ActiveDeviceCount(lic.ID), CreatedAt: formatAdminTime(lic.CreatedAt)} } }
	ps, err := store.ListPaymentAttemptsForOrder(order.ID); if err != nil { return nil, err }
	for _, p := range ps { v.Payments = append(v.Payments, AdminPaymentAttemptView{ID: p.ID, Provider: p.Provider, AuthorityHint: truncateOpaque(p.Authority, 12), Reference: p.Reference, Status: p.Status, AmountRials: p.AmountRials, CreatedAt: formatAdminTime(p.CreatedAt), VerifiedAt: formatAdminTimePtr(p.VerifiedAt)}) }
	ds, err := store.ListDeliveriesForOrder(order.ID); if err != nil { return nil, err }
	for _, d := range ds { v.Deliveries = append(v.Deliveries, AdminDeliveryView{ID: d.ID, Channel: d.Channel, ToAddress: d.ToAddress, Subject: d.Subject, Kind: d.Kind, Status: d.Status, AttemptCount: d.AttemptCount, LastError: redactSecrets(d.LastError), CreatedAt: formatAdminTime(d.CreatedAt), SentAt: formatAdminTimePtr(d.SentAt)}) }
	dls, err := store.ListDownloadRecordsForOrder(order.ID); if err != nil { return nil, err }
	for _, d := range dls { v.Downloads = append(v.Downloads, AdminDownloadView{ID: d.ID, Artifact: d.Artifact, CreatedAt: formatAdminTime(d.CreatedAt)}) }
	if order.LicenseID != "" { acts, err := store.ListActivationsForLicense(order.LicenseID); if err != nil { return nil, err }; for _, a := range acts { st := "active"; if a.RevokedAt != nil { st = "revoked" }; v.Activations = append(v.Activations, AdminActivationView{ID: a.ID, Platform: a.Platform, AppVersion: a.AppVersion, DeviceKeyHint: truncateOpaque(a.DevicePublicKey, 16), Status: st, CreatedAt: formatAdminTime(a.CreatedAt), LastSeen: formatAdminTime(a.LastSeen), RevokedAt: formatAdminTimePtr(a.RevokedAt)}) } }
	ns, err := store.ListSupportNotesForOrder(order.ID); if err != nil { return nil, err }
	for _, n := range ns { v.SupportNotes = append(v.SupportNotes, AdminSupportNoteView{ID: n.ID, AdminSessionHint: truncateOpaque(n.AdminSessionID, 8), Body: n.Body, CreatedAt: formatAdminTime(n.CreatedAt)}) }
	au, err := store.ListAdminAuditForTarget("order", order.ID, 50); if err != nil { return nil, err }
	for _, a := range au { v.AuditLog = append(v.AuditLog, AdminAuditView{ID: a.ID, Action: a.Action, TargetType: a.TargetType, TargetID: a.TargetID, Detail: redactSecrets(a.Detail), CreatedAt: formatAdminTime(a.CreatedAt)}) }
	return v, nil
}
