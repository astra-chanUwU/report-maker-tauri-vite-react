package controlplane

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	webauthn "github.com/go-webauthn/webauthn/webauthn"
)

type Config struct {
	SigningPrivateKey  string
	SigningKeyID       string
	LicenseDeliveryKey []byte
	LeaseDays          int
	AllowDevSeed       bool
	PublicBaseURL      string
	// DatabasePath selects the SQLite database file. An empty value keeps
	// NewApp's isolated in-memory behavior, which is useful for tests.
	DatabasePath    string
	WebAuthnRPID    string
	WebAuthnOrigins []string
	WebAuthnRPName  string
	AdminPassword   string
	Gateway            PaymentGateway
	EmailSender        EmailSender
	SMSSender          SMSSender
	ArtifactRoot       string
	ReleaseManifest    string
	DownloadLinkTTLHours int
	DownloadRateLimit    int
}

func ConfigFromEnv() Config {
	days := 30
	if raw := os.Getenv("REPORT_LEASE_DAYS"); raw != "" {
		if value, err := strconv.Atoi(raw); err == nil && value > 0 && value <= 365 {
			days = value
		}
	}
	allow := os.Getenv("REPORT_ALLOW_DEV_SEED") == "1"
	base := os.Getenv("PUBLIC_BASE_URL")
	if base == "" {
		base = "http://localhost:8080"
	}
	databasePath := os.Getenv("REPORT_DB_PATH")
	if databasePath == "" {
		databasePath = "report-maker.db"
	}
	rpID := strings.TrimSpace(os.Getenv("REPORT_WEB_AUTHN_RP_ID"))
	if rpID == "" {
		if parsed, err := url.Parse(base); err == nil && parsed.Hostname() != "" {
			rpID = parsed.Hostname()
		} else {
			rpID = "localhost"
		}
	}
	origins := strings.Fields(strings.ReplaceAll(os.Getenv("REPORT_WEB_AUTHN_ORIGINS"), ",", " "))
	if len(origins) == 0 {
		origins = []string{strings.TrimRight(base, "/")}
	}
	rpName := valueOr(os.Getenv("REPORT_WEB_AUTHN_RP_NAME"), "Report Maker")
	var gateway PaymentGateway = DemoGateway{BaseURL: base}
	if merchant := strings.TrimSpace(os.Getenv("ZARINPAL_MERCHANT_ID")); merchant != "" {
		apiBase := strings.TrimSpace(os.Getenv("ZARINPAL_BASE_URL"))
		if apiBase == "" {
			apiBase = strings.TrimSpace(os.Getenv("ZARINPAL_API_URL"))
		}
		if apiBase == "" {
			apiBase = "https://api.zarinpal.com"
		}
		gateway = ZarinPalGateway{MerchantID: merchant, BaseURL: apiBase}
	}
	deliveryKey, _ := LoadDeliveryKey(os.Getenv("REPORT_LICENSE_DELIVERY_KEY"))
	return Config{
		SigningPrivateKey: os.Getenv("REPORT_SIGNING_PRIVATE_KEY"), SigningKeyID: valueOr(os.Getenv("REPORT_SIGNING_KEY_ID"), "lease-dev-1"),
		LicenseDeliveryKey: deliveryKey, LeaseDays: days, AllowDevSeed: allow, PublicBaseURL: strings.TrimRight(base, "/"), DatabasePath: databasePath,
		WebAuthnRPID: rpID, WebAuthnOrigins: origins, WebAuthnRPName: rpName, AdminPassword: os.Getenv("REPORT_ADMIN_PASSWORD"),
		Gateway:              gateway,
		EmailSender:          EmailSenderFromEnv(),
		SMSSender:            SMSSenderFromEnv(),
		ArtifactRoot:         os.Getenv("REPORT_ARTIFACT_ROOT"),
		ReleaseManifest:      os.Getenv("REPORT_RELEASE_MANIFEST"),
		DownloadLinkTTLHours: downloadTokenExpiryFromEnv(os.Getenv("REPORT_DOWNLOAD_LINK_TTL_HOURS"), 24),
		DownloadRateLimit:    downloadTokenExpiryFromEnv(os.Getenv("REPORT_DOWNLOAD_RATE_LIMIT"), 30),
	}
}
func valueOr(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

type App struct {
	cfg           Config
	store         *Store
	signingKey    ed25519.PrivateKey
	signingPublic ed25519.PublicKey
	mux           *http.ServeMux
	webAuthn      *webauthn.WebAuthn
	email         EmailSender
	sms           SMSSender
	rateLimits    *rateLimiter
	releases      *ReleaseCatalog
}

func NewApp(cfg Config) (*App, error) {
	key, err := LoadSigningKey(cfg.SigningPrivateKey)
	if err != nil {
		return nil, err
	}
	if len(cfg.LicenseDeliveryKey) != 32 {
		cfg.LicenseDeliveryKey, err = LoadDeliveryKey("")
		if err != nil {
			return nil, err
		}
	}
	if cfg.Gateway == nil {
		cfg.Gateway = DemoGateway{BaseURL: cfg.PublicBaseURL}
	}
	store, err := OpenStore(cfg.DatabasePath)
	if err != nil {
		return nil, err
	}
	webAuthnRPID := cfg.WebAuthnRPID
	if webAuthnRPID == "" {
		webAuthnRPID = "localhost"
	}
	webAuthnOrigins := cfg.WebAuthnOrigins
	if len(webAuthnOrigins) == 0 {
		webAuthnOrigins = []string{cfg.PublicBaseURL}
	}
	webAuthnService, err := webauthn.New(&webauthn.Config{RPID: webAuthnRPID, RPDisplayName: valueOr(cfg.WebAuthnRPName, "Report Maker"), RPOrigins: webAuthnOrigins})
	if err != nil {
		store.Close()
		return nil, err
	}
	email := cfg.EmailSender
	if email == nil {
		email = &LocalOutbox{}
	}
	sms := cfg.SMSSender
	if sms == nil {
		sms = &FakeSMS{}
	}
	releases, err := LoadReleaseCatalog(cfg.ArtifactRoot, cfg.ReleaseManifest)
	if err != nil {
		store.Close()
		return nil, err
	}
	app := &App{
		cfg: cfg, store: store, signingKey: key, signingPublic: key.Public().(ed25519.PublicKey),
		mux: http.NewServeMux(), webAuthn: webAuthnService, email: email, sms: sms, rateLimits: newRateLimiter(),
		releases: releases,
	}
	if cfg.AllowDevSeed {
		app.store.SeedLicense("RM-TEST-1234-KEY0", "perpetual", map[string]bool{"core_export": true, "hosted_ai": true}, 3)
	}
	app.routes()
	app.authRoutes()
	app.phoneRoutes()
	app.adminRoutes()
	app.downloadRoutes()
	return app, nil
}
func (a *App) Handler() http.Handler { return a.requestLog(a.mux) }
func (a *App) Close() error {
	if a == nil || a.store == nil {
		return nil
	}
	return a.store.Close()
}
func (a *App) routes() {
	a.mux.HandleFunc("GET /healthz", a.health)
	a.mux.HandleFunc("GET /readyz", a.health)
	a.mux.HandleFunc("GET /", a.home)
	a.mux.HandleFunc("GET /pricing", a.pricing)
	a.mux.HandleFunc("GET /download", a.download)
	a.mux.HandleFunc("POST /checkout/start", a.startCheckout)
	a.mux.HandleFunc("GET /checkout/status", a.checkoutStatus)
	a.mux.HandleFunc("GET /payments/{provider}/redirect", a.paymentRedirect)
	a.mux.HandleFunc("GET /payments/{provider}/callback", a.paymentCallback)
	a.mux.HandleFunc("POST /v1/activations", a.activate)
	a.mux.HandleFunc("POST /v1/activations/{id}/refresh", a.refresh)
	a.mux.HandleFunc("DELETE /v1/activations/{id}", a.revoke)
	a.mux.HandleFunc("POST /v1/ai/draft", a.aiDraft)
	a.mux.HandleFunc("POST /v1/telemetry/batch", a.telemetry)
}
func (a *App) requestLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		next.ServeHTTP(w, r)
	})
}
func (a *App) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "service": "report-maker-control-plane"})
}
func (a *App) home(w http.ResponseWriter, _ *http.Request) {
	renderPage(w, "home", PageData{Title: "Offline engineering reports", Heading: "Report Maker", Body: "Build polished engineering reports from your local data. Your report workflow stays on your machine."})
}
func (a *App) pricing(w http.ResponseWriter, r *http.Request) {
	renderPage(w, "pricing", PageData{
		Title: "Pricing", Heading: "Choose a license",
		Body:  "Pay through a domestic payment gateway. The desktop app remains useful offline.",
		Plans: catalogPlansForView(), CSRFToken: a.ensureCSRF(w, r),
	})
}
func (a *App) startCheckout(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Error(w, "invalid form", 400)
		return
	}
	if !a.requireCSRF(w, r) {
		return
	}
	plan := strings.TrimSpace(r.FormValue("plan"))
	email := normalizeEmail(r.FormValue("email"))
	firstName := strings.TrimSpace(r.FormValue("first_name"))
	lastName := strings.TrimSpace(r.FormValue("last_name"))
	catalogPlan, knownPlan := PlanFromCatalog(plan)
	phone := normalizePhone(r.FormValue("phone"))
	if !knownPlan || firstName == "" || lastName == "" || !validEmail(email) || phone == "" {
		http.Error(w, "Enter your first name, surname, email, and a valid Iranian phone number.", 400)
		return
	}
	customer, _, err := a.store.EnsureCheckoutCustomer(firstName, lastName, email, phone)
	if err != nil {
		http.Error(w, "Could not save customer details.", 500)
		return
	}
	orderID := randomID("ord_")
	now := time.Now().UTC()
	order := &Order{ID: orderID, CustomerID: customer.ID, Plan: plan, FirstName: firstName, LastName: lastName, Email: email, Phone: phone, AmountRials: catalogPlan.PriceRials, Status: "pending", CreatedAt: now}
	result, err := a.cfg.Gateway.Start(r.Context(), PaymentRequest{OrderID: orderID, AmountRials: order.AmountRials, Description: "Report Maker " + plan, CallbackURL: a.cfg.PublicBaseURL + "/payments/" + a.cfg.Gateway.Name() + "/callback", Email: email, Mobile: phone})
	if err != nil {
		http.Error(w, "payment gateway unavailable", 502)
		return
	}
	order.Authority = result.Authority
	if err := a.store.PutOrder(order); err != nil {
		http.Error(w, "Could not save order.", 500)
		return
	}
	http.Redirect(w, r, result.RedirectURL, http.StatusSeeOther)
}
func (a *App) paymentRedirect(w http.ResponseWriter, r *http.Request) {
	authority := r.URL.Query().Get("authority")
	orderID := r.URL.Query().Get("order")
	target := "/payments/" + r.PathValue("provider") + "/callback?authority=" + urlQuery(authority) + "&order=" + urlQuery(orderID) + "&status=OK"
	http.Redirect(w, r, target, http.StatusSeeOther)
}
func (a *App) paymentCallback(w http.ResponseWriter, r *http.Request) {
	authority := callbackParam(r, "authority", "Authority")
	orderID := callbackParam(r, "order", "order_id", "OrderID")
	if orderID == "" {
		if order, ok := a.store.FindOrderByAuthority(authority); ok {
			orderID = order.ID
		}
	}
	order, ok := a.store.GetOrder(orderID)
	if !ok || order.Authority != authority {
		renderPage(w, "checkout-status", PageData{Title: "Payment", Heading: "Payment could not be matched", Body: "The payment reference was not recognized. Contact support with your receipt.", Status: "Unmatched payment"})
		return
	}
	if strings.ToUpper(callbackParam(r, "status", "Status")) != "OK" {
		renderPage(w, "checkout-status", PageData{Title: "Payment", Heading: "Payment cancelled", Body: "No charge was recorded."})
		return
	}
	result, err := a.cfg.Gateway.Verify(r.Context(), authority, order.AmountRials)
	if err != nil || !result.Paid {
		renderPage(w, "checkout-status", PageData{Title: "Payment", Heading: "Payment is pending", Body: "We could not verify the payment yet. Keep your receipt and contact support if needed."})
		return
	}
	fulfilled, err := a.fulfillVerifiedPayment(order, result.Reference)
	if err != nil {
		renderPage(w, "checkout-status", PageData{Title: "Payment", Heading: "Payment status unavailable", Body: "Please contact support with your order ID."})
		return
	}
	a.notifyAfterPaidOrder(r.Context(), fulfilled)
	renderPage(w, "checkout-status", a.paymentCompleteDisclosure(w, r, fulfilled.Order, fulfilled.LicenseKey, fulfilled.Created))
}

func (a *App) fulfillVerifiedPayment(order *Order, paymentRef string) (*FulfillResult, error) {
	plan, ok := PlanFromCatalog(order.Plan)
	if !ok {
		return nil, fmt.Errorf("unknown plan")
	}
	return a.store.FulfillOrderPayment(order.ID, paymentRef, a.cfg.LicenseDeliveryKey, plan)
}

// paymentCompleteDisclosure builds the post-payment page.
// Unauthenticated visitors get order status and a masked key only.
// Full plaintext is shown only to an authenticated session that owns the order.
func (a *App) paymentCompleteDisclosure(w http.ResponseWriter, r *http.Request, order *Order, plainKey string, firstIssue bool) PageData {
	masked := ""
	if plainKey != "" {
		masked = MaskLicenseKey(plainKey)
	}
	body := "Your license is ready. Sign in to your account to reveal the full key. A masked reference is shown below."
	if !firstIssue {
		body = "Your payment was already processed. Sign in to your account to view your license key."
	}
	data := PageData{
		Title: "Payment complete", Heading: "Payment received", Body: body,
		Status: order.ID, LicenseMasked: masked,
	}
	if customer, ok := a.customerFromRequest(r); ok && customer.ID == order.CustomerID && plainKey != "" {
		data.LicenseKey = plainKey
		data.Body = "Copy your license key now and store it safely. You can also reveal it later from your account purchases."
		data.CSRFToken = a.ensureCSRF(w, r)
	}
	return data
}

func (a *App) checkoutStatus(w http.ResponseWriter, r *http.Request) {
	orderID := r.URL.Query().Get("order")
	order, ok := a.store.GetOrder(orderID)
	if !ok {
		http.NotFound(w, r)
		return
	}
	data := PageData{Title: "Checkout status", Heading: "Order status", Body: "Order " + html.EscapeString(order.ID), Status: order.Status}
	if order.LicenseID != "" {
		if license, ok := a.store.FindLicenseByID(order.LicenseID); ok && license.DeliveryCiphertext != "" {
			if plain, err := DecryptLicenseKey(a.cfg.LicenseDeliveryKey, license.DeliveryCiphertext); err == nil {
				data.LicenseMasked = MaskLicenseKey(plain)
				if customer, ok := a.customerFromRequest(r); ok && customer.ID == order.CustomerID {
					data.LicenseKey = plain
					data.CSRFToken = a.ensureCSRF(w, r)
					data.Body = "Order " + html.EscapeString(order.ID) + ". Signed-in owners can copy the full license key below or from Purchases."
				} else {
					data.Body = "Order " + html.EscapeString(order.ID) + ". Sign in with the purchase email to reveal the full license key."
				}
			}
		}
	}
	renderPage(w, "checkout-status", data)
}

type activationRequest struct {
	LicenseKey      string `json:"license_key"`
	DevicePublicKey string `json:"device_public_key"`
	AppVersion      string `json:"app_version"`
	Platform        string `json:"platform"`
	DeviceProof     string `json:"device_proof"`
}
type refreshRequest struct {
	DeviceSignature string `json:"device_signature"`
	RequestID       string `json:"request_id"`
	RequestedAt     string `json:"requested_at"`
}
type revokeRequest struct {
	DeviceSignature string `json:"device_signature"`
	RequestID       string `json:"request_id"`
}
type lease struct {
	LeaseVersion    int             `json:"lease_version"`
	KeyID           string          `json:"key_id"`
	LicenseID       string          `json:"license_id"`
	ActivationID    string          `json:"activation_id"`
	DevicePublicKey string          `json:"device_public_key"`
	Plan            string          `json:"plan"`
	Features        map[string]bool `json:"features"`
	IssuedAt        string          `json:"issued_at"`
	OfflineUntil    string          `json:"offline_until"`
}
type signedLeaseResponse struct {
	ActivationID string `json:"activation_id"`
	Lease        lease  `json:"lease"`
	Signature    string `json:"signature"`
}

func (a *App) activate(w http.ResponseWriter, r *http.Request) {
	var body activationRequest
	if !decodeJSON(w, r, &body) {
		return
	}
	if len(body.LicenseKey) < 3 || len(body.DevicePublicKey) < 40 || body.AppVersion == "" || body.Platform == "" {
		errorJSON(w, http.StatusUnprocessableEntity, "invalid_request", "Request body is invalid.")
		return
	}
	if key := r.Header.Get("Idempotency-Key"); key != "" {
		if cached, ok := a.store.Idempotent("activation", key); ok {
			w.Header().Set("Content-Type", "application/json")
			w.Write(cached)
			return
		}
	}
	publicKey, err := ParseDeviceKey(body.DevicePublicKey)
	if err != nil {
		errorJSON(w, 422, "invalid_request", "Request body is invalid.")
		return
	}
	license, ok := a.store.FindLicense(body.LicenseKey)
	if !ok || license.Status != "active" {
		errorJSON(w, http.StatusForbidden, "license_not_available", "The license key is not available.")
		return
	}
	proof := map[string]any{"action": "activate", "license_key_hash": LicenseKeyHash(strings.TrimSpace(body.LicenseKey)), "device_public_key": body.DevicePublicKey, "app_version": body.AppVersion, "platform": body.Platform}
	if body.DeviceProof != "" && !Verify(publicKey, proof, body.DeviceProof) {
		errorJSON(w, 401, "invalid_device_proof", "Device proof could not be verified.")
		return
	}
	existing, exists := a.store.FindActivationByDevice(license.ID, body.DevicePublicKey)
	if exists {
		response, err := a.makeLease(existing, license)
		if err != nil {
			errorJSON(w, 500, "internal_error", "The control plane could not complete the request.")
			return
		}
		a.writeIdempotent(w, r.Header.Get("Idempotency-Key"), "activation", response)
		return
	}
	if a.store.ActiveDeviceCount(license.ID) >= license.MaxDevices {
		errorJSON(w, http.StatusForbidden, "device_limit_reached", "The device activation limit has been reached.")
		return
	}
	now := time.Now().UTC()
	activation := &Activation{ID: randomID("act_"), LicenseID: license.ID, DevicePublicKey: body.DevicePublicKey, Platform: body.Platform, AppVersion: body.AppVersion, CreatedAt: now, LastSeen: now}
	a.store.PutActivation(activation)
	_ = publicKey
	response, err := a.makeLease(activation, license)
	if err != nil {
		errorJSON(w, 500, "internal_error", "The control plane could not complete the request.")
		return
	}
	a.writeIdempotent(w, r.Header.Get("Idempotency-Key"), "activation", response)
}
func (a *App) makeLease(activation *Activation, license *License) (signedLeaseResponse, error) {
	issued := time.Now().UTC().Truncate(time.Second)
	value := lease{LeaseVersion: 1, KeyID: a.cfg.SigningKeyID, LicenseID: license.ID, ActivationID: activation.ID, DevicePublicKey: activation.DevicePublicKey, Plan: license.Plan, Features: cloneFeatures(license.Features), IssuedAt: ISO(issued), OfflineUntil: ISO(issued.Add(time.Duration(a.cfg.LeaseDays) * 24 * time.Hour))}
	signature, err := Sign(a.signingKey, value)
	return signedLeaseResponse{ActivationID: activation.ID, Lease: value, Signature: signature}, err
}
func (a *App) writeIdempotent(w http.ResponseWriter, key, scope string, response signedLeaseResponse) {
	bytes, err := json.Marshal(response)
	if err != nil {
		errorJSON(w, 500, "internal_error", "The control plane could not complete the request.")
		return
	}
	if key != "" {
		a.store.PutIdempotent(scope, key, bytes)
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(bytes)
}

func (a *App) refresh(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	activation, ok := a.store.GetActivation(id)
	if !ok || activation.RevokedAt != nil {
		errorJSON(w, 401, "activation_not_found", "Activation is not available.")
		return
	}
	var body refreshRequest
	if !decodeJSON(w, r, &body) {
		return
	}
	if body.DeviceSignature == "" || body.RequestID == "" || body.RequestedAt == "" {
		errorJSON(w, 422, "invalid_request", "Request body is invalid.")
		return
	}
	publicKey, err := ParseDeviceKey(activation.DevicePublicKey)
	if err != nil || !Verify(publicKey, map[string]any{"action": "refresh", "activation_id": id, "request_id": body.RequestID, "requested_at": body.RequestedAt}, body.DeviceSignature) {
		errorJSON(w, 401, "invalid_device_proof", "Device proof could not be verified.")
		return
	}
	license, ok := a.findLicenseByID(activation.LicenseID)
	if !ok {
		errorJSON(w, 401, "activation_not_found", "Activation is not available.")
		return
	}
	a.store.TouchActivation(id)
	response, err := a.makeLease(activation, license)
	if err != nil {
		errorJSON(w, 500, "internal_error", "The control plane could not complete the request.")
		return
	}
	writeJSON(w, 200, response)
}
func (a *App) revoke(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	activation, ok := a.store.GetActivation(id)
	if !ok {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	var body revokeRequest
	if !decodeJSON(w, r, &body) {
		return
	}
	publicKey, err := ParseDeviceKey(activation.DevicePublicKey)
	if err != nil || !Verify(publicKey, map[string]any{"action": "revoke", "activation_id": id, "request_id": body.RequestID}, body.DeviceSignature) {
		errorJSON(w, 401, "invalid_device_proof", "Device proof could not be verified.")
		return
	}
	a.store.RevokeActivation(id)
	w.WriteHeader(http.StatusNoContent)
}
func (a *App) findLicenseByID(id string) (*License, bool) {
	return a.store.FindLicenseByID(id)
}

func (a *App) aiDraft(w http.ResponseWriter, r *http.Request) {
	activation, ok := a.authLease(r)
	if !ok {
		errorJSON(w, 401, "authentication_required", "A valid signed lease is required.")
		return
	}
	var raw map[string]any
	if !decodeJSON(w, r, &raw) {
		return
	}
	signature, _ := raw["device_signature"].(string)
	requestID, _ := raw["request_id"].(string)
	delete(raw, "device_signature")
	delete(raw, "request_id")
	publicKey, err := ParseDeviceKey(activation.DevicePublicKey)
	payloadHashBytes, _ := CanonicalJSON(raw)
	proof := map[string]any{"action": "ai_draft", "activation_id": activation.ID, "request_id": requestID, "payload_hash": HashHex(payloadHashBytes)}
	if err != nil || !Verify(publicKey, proof, signature) {
		errorJSON(w, 401, "invalid_device_proof", "Device proof could not be verified.")
		return
	}
	writeJSON(w, 200, map[string]string{"summary": "The measured values are within the reviewed operating range.", "methodology": "The report was prepared from the supplied measurements using the selected engineering norm.", "observations": "Review the peak and overall values against the machine baseline.", "recommendations": "Continue scheduled monitoring and investigate any sustained change.", "conclusion": "The available evidence supports continued operation with routine follow-up."})
}
func (a *App) telemetry(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Consent bool             `json:"consent"`
		Events  []map[string]any `json:"events"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if !body.Consent {
		errorJSON(w, 400, "consent_required", "Telemetry requires explicit consent.")
		return
	}
	if len(body.Events) == 0 || len(body.Events) > 100 {
		errorJSON(w, 422, "invalid_request", "Request body is invalid.")
		return
	}
	forbidden := []string{"project_name", "engineer_name", "filename", "path", "report_text", "spectra", "exception", "raw_error", "sp3", "notes"}
	for _, event := range body.Events {
		eventName, _ := event["event_name"].(string)
		if eventName == "" {
			errorJSON(w, 400, "event_not_allowed", "Telemetry event is not allowed.")
			return
		}
		serialized, _ := json.Marshal(event)
		lower := strings.ToLower(string(serialized))
		for _, term := range forbidden {
			if strings.Contains(lower, term) {
				errorJSON(w, 400, "event_not_allowed", "Telemetry event is not allowed.")
				return
			}
		}
	}
	writeJSON(w, 200, map[string]int{"accepted": len(body.Events)})
}
func (a *App) authLease(r *http.Request) (*Activation, bool) {
	id := r.Header.Get("X-Activation-Id")
	encoded := r.Header.Get("X-Lease")
	signature := r.Header.Get("X-Lease-Signature")
	activation, ok := a.store.GetActivation(id)
	if !ok || activation.RevokedAt != nil || encoded == "" || signature == "" {
		return nil, false
	}
	bytes, err := DecodeBytes(encoded, 16384)
	if err != nil {
		return nil, false
	}
	var value lease
	if json.Unmarshal(bytes, &value) != nil || value.ActivationID != id || value.DevicePublicKey != activation.DevicePublicKey || !Verify(a.signingPublic, value, signature) {
		return nil, false
	}
	expiry, err := time.Parse(time.RFC3339, value.OfflineUntil)
	if err != nil || !expiry.After(time.Now().UTC()) {
		return nil, false
	}
	return activation, true
}
func decodeJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	defer r.Body.Close()
	decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		errorJSON(w, 422, "invalid_request", "Request body is invalid.")
		return false
	}
	return true
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func errorJSON(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{"error": map[string]string{"code": code, "message": message}})
}
func randomID(prefix string) string {
	bytes := make([]byte, 10)
	if _, err := rand.Read(bytes); err != nil {
		return prefix + strconv.FormatInt(time.Now().UnixNano(), 10)
	}
	return prefix + EncodeBytes(bytes)
}
func urlQuery(value string) string {
	return strings.NewReplacer("%", "%25", " ", "%20", "?", "%3F", "&", "%26", "=", "%3D").Replace(value)
}

func callbackParam(r *http.Request, keys ...string) string {
	q := r.URL.Query()
	for _, k := range keys {
		if v := q.Get(k); v != "" {
			return v
		}
	}
	return ""
}

func normalizePhone(value string) string {
	value = strings.TrimSpace(value)
	value = strings.NewReplacer(" ", "", "-", "", "(", "", ")", "").Replace(value)
	switch {
	case strings.HasPrefix(value, "+98"):
		value = "0" + strings.TrimPrefix(value, "+98")
	case strings.HasPrefix(value, "0098"):
		value = "0" + strings.TrimPrefix(value, "0098")
	case strings.HasPrefix(value, "9") && len(value) == 10:
		value = "0" + value
	}
	if len(value) != 11 || !strings.HasPrefix(value, "09") {
		return ""
	}
	for _, char := range value {
		if char < '0' || char > '9' {
			return ""
		}
	}
	return value
}
