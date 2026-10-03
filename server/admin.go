package controlplane

import ("context"; "fmt"; "net/http"; "strings"; "time")

const adminSessionCookie = "report_maker_admin_session"

func (a *App) adminRoutes() {
	a.mux.HandleFunc("GET /admin/login", a.adminLoginPage)
	a.mux.HandleFunc("POST /admin/login", a.adminLogin)
	a.mux.HandleFunc("POST /admin/logout", a.adminLogout)
	a.mux.HandleFunc("GET /admin", a.adminHome)
	a.mux.HandleFunc("GET /admin/orders/{order_id}", a.adminOrderDetail)
	a.mux.HandleFunc("POST /admin/orders/{order_id}/resend-delivery", a.adminResendDelivery)
	a.mux.HandleFunc("POST /admin/orders/{order_id}/support-note", a.adminSupportNote)
	a.mux.HandleFunc("POST /admin/activations/{activation_id}/revoke", a.adminRevokeActivation)
}

func (a *App) adminEnabled() bool { return a.cfg.AdminPassword != "" }
func (a *App) requireAdmin(w http.ResponseWriter, r *http.Request) (string, bool) {
	if !a.adminEnabled() { http.Error(w, "Admin access is disabled", http.StatusServiceUnavailable); return "", false }
	sid, ok := a.adminFromRequest(r); if !ok { http.Redirect(w, r, "/admin/login", http.StatusSeeOther); return "", false }; return sid, true
}
func (a *App) adminLoginPage(w http.ResponseWriter, r *http.Request) {
	if !a.adminEnabled() { http.Error(w, "Admin access is disabled", http.StatusServiceUnavailable); return }
	if _, ok := a.adminFromRequest(r); ok { http.Redirect(w, r, "/admin", http.StatusSeeOther); return }
	renderPage(w, "admin-login", PageData{Title: "Admin sign in", Heading: "Admin sign in", CSRFToken: a.ensureCSRF(w, r), ShowAdminLogin: true, HideFooter: true})
}
func (a *App) adminLogin(w http.ResponseWriter, r *http.Request) {
	if !a.adminEnabled() { http.Error(w, "Admin access is disabled", http.StatusServiceUnavailable); return }
	if err := r.ParseForm(); err != nil { http.Error(w, "invalid form", http.StatusBadRequest); return }
	if !a.requireCSRF(w, r) || !a.rateLimit(w, r, "admin-login", 10, 15*time.Minute) { return }
	if r.FormValue("password") != a.cfg.AdminPassword { http.Error(w, "Invalid admin credentials", http.StatusUnauthorized); return }
	if err := a.issueAdminSession(w); err != nil { http.Error(w, "could not create admin session", http.StatusInternalServerError); return }
	http.Redirect(w, r, "/admin", http.StatusSeeOther)
}
func (a *App) adminLogout(w http.ResponseWriter, r *http.Request) {
	if !a.adminEnabled() { http.Error(w, "Admin access is disabled", http.StatusServiceUnavailable); return }
	if err := r.ParseForm(); err != nil || !a.requireCSRF(w, r) { return }
	if cookie, err := r.Cookie(adminSessionCookie); err == nil && cookie.Value != "" { _ = a.store.DeleteAdminSession(hashToken(cookie.Value)) }
	http.SetCookie(w, &http.Cookie{Name: adminSessionCookie, Value: "", Path: "/", HttpOnly: true, Secure: a.cfg.cookieSecure(), SameSite: http.SameSiteLaxMode, MaxAge: -1})
	http.Redirect(w, r, "/admin/login", http.StatusSeeOther)
}
func (a *App) adminHome(w http.ResponseWriter, r *http.Request) {
	if _, ok := a.requireAdmin(w, r); !ok { return }
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	data := PageData{Title: "Admin support", Heading: "Admin support console", CSRFToken: a.ensureCSRF(w, r), ShowAdminLogout: true, HideFooter: true, AdminQuery: q, AdminFlash: r.URL.Query().Get("flash")}
	if q != "" { hits, err := a.store.SearchAdminOrders(q); if err != nil { http.Error(w, "search failed", http.StatusInternalServerError); return }; data.AdminSearchHits = buildAdminSearchHits(hits) }
	renderPage(w, "admin", data)
}
func (a *App) adminOrderDetail(w http.ResponseWriter, r *http.Request) {
	if _, ok := a.requireAdmin(w, r); !ok { return }
	oid := strings.TrimSpace(r.PathValue("order_id")); order, ok := a.store.GetOrder(oid); if !ok { http.NotFound(w, r); return }
	view, err := buildAdminOrderView(a.store, order); if err != nil { http.Error(w, "could not load order", http.StatusInternalServerError); return }
	renderPage(w, "admin-order", PageData{Title: "Order " + oid, Heading: "Order detail", CSRFToken: a.ensureCSRF(w, r), ShowAdminLogout: true, HideFooter: true, AdminOrder: view, AdminFlash: r.URL.Query().Get("flash")})
}
func (a *App) adminResendDelivery(w http.ResponseWriter, r *http.Request) {
	sid, ok := a.requireAdmin(w, r); if !ok || r.ParseForm() != nil || !a.requireCSRF(w, r) { return }
	oid := strings.TrimSpace(r.PathValue("order_id")); order, found := a.store.GetOrder(oid); if !found { http.NotFound(w, r); return }
	if order.Status != "paid" { http.Redirect(w, r, "/admin/orders/"+oid+"?flash=not+paid", http.StatusSeeOther); return }
	if err := a.adminResendOrderDelivery(r.Context(), order); err != nil { http.Redirect(w, r, "/admin/orders/"+oid+"?flash=failed", http.StatusSeeOther); return }
	_ = a.store.PutAdminAudit(&AdminAuditEntry{AdminSessionID: sid, Action: "resend_delivery", TargetType: "order", TargetID: oid, Detail: "admin resend"})
	http.Redirect(w, r, "/admin/orders/"+oid+"?flash=resent", http.StatusSeeOther)
}
func (a *App) adminSupportNote(w http.ResponseWriter, r *http.Request) {
	sid, ok := a.requireAdmin(w, r); if !ok || r.ParseForm() != nil || !a.requireCSRF(w, r) { return }
	oid := strings.TrimSpace(r.PathValue("order_id")); if _, found := a.store.GetOrder(oid); !found { http.NotFound(w, r); return }
	body := strings.TrimSpace(r.FormValue("note")); if body == "" { http.Redirect(w, r, "/admin/orders/"+oid+"?flash=required", http.StatusSeeOther); return }
	note := &SupportNote{OrderID: oid, AdminSessionID: sid, Body: body}; if err := a.store.PutSupportNote(note); err != nil { http.Error(w, "save failed", http.StatusInternalServerError); return }
	_ = a.store.PutAdminAudit(&AdminAuditEntry{AdminSessionID: sid, Action: "support_note", TargetType: "order", TargetID: oid, Detail: "note " + note.ID})
	http.Redirect(w, r, "/admin/orders/"+oid+"?flash=saved", http.StatusSeeOther)
}
func (a *App) adminRevokeActivation(w http.ResponseWriter, r *http.Request) {
	sid, ok := a.requireAdmin(w, r); if !ok || r.ParseForm() != nil || !a.requireCSRF(w, r) { return }
	aid := strings.TrimSpace(r.PathValue("activation_id")); act, found := a.store.GetActivation(aid); if !found { http.NotFound(w, r); return }
	if act.RevokedAt != nil { http.Redirect(w, r, a.adminRedirectForActivation(act), http.StatusSeeOther); return }
	if !a.store.RevokeActivation(aid) { http.Error(w, "revoke failed", http.StatusInternalServerError); return }
	_ = a.store.PutAdminAudit(&AdminAuditEntry{AdminSessionID: sid, Action: "revoke_activation", TargetType: "activation", TargetID: aid, Detail: "license " + act.LicenseID})
	http.Redirect(w, r, a.adminRedirectForActivation(act), http.StatusSeeOther)
}
func (a *App) adminRedirectForActivation(act *Activation) string {
	if act == nil { return "/admin" }
	if lic, ok := a.store.FindLicenseByID(act.LicenseID); ok && lic.OrderID != "" { return "/admin/orders/" + lic.OrderID }
	return "/admin"
}
func (a *App) adminResendOrderDelivery(ctx context.Context, order *Order) error {
	if order == nil || order.Status != "paid" || a.email == nil { return fmt.Errorf("ineligible") }
	to := strings.TrimSpace(order.Email); if to == "" { return fmt.Errorf("no recipient") }
	return a.email.Send(ctx, EmailMessage{To: to, Subject: "Report Maker receipt", Body: "Order " + order.ID, Kind: EmailKindReceipt, OrderID: order.ID, IdempotencyKey: "admin_resend:" + randomID("r_")})
}
func (a *App) adminFromRequest(r *http.Request) (string, bool) {
	cookie, err := r.Cookie(adminSessionCookie); if err != nil || cookie.Value == "" { return "", false }
	s, ok := a.store.FindAdminSession(hashToken(cookie.Value)); if !ok { return "", false }
	_ = a.store.TouchAdminSession(s.ID); return s.ID, true
}
func (a *App) issueAdminSession(w http.ResponseWriter) error {
	tok, err := randomToken(32); if err != nil { return err }
	now := time.Now().UTC(); if err := a.store.PutAdminSession(&AdminSession{ID: randomID("adm_"), TokenHash: hashToken(tok), ExpiresAt: now.Add(8 * time.Hour), CreatedAt: now, LastSeenAt: now}); err != nil { return err }
	http.SetCookie(w, &http.Cookie{Name: adminSessionCookie, Value: tok, Path: "/", HttpOnly: true, Secure: a.cfg.cookieSecure(), SameSite: http.SameSiteLaxMode, MaxAge: 8 * 60 * 60}); return nil
}
