package controlplane

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	webauthn "github.com/go-webauthn/webauthn/webauthn"
	"golang.org/x/crypto/argon2"
)

const customerSessionCookie = "report_maker_session"

type customerWebAuthnUser struct {
	customer    *Customer
	credentials []webauthn.Credential
}

func (u customerWebAuthnUser) WebAuthnID() []byte {
	value, _ := base64.RawURLEncoding.DecodeString(u.customer.WebAuthnID)
	return value
}
func (u customerWebAuthnUser) WebAuthnName() string { return u.customer.Email }
func (u customerWebAuthnUser) WebAuthnDisplayName() string {
	name := strings.TrimSpace(strings.TrimSpace(u.customer.FirstName) + " " + strings.TrimSpace(u.customer.LastName))
	if name == "" {
		return u.customer.Email
	}
	return name
}
func (u customerWebAuthnUser) WebAuthnCredentials() []webauthn.Credential { return u.credentials }

func newWebAuthnUser(customer *Customer, credentials []webauthn.Credential) customerWebAuthnUser {
	return customerWebAuthnUser{customer: customer, credentials: credentials}
}

func (a *App) authRoutes() {
	a.mux.HandleFunc("GET /login", a.loginPage)
	a.mux.HandleFunc("POST /auth/magic-link/request", a.requestMagicLink)
	a.mux.HandleFunc("GET /auth/magic-link/consume", a.consumeMagicLink)
	a.mux.HandleFunc("POST /auth/password/set", a.setCustomerPassword)
	a.mux.HandleFunc("POST /auth/password/login", a.loginWithPassword)
	a.mux.HandleFunc("POST /auth/passkey/register/begin", a.beginPasskeyRegistration)
	a.mux.HandleFunc("POST /auth/passkey/register/finish", a.finishPasskeyRegistration)
	a.mux.HandleFunc("POST /auth/passkey/login/begin", a.beginPasskeyLogin)
	a.mux.HandleFunc("POST /auth/passkey/login/finish", a.finishPasskeyLogin)
	a.mux.HandleFunc("POST /auth/logout", a.logoutCustomer)
	a.mux.HandleFunc("GET /account", a.customerAccount)
}

func (a *App) loginPage(w http.ResponseWriter, r *http.Request) {
	renderPage(w, "login", PageData{
		Title: "Sign in", Heading: "Sign in to your Report Maker account",
		Body: "Use a passkey first, or request a one-time sign-in link by email.",
		CSRFToken: a.ensureCSRF(w, r), ExtraScript: true,
		ShowPasskeyLogin: true, ShowMagicLink: true, ShowPasswordLogin: true,
	})
}

func (a *App) requestMagicLink(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Error(w, "invalid form", http.StatusBadRequest)
		return
	}
	if !a.requireCSRF(w, r) {
		return
	}
	if !a.rateLimit(w, r, "magic-link-request", 5, 15*time.Minute) {
		return
	}
	email := strings.TrimSpace(strings.ToLower(r.FormValue("email")))
	if !validEmail(email) {
		http.Error(w, "enter a valid email", http.StatusBadRequest)
		return
	}
	customer, ok := a.store.FindCustomerByEmail(email)
	if !ok {
		writeJSON(w, http.StatusAccepted, map[string]string{"status": "If the account exists, a sign-in link has been sent."})
		return
	}
	token, err := randomToken(32)
	if err != nil {
		http.Error(w, "could not create sign-in link", http.StatusInternalServerError)
		return
	}
	now := time.Now().UTC()
	if err := a.store.PutMagicLink(&MagicLink{ID: randomID("ml_"), CustomerID: customer.ID, TokenHash: hashToken(token), ExpiresAt: now.Add(15 * time.Minute), CreatedAt: now}); err != nil {
		http.Error(w, "could not save sign-in link", http.StatusInternalServerError)
		return
	}
	linkURL := a.cfg.PublicBaseURL + "/auth/magic-link/consume?token=" + url.QueryEscape(token)
	_ = a.email.Send(r.Context(), EmailMessage{
		To: customer.Email, Subject: "Sign in to Report Maker",
		Body: "Open this link to sign in: " + linkURL, Kind: EmailKindMagicLink,
		IdempotencyKey: "magic_link:" + hashToken(token),
	})
	if a.cfg.AllowDevSeed {
		w.Header().Set("X-Dev-Magic-Link", linkURL)
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "If the account exists, a sign-in link has been sent."})
}

func (a *App) consumeMagicLink(w http.ResponseWriter, r *http.Request) {
	token := strings.TrimSpace(r.URL.Query().Get("token"))
	link, ok := a.store.ConsumeMagicLink(hashToken(token))
	if !ok || token == "" {
		http.Error(w, "sign-in link is invalid or expired", http.StatusUnauthorized)
		return
	}
	if err := a.rotateCustomerSession(w, r, link.CustomerID); err != nil {
		http.Error(w, "could not create session", http.StatusInternalServerError)
		return
	}
	http.Redirect(w, r, "/account", http.StatusSeeOther)
}

func (a *App) setCustomerPassword(w http.ResponseWriter, r *http.Request) {
	customer, ok := a.customerFromRequest(r)
	if !ok {
		http.Error(w, "sign in required", http.StatusUnauthorized)
		return
	}
	if !a.requireCSRF(w, r) {
		return
	}
	var body struct {
		Password string `json:"password"`
	}
	if !decodeJSON(w, r, &body) || !validPassword(body.Password) {
		errorJSON(w, http.StatusUnprocessableEntity, "invalid_password", "Password must be at least 12 characters.")
		return
	}
	hash, err := hashPassword(body.Password)
	if err != nil {
		http.Error(w, "could not set password", http.StatusInternalServerError)
		return
	}
	customer.PasswordHash = hash
	customer.UpdatedAt = time.Now().UTC()
	if err := a.store.PutCustomer(customer); err != nil {
		http.Error(w, "could not set password", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "password_set"})
}

func (a *App) loginWithPassword(w http.ResponseWriter, r *http.Request) {
	if !a.requireCSRF(w, r) {
		return
	}
	if !a.rateLimit(w, r, "password-login", 10, 15*time.Minute) {
		return
	}
	email := ""
	password := ""
	if strings.Contains(r.Header.Get("Content-Type"), "application/json") {
		var body struct {
			Email    string `json:"email"`
			Password string `json:"password"`
		}
		if !decodeJSON(w, r, &body) {
			return
		}
		email = strings.TrimSpace(strings.ToLower(body.Email))
		password = body.Password
	} else {
		if err := r.ParseForm(); err != nil {
			http.Error(w, "invalid form", http.StatusBadRequest)
			return
		}
		email = strings.TrimSpace(strings.ToLower(r.FormValue("email")))
		password = r.FormValue("password")
	}
	customer, ok := a.store.FindCustomerByEmail(email)
	if !ok || customer.PasswordHash == "" || !verifyPassword(customer.PasswordHash, password) {
		errorJSON(w, http.StatusUnauthorized, "invalid_credentials", "Email or password is incorrect.")
		return
	}
	if err := a.rotateCustomerSession(w, r, customer.ID); err != nil {
		http.Error(w, "could not create session", http.StatusInternalServerError)
		return
	}
	if strings.Contains(r.Header.Get("Accept"), "text/html") || r.FormValue("email") != "" {
		http.Redirect(w, r, "/account", http.StatusSeeOther)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "signed_in", "customer_id": customer.ID})
}

func (a *App) beginPasskeyRegistration(w http.ResponseWriter, r *http.Request) {
	if !a.requireCSRF(w, r) {
		return
	}
	if !a.rateLimit(w, r, "passkey", 20, 15*time.Minute) {
		return
	}
	customer, ok := a.customerFromRequest(r)
	if !ok {
		http.Error(w, "sign in required", http.StatusUnauthorized)
		return
	}
	user, err := a.loadWebAuthnUser(customer)
	if err != nil {
		http.Error(w, "could not load passkeys", http.StatusInternalServerError)
		return
	}
	if len(user.WebAuthnID()) == 0 {
		id, err := randomToken(32)
		if err != nil {
			http.Error(w, "could not create passkey identity", http.StatusInternalServerError)
			return
		}
		customer.WebAuthnID = base64.RawURLEncoding.EncodeToString([]byte(id))
		customer.UpdatedAt = time.Now().UTC()
		if err := a.store.PutCustomer(customer); err != nil {
			http.Error(w, "could not save passkey identity", http.StatusInternalServerError)
			return
		}
		user = newWebAuthnUser(customer, user.credentials)
	}
	creation, session, err := a.webAuthn.BeginRegistration(user)
	if err != nil {
		http.Error(w, "could not begin passkey registration", http.StatusInternalServerError)
		return
	}
	challengeID, err := a.saveWebAuthnChallenge(customer.ID, "registration", session)
	if err != nil {
		http.Error(w, "could not save passkey challenge", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"challenge_id": challengeID, "public_key": creation})
}

func (a *App) finishPasskeyRegistration(w http.ResponseWriter, r *http.Request) {
	if !a.requireCSRF(w, r) {
		return
	}
	if !a.rateLimit(w, r, "passkey", 20, 15*time.Minute) {
		return
	}
	customer, ok := a.customerFromRequest(r)
	if !ok {
		http.Error(w, "sign in required", http.StatusUnauthorized)
		return
	}
	challengeID := strings.TrimSpace(r.URL.Query().Get("challenge_id"))
	challenge, ok := a.store.ConsumeWebAuthnChallenge(challengeID, "registration")
	if !ok || challenge.CustomerID != customer.ID {
		http.Error(w, "passkey challenge is invalid or expired", http.StatusUnauthorized)
		return
	}
	var session webauthn.SessionData
	if err := json.Unmarshal(challenge.SessionJSON, &session); err != nil {
		http.Error(w, "passkey challenge is invalid", http.StatusUnauthorized)
		return
	}
	user, err := a.loadWebAuthnUser(customer)
	if err != nil {
		http.Error(w, "could not load passkeys", http.StatusInternalServerError)
		return
	}
	credential, err := a.webAuthn.FinishRegistration(user, session, r)
	if err != nil {
		http.Error(w, "passkey registration failed", http.StatusUnauthorized)
		return
	}
	encoded, err := json.Marshal(credential)
	if err != nil || a.store.PutWebAuthnCredential(&WebAuthnCredential{ID: base64.RawURLEncoding.EncodeToString(credential.ID), CustomerID: customer.ID, CredentialJSON: encoded, CreatedAt: time.Now().UTC()}) != nil {
		http.Error(w, "could not save passkey", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"status": "passkey_registered"})
}

func (a *App) beginPasskeyLogin(w http.ResponseWriter, r *http.Request) {
	if !a.requireCSRF(w, r) {
		return
	}
	if !a.rateLimit(w, r, "passkey", 20, 15*time.Minute) {
		return
	}
	assertion, session, err := a.webAuthn.BeginDiscoverableLogin()
	if err != nil {
		http.Error(w, "could not begin passkey login", http.StatusInternalServerError)
		return
	}
	challengeID, err := a.saveWebAuthnChallenge("", "login", session)
	if err != nil {
		http.Error(w, "could not save passkey challenge", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"challenge_id": challengeID, "public_key": assertion})
}

func (a *App) finishPasskeyLogin(w http.ResponseWriter, r *http.Request) {
	if !a.requireCSRF(w, r) {
		return
	}
	if !a.rateLimit(w, r, "passkey", 20, 15*time.Minute) {
		return
	}
	challengeID := strings.TrimSpace(r.URL.Query().Get("challenge_id"))
	challenge, ok := a.store.ConsumeWebAuthnChallenge(challengeID, "login")
	if !ok {
		http.Error(w, "passkey challenge is invalid or expired", http.StatusUnauthorized)
		return
	}
	var session webauthn.SessionData
	if err := json.Unmarshal(challenge.SessionJSON, &session); err != nil {
		http.Error(w, "passkey challenge is invalid", http.StatusUnauthorized)
		return
	}
	user, credential, err := a.webAuthn.FinishPasskeyLogin(a.discoverableUser, session, r)
	if err != nil {
		http.Error(w, "passkey login failed", http.StatusUnauthorized)
		return
	}
	customerUser, ok := user.(customerWebAuthnUser)
	if !ok || customerUser.customer == nil {
		http.Error(w, "passkey account is invalid", http.StatusUnauthorized)
		return
	}
	// TouchWebAuthnCredential persists the updated sign counter and last-used timestamp.
	encoded, _ := json.Marshal(credential)
	_ = a.store.TouchWebAuthnCredential(base64.RawURLEncoding.EncodeToString(credential.ID), encoded)
	if err := a.rotateCustomerSession(w, r, customerUser.customer.ID); err != nil {
		http.Error(w, "could not create session", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "signed_in", "customer_id": customerUser.customer.ID})
}

func (a *App) discoverableUser(rawID, userHandle []byte) (webauthn.User, error) {
	customer, ok := a.store.FindCustomerByWebAuthnID(base64.RawURLEncoding.EncodeToString(userHandle))
	if !ok {
		return nil, fmt.Errorf("unknown passkey user")
	}
	return a.loadWebAuthnUser(customer)
}

func (a *App) loadWebAuthnUser(customer *Customer) (customerWebAuthnUser, error) {
	rows, err := a.store.ListWebAuthnCredentials(customer.ID)
	if err != nil {
		return customerWebAuthnUser{}, err
	}
	credentials := make([]webauthn.Credential, 0, len(rows))
	for _, row := range rows {
		var credential webauthn.Credential
		if err := json.Unmarshal(row.CredentialJSON, &credential); err != nil {
			return customerWebAuthnUser{}, err
		}
		credentials = append(credentials, credential)
	}
	return newWebAuthnUser(customer, credentials), nil
}

func (a *App) saveWebAuthnChallenge(customerID, kind string, session *webauthn.SessionData) (string, error) {
	encoded, err := json.Marshal(session)
	if err != nil {
		return "", err
	}
	id := randomID("wch_")
	err = a.store.PutWebAuthnChallenge(&WebAuthnChallenge{ID: id, CustomerID: customerID, Kind: kind, SessionJSON: encoded, ExpiresAt: session.Expires})
	return id, err
}

func (a *App) customerFromRequest(r *http.Request) (*Customer, bool) {
	token := ""
	if cookie, err := r.Cookie(customerSessionCookie); err == nil {
		token = cookie.Value
	}
	if token == "" {
		auth := strings.TrimSpace(r.Header.Get("Authorization"))
		if strings.HasPrefix(auth, "Bearer ") {
			token = strings.TrimSpace(strings.TrimPrefix(auth, "Bearer "))
		}
	}
	if token == "" {
		return nil, false
	}
	session, ok := a.store.FindCustomerSession(hashToken(token))
	if !ok {
		return nil, false
	}
	_ = a.store.TouchCustomerSession(session.ID)
	return a.store.GetCustomer(session.CustomerID)
}

func (a *App) rotateCustomerSession(w http.ResponseWriter, r *http.Request, customerID string) error {
	if cookie, err := r.Cookie(customerSessionCookie); err == nil && cookie.Value != "" {
		_ = a.store.DeleteCustomerSession(hashToken(cookie.Value))
	}
	if err := a.store.DeleteCustomerSessions(customerID); err != nil {
		return err
	}
	return a.issueCustomerSession(w, customerID)
}

func (a *App) issueCustomerSession(w http.ResponseWriter, customerID string) error {
	token, err := randomToken(32)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	if err := a.store.PutCustomerSession(&CustomerSession{ID: randomID("ses_"), CustomerID: customerID, TokenHash: hashToken(token), ExpiresAt: now.Add(30 * 24 * time.Hour), CreatedAt: now, LastSeenAt: now}); err != nil {
		return err
	}
	secure := strings.HasPrefix(strings.ToLower(a.cfg.PublicBaseURL), "https://")
	http.SetCookie(w, &http.Cookie{Name: customerSessionCookie, Value: token, Path: "/", HttpOnly: true, Secure: secure, SameSite: http.SameSiteLaxMode, MaxAge: 30 * 24 * 60 * 60})
	return nil
}

func (a *App) logoutCustomer(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Error(w, "invalid form", http.StatusBadRequest)
		return
	}
	if !a.requireCSRF(w, r) {
		return
	}
	if cookie, err := r.Cookie(customerSessionCookie); err == nil && cookie.Value != "" {
		_ = a.store.DeleteCustomerSession(hashToken(cookie.Value))
	}
	secure := strings.HasPrefix(strings.ToLower(a.cfg.PublicBaseURL), "https://")
	http.SetCookie(w, &http.Cookie{Name: customerSessionCookie, Value: "", Path: "/", HttpOnly: true, Secure: secure, SameSite: http.SameSiteLaxMode, MaxAge: -1})
	if strings.Contains(r.Header.Get("Accept"), "text/html") {
		http.Redirect(w, r, "/login", http.StatusSeeOther)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "signed_out"})
}

func (a *App) customerAccount(w http.ResponseWriter, r *http.Request) {
	customer, ok := a.customerFromRequest(r)
	if !ok {
		http.Redirect(w, r, "/login?return_to="+url.QueryEscape(r.URL.Path), http.StatusSeeOther)
		return
	}
	phoneStatus := "not verified"
	if customer.PhoneVerifiedAt != nil {
		phoneStatus = "verified"
	}
	renderPage(w, "account", PageData{
		Title: "Your account", Heading: "Your Report Maker account",
		Body: "Signed in as " + customer.Email, CSRFToken: a.ensureCSRF(w, r),
		Email: customer.Email, Phone: customer.Phone, PhoneVerified: phoneStatus,
		ExtraScript: true, ShowPasskeyRegister: true, ShowPhoneVerify: true, ShowLogout: true,
	})
}

func randomToken(size int) (string, error) {
	value := make([]byte, size)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}

func hashToken(value string) string {
	sum := sha256.Sum256([]byte(value))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func hashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	const memory, iterations, parallelism, keyLength = 64 * 1024, 3, 1, 32
	key := argon2.IDKey([]byte(password), salt, iterations, memory, parallelism, keyLength)
	encode := base64.RawStdEncoding.EncodeToString
	return fmt.Sprintf("$argon2id$v=19$m=%d,t=%d,p=%d$%s$%s", memory, iterations, parallelism, encode(salt), encode(key)), nil
}

func verifyPassword(encoded, password string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" || parts[2] != "v=19" {
		return false
	}
	var memory, iterations, parallelism uint32
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &iterations, &parallelism); err != nil || memory == 0 || iterations == 0 || parallelism == 0 {
		return false
	}
	salt, err1 := base64.RawStdEncoding.DecodeString(parts[4])
	want, err2 := base64.RawStdEncoding.DecodeString(parts[5])
	if err1 != nil || err2 != nil || len(want) == 0 {
		return false
	}
	got := argon2.IDKey([]byte(password), salt, iterations, memory, uint8(parallelism), uint32(len(want)))
	return constantTimeEqual(got, want)
}

func constantTimeEqual(a, b []byte) bool {
	if len(a) != len(b) {
		return false
	}
	var result byte
	for i := range a {
		result |= a[i] ^ b[i]
	}
	return result == 0
}

func validPassword(value string) bool { return len([]rune(value)) >= 12 }
func validEmail(value string) bool {
	parsed, err := url.Parse("mailto:" + value)
	return err == nil && parsed.Opaque != "" && strings.Contains(parsed.Opaque, "@")
}

// LocalOutboxRef returns the email outbox when the app uses LocalOutbox.
func (a *App) LocalOutboxRef() *LocalOutbox {
	if outbox, ok := a.email.(*LocalOutbox); ok {
		return outbox
	}
	return nil
}

// FakeSMSRef returns the fake SMS store when the app uses FakeSMS.
func (a *App) FakeSMSRef() *FakeSMS {
	if fake, ok := a.sms.(*FakeSMS); ok {
		return fake
	}
	return nil
}
