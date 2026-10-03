package controlplane

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const downloadTokenVersion = "v1"

type downloadTokenPayload struct {
	Version    string `json:"v"`
	CustomerID string `json:"customer_id"`
	ArtifactID string `json:"artifact_id"`
	OrderID    string `json:"order_id"`
	LicenseID  string `json:"license_id"`
	ExpiresAt  int64  `json:"exp"`
}

type DownloadLinkView struct {
	ArtifactID, Filename, Version, Platform, Description, SHA256, InstallInstructions, URL string
	ExpiresAt time.Time
	Expired   bool
}

func (a *App) downloadRoutes() {
	a.mux.HandleFunc("GET /account/downloads", a.customerDownloadsPage)
	a.mux.HandleFunc("POST /account/downloads/renew", a.renewDownloadLink)
	a.mux.HandleFunc("GET /downloads/{artifact_id}", a.serveArtifactDownload)
	a.mux.HandleFunc("GET /downloads/link/{token}", a.serveTokenDownload)
}

func (a *App) customerDownloadsPage(w http.ResponseWriter, r *http.Request) {
	customer, ok := a.customerFromRequest(r)
	if !ok {
		http.Redirect(w, r, "/login?return_to="+urlQueryPath("/account/downloads"), http.StatusSeeOther)
		return
	}
	entitlement, entitled := a.store.CustomerDownloadEntitlement(customer.ID)
	links := []DownloadLinkView{}
	if entitled {
		for _, artifact := range a.releases.Artifacts {
			token, expires, err := a.issueDownloadToken(customer.ID, artifact.ID, entitlement.OrderID, entitlement.LicenseID, a.downloadLinkTTL())
			if err != nil {
				http.Error(w, "could not prepare download links", http.StatusInternalServerError)
				return
			}
			links = append(links, DownloadLinkView{
				ArtifactID: artifact.ID, Filename: artifact.Filename, Version: artifact.Version,
				Platform: artifact.Platform, Description: artifact.Description, SHA256: artifact.SHA256,
				InstallInstructions: installInstructionsForPlatform(artifact.Platform),
				URL: a.cfg.PublicBaseURL + "/downloads/link/" + token, ExpiresAt: expires,
			})
		}
	}
	renderPage(w, "downloads", PageData{
		Title: "Downloads", Heading: "Download Report Maker desktop",
		Body:  "Install the offline desktop app on your machine. Verify the SHA-256 checksum after download.",
		CSRFToken: a.ensureCSRF(w, r), ShowLogout: true, ExtraScript: false, ShowDownloads: true,
		DownloadLinks: links, Entitled: entitled, OrderID: entitlement.OrderID,
	})
}

func (a *App) renewDownloadLink(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Error(w, "invalid form", http.StatusBadRequest)
		return
	}
	if !a.requireCSRF(w, r) {
		return
	}
	customer, ok := a.customerFromRequest(r)
	if !ok {
		http.Error(w, "sign in required", http.StatusUnauthorized)
		return
	}
	artifactID := strings.TrimSpace(r.FormValue("artifact_id"))
	if artifactID == "" {
		http.Error(w, "artifact id required", http.StatusBadRequest)
		return
	}
	if _, ok := a.releases.Find(artifactID); !ok {
		http.NotFound(w, r)
		return
	}
	if _, entitled := a.store.CustomerDownloadEntitlement(customer.ID); !entitled {
		http.Error(w, "download not entitled", http.StatusForbidden)
		return
	}
	http.Redirect(w, r, "/account/downloads", http.StatusSeeOther)
}

func (a *App) serveArtifactDownload(w http.ResponseWriter, r *http.Request) {
	customer, ok := a.customerFromRequest(r)
	if !ok {
		http.Error(w, "sign in required", http.StatusUnauthorized)
		return
	}
	a.serveEntitledArtifact(w, r, customer.ID, r.PathValue("artifact_id"), "", "")
}

func (a *App) serveTokenDownload(w http.ResponseWriter, r *http.Request) {
	payload, err := a.verifyDownloadToken(r.PathValue("token"))
	if err != nil {
		http.Error(w, "download link is invalid or expired", http.StatusUnauthorized)
		return
	}
	if !payload.expiresAt().After(time.Now().UTC()) {
		http.Error(w, "download link expired; sign in to renew it", http.StatusUnauthorized)
		return
	}
	a.serveEntitledArtifact(w, r, payload.CustomerID, payload.ArtifactID, payload.OrderID, payload.LicenseID)
}

func (a *App) serveEntitledArtifact(w http.ResponseWriter, r *http.Request, customerID, artifactID, orderID, licenseID string) {
	if !a.rateLimitDownload(w, r, customerID) {
		return
	}
	artifact, ok := a.releases.Find(artifactID)
	if !ok {
		http.NotFound(w, r)
		return
	}
	if orderID == "" || licenseID == "" {
		entitlement, entitled := a.store.CustomerDownloadEntitlement(customerID)
		if !entitled {
			http.Error(w, "download not entitled", http.StatusForbidden)
			return
		}
		orderID, licenseID = entitlement.OrderID, entitlement.LicenseID
	} else if entitled, err := a.store.CustomerEntitledForLicense(customerID, licenseID); err != nil || !entitled {
		http.Error(w, "download not entitled", http.StatusForbidden)
		return
	}
	path, err := a.releases.ResolveArtifactPath(artifact.RelativePath)
	if err != nil {
		http.Error(w, "artifact unavailable", http.StatusNotFound)
		return
	}
	if err := VerifyArtifactChecksum(path, artifact.SHA256); err != nil {
		http.Error(w, "artifact failed integrity check", http.StatusServiceUnavailable)
		return
	}
	file, info, err := OpenArtifactFile(a.releases.Root, artifact.RelativePath)
	if err != nil {
		http.Error(w, "artifact unavailable", http.StatusNotFound)
		return
	}
	defer file.Close()
	if err := a.store.RecordDownload(&DownloadRecord{
		ID: randomID("dl_"), OrderID: orderID, LicenseID: licenseID, Artifact: artifact.ID, CreatedAt: time.Now().UTC(),
	}); err != nil {
		http.Error(w, "could not record download", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, artifact.Filename))
	http.ServeContent(w, r, artifact.Filename, info.ModTime(), file)
}

func (a *App) rateLimitDownload(w http.ResponseWriter, r *http.Request, customerID string) bool {
	key := "download:" + customerID + ":" + a.clientIP(r)
	if a.rateLimits.allow(key, a.downloadRateLimit(), 15*time.Minute) {
		return true
	}
	http.Error(w, "Too many download requests. Please try again later.", http.StatusTooManyRequests)
	return false
}

func (a *App) downloadLinkTTL() time.Duration {
	if a.cfg.DownloadLinkTTLHours > 0 {
		return time.Duration(a.cfg.DownloadLinkTTLHours) * time.Hour
	}
	return 24 * time.Hour
}

func (a *App) downloadRateLimit() int {
	if a.cfg.DownloadRateLimit > 0 {
		return a.cfg.DownloadRateLimit
	}
	return 30
}

func (a *App) issueDownloadToken(customerID, artifactID, orderID, licenseID string, ttl time.Duration) (string, time.Time, error) {
	expires := time.Now().UTC().Add(ttl)
	payload := downloadTokenPayload{
		Version: downloadTokenVersion, CustomerID: customerID, ArtifactID: artifactID,
		OrderID: orderID, LicenseID: licenseID, ExpiresAt: expires.Unix(),
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return "", time.Time{}, err
	}
	mac := hmac.New(sha256.New, a.signingKey)
	mac.Write(encoded)
	signature := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	token := base64.RawURLEncoding.EncodeToString(encoded) + "." + signature
	return token, expires, nil
}

func (a *App) verifyDownloadToken(token string) (*downloadTokenPayload, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return nil, errors.New("invalid token")
	}
	encoded, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, err
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, err
	}
	mac := hmac.New(sha256.New, a.signingKey)
	mac.Write(encoded)
	if !hmac.Equal(signature, mac.Sum(nil)) {
		return nil, errors.New("invalid token signature")
	}
	var payload downloadTokenPayload
	if err := json.Unmarshal(encoded, &payload); err != nil || payload.Version != downloadTokenVersion {
		return nil, errors.New("invalid token payload")
	}
	return &payload, nil
}

func (p downloadTokenPayload) expiresAt() time.Time {
	return time.Unix(p.ExpiresAt, 0).UTC()
}

func urlQueryPath(path string) string {
	return url.QueryEscape(path)
}

// Update public download page to steer customers toward entitled downloads.
func (a *App) download(w http.ResponseWriter, r *http.Request) {
	customer, signedIn := a.customerFromRequest(r)
	body := "Sign in after purchase to download the offline desktop installer with checksum verification."
	if signedIn {
		if _, entitled := a.store.CustomerDownloadEntitlement(customer.ID); entitled {
			http.Redirect(w, r, "/account/downloads", http.StatusSeeOther)
			return
		}
		body = "Complete purchase to unlock downloads, or sign in with the account used at checkout."
	}
	renderPage(w, "home", PageData{
		Title: "Download", Heading: "Download Report Maker",
		Body: body, CSRFToken: a.ensureCSRF(w, r),
	})
}

func installInstructionsForPlatform(platform string) string {
	switch strings.ToLower(strings.TrimSpace(platform)) {
	case "windows x64":
		return "Download the .exe, verify SHA-256, then run the installer."
	case "macos universal", "macos":
		return "Download the .dmg, verify SHA-256, open it, and drag Report Maker into Applications."
	default:
		return "Download the installer, verify SHA-256, then follow platform prompts."
	}
}

func downloadTokenExpiryFromEnv(raw string, fallback int) int {
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 || value > 168 {
		return fallback
	}
	return value
}
