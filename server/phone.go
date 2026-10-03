package controlplane

import (
	"crypto/rand"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"time"
)

func (a *App) phoneRoutes() {
	a.mux.HandleFunc("POST /auth/phone/request-code", a.requestPhoneCode)
	a.mux.HandleFunc("POST /auth/phone/verify", a.verifyPhoneCode)
}

func (a *App) requestPhoneCode(w http.ResponseWriter, r *http.Request) {
	customer, ok := a.customerFromRequest(r)
	if !ok {
		http.Error(w, "sign in required", http.StatusUnauthorized)
		return
	}
	if err := r.ParseForm(); err != nil {
		http.Error(w, "invalid form", http.StatusBadRequest)
		return
	}
	if !a.requireCSRF(w, r) {
		return
	}
	if !a.rateLimit(w, r, "phone-request", 5, 15*time.Minute) {
		return
	}
	if customer.Phone == "" {
		http.Error(w, "no phone number on file", http.StatusUnprocessableEntity)
		return
	}
	code, err := randomDigits(6)
	if err != nil {
		http.Error(w, "could not create verification code", http.StatusInternalServerError)
		return
	}
	now := time.Now().UTC()
	challenge := &PhoneChallenge{
		ID: randomID("phc_"), CustomerID: customer.ID,
		CodeHash: hashToken(code), ExpiresAt: now.Add(10 * time.Minute), CreatedAt: now,
	}
	if err := a.store.PutPhoneChallenge(challenge); err != nil {
		http.Error(w, "could not save verification code", http.StatusInternalServerError)
		return
	}
	if err := a.sms.Send(r.Context(), SMSMessage{
		To: customer.Phone, Body: fmt.Sprintf("Your Report Maker verification code is %s", code),
	}); err != nil {
		http.Error(w, "could not send SMS", http.StatusBadGateway)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "code_sent"})
}

func (a *App) verifyPhoneCode(w http.ResponseWriter, r *http.Request) {
	customer, ok := a.customerFromRequest(r)
	if !ok {
		http.Error(w, "sign in required", http.StatusUnauthorized)
		return
	}
	var body struct {
		Code string `json:"code"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if !a.requireCSRF(w, r) {
		return
	}
	code := strings.TrimSpace(body.Code)
	if len(code) != 6 {
		errorJSON(w, http.StatusUnprocessableEntity, "invalid_code", "Enter the 6-digit code.")
		return
	}
	challenge, ok := a.store.ConsumePhoneChallenge(customer.ID, hashToken(code))
	if !ok {
		errorJSON(w, http.StatusUnauthorized, "invalid_code", "Verification code is invalid or expired.")
		return
	}
	_ = challenge
	now := time.Now().UTC()
	customer.PhoneVerifiedAt = &now
	customer.UpdatedAt = now
	if err := a.store.PutCustomer(customer); err != nil {
		http.Error(w, "could not update phone verification", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "phone_verified"})
}

func randomDigits(n int) (string, error) {
	var digits strings.Builder
	for i := 0; i < n; i++ {
		v, err := rand.Int(rand.Reader, big.NewInt(10))
		if err != nil {
			return "", err
		}
		digits.WriteByte(byte('0' + v.Int64()))
	}
	return digits.String(), nil
}
