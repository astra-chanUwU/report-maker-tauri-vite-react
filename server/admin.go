package controlplane

import (
	"net/http"
	"time"
)

const adminSessionCookie = "report_maker_admin_session"

func (a *App) adminRoutes() {
	a.mux.HandleFunc("GET /admin/login", a.adminLoginPage)
	a.mux.HandleFunc("POST /admin/login", a.adminLogin)
	a.mux.HandleFunc("POST /admin/logout", a.adminLogout)
	a.mux.HandleFunc("GET /admin", a.adminHome)
}

func (a *App) adminEnabled() bool {
	return a.cfg.AdminPassword != ""
}

func (a *App) adminLoginPage(w http.ResponseWriter, r *http.Request) {
	if !a.adminEnabled() {
		http.Error(w, "Admin access is disabled", http.StatusServiceUnavailable)
		return
	}
	if _, ok := a.adminFromRequest(r); ok {
		http.Redirect(w, r, "/admin", http.StatusSeeOther)
		return
	}
	renderPage(w, "admin-login", PageData{
		Title: "Admin sign in", Heading: "Admin sign in",
		CSRFToken: a.ensureCSRF(w, r), ShowAdminLogin: true, HideFooter: true,
	})
}

func (a *App) adminLogin(w http.ResponseWriter, r *http.Request) {
	if !a.adminEnabled() {
		http.Error(w, "Admin access is disabled", http.StatusServiceUnavailable)
		return
	}
	if err := r.ParseForm(); err != nil {
		http.Error(w, "invalid form", http.StatusBadRequest)
		return
	}
	if !a.requireCSRF(w, r) {
		return
	}
	if !a.rateLimit(w, r, "admin-login", 10, 15*time.Minute) {
		return
	}
	password := r.FormValue("password")
	if password != a.cfg.AdminPassword {
		http.Error(w, "Invalid admin credentials", http.StatusUnauthorized)
		return
	}
	if err := a.issueAdminSession(w); err != nil {
		http.Error(w, "could not create admin session", http.StatusInternalServerError)
		return
	}
	http.Redirect(w, r, "/admin", http.StatusSeeOther)
}

func (a *App) adminLogout(w http.ResponseWriter, r *http.Request) {
	if !a.adminEnabled() {
		http.Error(w, "Admin access is disabled", http.StatusServiceUnavailable)
		return
	}
	if err := r.ParseForm(); err != nil {
		http.Error(w, "invalid form", http.StatusBadRequest)
		return
	}
	if !a.requireCSRF(w, r) {
		return
	}
	if cookie, err := r.Cookie(adminSessionCookie); err == nil && cookie.Value != "" {
		_ = a.store.DeleteAdminSession(hashToken(cookie.Value))
	}
	http.SetCookie(w, &http.Cookie{Name: adminSessionCookie, Value: "", Path: "/", HttpOnly: true, Secure: a.cfg.cookieSecure(), SameSite: http.SameSiteLaxMode, MaxAge: -1})
	http.Redirect(w, r, "/admin/login", http.StatusSeeOther)
}

func (a *App) adminHome(w http.ResponseWriter, r *http.Request) {
	if !a.adminEnabled() {
		http.Error(w, "Admin access is disabled", http.StatusServiceUnavailable)
		return
	}
	if _, ok := a.adminFromRequest(r); !ok {
		http.Redirect(w, r, "/admin/login", http.StatusSeeOther)
		return
	}
	body := "Signed in as admin. Customer session cookies are not accepted on admin routes. Provider errors are redacted in logs; support can inspect order status without secrets."
	renderPage(w, "admin", PageData{
		Title: "Admin", Heading: "Admin",
		Body: body, CSRFToken: a.ensureCSRF(w, r), ShowAdminLogout: true, HideFooter: true,
	})
}

func (a *App) adminFromRequest(r *http.Request) (string, bool) {
	cookie, err := r.Cookie(adminSessionCookie)
	if err != nil || cookie.Value == "" {
		return "", false
	}
	session, ok := a.store.FindAdminSession(hashToken(cookie.Value))
	if !ok {
		return "", false
	}
	_ = a.store.TouchAdminSession(session.ID)
	return session.ID, true
}

func (a *App) issueAdminSession(w http.ResponseWriter) error {
	token, err := randomToken(32)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	if err := a.store.PutAdminSession(&AdminSession{
		ID: randomID("adm_"), TokenHash: hashToken(token),
		ExpiresAt: now.Add(8 * time.Hour), CreatedAt: now, LastSeenAt: now,
	}); err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{
		Name: adminSessionCookie, Value: token, Path: "/", HttpOnly: true,
		Secure: a.cfg.cookieSecure(), SameSite: http.SameSiteLaxMode, MaxAge: 8 * 60 * 60,
	})
	return nil
}
