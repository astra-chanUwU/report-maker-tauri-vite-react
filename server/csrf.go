package controlplane

import (
	"crypto/rand"
	"encoding/base64"
	"net/http"
	"strings"
)

const csrfCookieName = "report_maker_csrf"

func newCSRFToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func (a *App) ensureCSRF(w http.ResponseWriter, r *http.Request) string {
	if cookie, err := r.Cookie(csrfCookieName); err == nil && cookie.Value != "" {
		return cookie.Value
	}
	token, err := newCSRFToken()
	if err != nil {
		return ""
	}
	http.SetCookie(w, &http.Cookie{
		Name:     csrfCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: false, // double-submit: JS reads cookie for X-CSRF-Token header
		Secure:   a.cfg.cookieSecure(),
		SameSite: http.SameSiteLaxMode,
		MaxAge:   24 * 60 * 60,
	})
	return token
}

func (a *App) requireCSRF(w http.ResponseWriter, r *http.Request) bool {
	cookie, err := r.Cookie(csrfCookieName)
	if err != nil || cookie.Value == "" {
		http.Error(w, "CSRF token missing", http.StatusForbidden)
		return false
	}
	token := strings.TrimSpace(r.FormValue("csrf_token"))
	if token == "" {
		token = strings.TrimSpace(r.Header.Get("X-CSRF-Token"))
	}
	if token == "" || token != cookie.Value {
		http.Error(w, "CSRF token invalid", http.StatusForbidden)
		return false
	}
	return true
}
