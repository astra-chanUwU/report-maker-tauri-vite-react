package controlplane

import ("database/sql"; "strings"; "time")

type AdminAuditEntry struct{ ID, AdminSessionID, Action, TargetType, TargetID, Detail string; CreatedAt time.Time }
type SupportNote struct{ ID, OrderID, AdminSessionID, Body string; CreatedAt time.Time }
type AdminOrderSearchHit struct{ OrderID, Email, Phone, Status, Plan, PaymentRef, MatchReason string; PaidAt *time.Time }

func (s *Store) PutAdminAudit(e *AdminAuditEntry) error {
	if e.ID == "" { e.ID = randomID("aud_") }
	if e.CreatedAt.IsZero() { e.CreatedAt = time.Now().UTC() }
	_, err := s.db.Exec(`INSERT INTO admin_audit_log(id,admin_session_id,action,target_type,target_id,detail,created_at) VALUES(?,?,?,?,?,?,?)`, e.ID, e.AdminSessionID, e.Action, e.TargetType, e.TargetID, e.Detail, formatTime(e.CreatedAt))
	return err
}
func (s *Store) ListAdminAuditForTarget(tt, tid string, limit int) ([]AdminAuditEntry, error) {
	if limit <= 0 { limit = 50 }
	rows, err := s.db.Query(`SELECT id,admin_session_id,action,target_type,target_id,detail,created_at FROM admin_audit_log WHERE target_type=? AND target_id=? ORDER BY created_at DESC LIMIT ?`, tt, tid, limit)
	if err != nil { return nil, err }
	defer rows.Close()
	var out []AdminAuditEntry
	for rows.Next() { var it AdminAuditEntry; var c string; if err := rows.Scan(&it.ID, &it.AdminSessionID, &it.Action, &it.TargetType, &it.TargetID, &it.Detail, &c); err != nil { return nil, err }; it.CreatedAt, _ = parseTime(c); out = append(out, it) }
	return out, rows.Err()
}
func (s *Store) PutSupportNote(n *SupportNote) error {
	if n.ID == "" { n.ID = randomID("note_") }
	if n.CreatedAt.IsZero() { n.CreatedAt = time.Now().UTC() }
	_, err := s.db.Exec(`INSERT INTO support_notes(id,order_id,admin_session_id,body,created_at) VALUES(?,?,?,?,?)`, n.ID, n.OrderID, n.AdminSessionID, n.Body, formatTime(n.CreatedAt))
	return err
}
func (s *Store) ListSupportNotesForOrder(oid string) ([]SupportNote, error) {
	rows, err := s.db.Query(`SELECT id,order_id,admin_session_id,body,created_at FROM support_notes WHERE order_id=? ORDER BY created_at DESC`, oid)
	if err != nil { return nil, err }
	defer rows.Close()
	var out []SupportNote
	for rows.Next() { var it SupportNote; var c string; if err := rows.Scan(&it.ID, &it.OrderID, &it.AdminSessionID, &it.Body, &c); err != nil { return nil, err }; it.CreatedAt, _ = parseTime(c); out = append(out, it) }
	return out, rows.Err()
}
func (s *Store) SearchAdminOrders(q string) ([]AdminOrderSearchHit, error) {
	q = strings.TrimSpace(q); if q == "" { return nil, nil }
	seen := map[string]struct{}{}; var hits []AdminOrderSearchHit
	add := func(h AdminOrderSearchHit) { if h.OrderID == "" { return }; if _, ok := seen[h.OrderID]; ok { return }; seen[h.OrderID] = struct{}{}; hits = append(hits, h) }
	for _, spec := range []struct{ sql, reason string; args []any }{
		{`SELECT id,email,phone,status,plan,payment_ref,paid_at FROM orders WHERE id=?`, "order id", []any{q}},
		{`SELECT id,email,phone,status,plan,payment_ref,paid_at FROM orders WHERE lower(email)=? LIMIT 20`, "order email", []any{normalizeEmail(q)}},
		{`SELECT id,email,phone,status,plan,payment_ref,paid_at FROM orders WHERE phone=? LIMIT 20`, "order phone", []any{strings.TrimSpace(q)}},
		{`SELECT id,email,phone,status,plan,payment_ref,paid_at FROM orders WHERE payment_ref=? LIMIT 20`, "payment ref", []any{q}},
		{`SELECT o.id,o.email,o.phone,o.status,o.plan,o.payment_ref,o.paid_at FROM orders o JOIN payment_attempts p ON p.order_id=o.id WHERE p.reference=? OR p.authority=? LIMIT 20`, "payment attempt", []any{q, q}},
	} { rows, err := s.db.Query(spec.sql, spec.args...); if err != nil { return nil, err }; for rows.Next() { if h, ok := scanAdminSearchHit(rows, spec.reason); ok { add(h) } }; rows.Close() }
	return hits, nil
}
func scanAdminSearchHit(row interface{ Scan(...any) error }, reason string) (AdminOrderSearchHit, bool) {
	var h AdminOrderSearchHit; var paid sql.NullString
	if err := row.Scan(&h.OrderID, &h.Email, &h.Phone, &h.Status, &h.Plan, &h.PaymentRef, &paid); err != nil { return AdminOrderSearchHit{}, false }
	if paid.Valid && paid.String != "" { if t, err := parseTime(paid.String); err == nil { h.PaidAt = &t } }
	h.MatchReason = reason; return h, true
}
func (s *Store) ListPaymentAttemptsForOrder(oid string) ([]PaymentAttempt, error) {
	rows, err := s.db.Query(`SELECT id,order_id,provider,authority,reference,amount_rials,status,created_at,verified_at FROM payment_attempts WHERE order_id=? ORDER BY created_at DESC`, oid)
	if err != nil { return nil, err }; defer rows.Close(); var out []PaymentAttempt
	for rows.Next() { if it, ok := scanPaymentAttempt(rows); ok { out = append(out, *it) } }; return out, rows.Err()
}
func scanPaymentAttempt(row interface{ Scan(...any) error }) (*PaymentAttempt, bool) {
	var v PaymentAttempt; var c, vf sql.NullString
	if err := row.Scan(&v.ID, &v.OrderID, &v.Provider, &v.Authority, &v.Reference, &v.AmountRials, &v.Status, &c, &vf); err != nil { return nil, false }
	v.CreatedAt, _ = parseTime(c.String); if vf.Valid && vf.String != "" { if t, err := parseTime(vf.String); err == nil { v.VerifiedAt = &t } }; return &v, true
}
func (s *Store) ListDeliveriesForOrder(oid string) ([]*DeliveryOutboxRow, error) {
	rows, err := s.db.Query(`SELECT id, channel, to_address, subject, body, kind, order_id, license_id, idempotency_key, status, attempt_count, last_error, created_at, updated_at, sent_at FROM delivery_outbox WHERE order_id=? ORDER BY created_at DESC`, oid)
	if err != nil { return nil, err }; defer rows.Close(); var out []*DeliveryOutboxRow
	for rows.Next() { it, err := scanDeliveryRows(rows); if err != nil { return nil, err }; out = append(out, it) }; return out, rows.Err()
}
func (s *Store) ListDownloadRecordsForOrder(oid string) ([]DownloadRecord, error) {
	rows, err := s.db.Query(`SELECT id,COALESCE(order_id,''),COALESCE(license_id,''),artifact,created_at FROM download_records WHERE order_id=? ORDER BY created_at DESC`, oid)
	if err != nil { return nil, err }; defer rows.Close(); var out []DownloadRecord
	for rows.Next() { var it DownloadRecord; var c string; if err := rows.Scan(&it.ID, &it.OrderID, &it.LicenseID, &it.Artifact, &c); err != nil { return nil, err }; it.CreatedAt, _ = parseTime(c); out = append(out, it) }; return out, rows.Err()
}
func (s *Store) ListActivationsForLicense(lid string) ([]Activation, error) {
	rows, err := s.db.Query(`SELECT id,license_id,device_public_key,platform,app_version,created_at,last_seen,revoked_at FROM activations WHERE license_id=? ORDER BY created_at DESC`, lid)
	if err != nil { return nil, err }; defer rows.Close(); var out []Activation
	for rows.Next() { if it, ok := scanActivation(rows); ok { out = append(out, *it) } }; return out, rows.Err()
}
