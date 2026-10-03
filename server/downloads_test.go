package controlplane

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func testDownloadApp(t *testing.T) (*App, *httptest.Server, string) {
	t.Helper()
	root := t.TempDir()
	payload := []byte("report-maker-test-artifact")
	sum := sha256.Sum256(payload)
	artifactPath := filepath.Join(root, "windows-x64", "ReportMaker_1.0.0_x64-setup.exe")
	if err := os.MkdirAll(filepath.Dir(artifactPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(artifactPath, payload, 0o644); err != nil {
		t.Fatal(err)
	}
	manifest := filepath.Join(root, "releases-test.json")
	manifestBody := `[{"id":"desktop-windows-x64","version":"1.0.0","filename":"ReportMaker_1.0.0_x64-setup.exe","sha256":"` + hex.EncodeToString(sum[:]) + `","relative_path":"windows-x64/ReportMaker_1.0.0_x64-setup.exe","platform":"Windows x64","description":"Test build"}]`
	if err := os.WriteFile(manifest, []byte(manifestBody), 0o644); err != nil {
		t.Fatal(err)
	}
	deliveryKey, _ := LoadDeliveryKey(EncodeBytes(make([]byte, 32)))
	cfg := Config{
		SigningKeyID: "test-key", LeaseDays: 30, AllowDevSeed: false,
		PublicBaseURL: "http://example.test", ArtifactRoot: root, ReleaseManifest: manifest,
		DownloadLinkTTLHours: 24, DownloadRateLimit: 100, LicenseDeliveryKey: deliveryKey,
	}
	app, err := NewApp(cfg)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(app.Handler())
	t.Cleanup(server.Close)
	app.cfg.PublicBaseURL = server.URL
	return app, server, hex.EncodeToString(sum[:])
}

func seedEntitledCustomer(t *testing.T, app *App, customerID string) *http.Cookie {
	t.Helper()
	now := time.Now().UTC()
	if err := app.store.PutCustomer(&Customer{ID: customerID, FirstName: "Down", LastName: "Loader", Email: customerID + "@example.com", CreatedAt: now, UpdatedAt: now}); err != nil {
		t.Fatal(err)
	}
	license := &License{ID: "lic_" + customerID, KeyHash: LicenseKeyHash("RM-DL-" + customerID), Plan: "perpetual", Status: "active", Features: map[string]bool{"core_export": true}, MaxDevices: 3}
	if _, err := app.store.InsertPaidOrderWithLicense(customerID, license, "ord_"+customerID); err != nil {
		t.Fatal(err)
	}
	token, err := randomToken(32)
	if err != nil {
		t.Fatal(err)
	}
	if err := app.store.PutCustomerSession(&CustomerSession{ID: "ses_" + customerID, CustomerID: customerID, TokenHash: hashToken(token), ExpiresAt: now.Add(time.Hour), CreatedAt: now, LastSeenAt: now}); err != nil {
		t.Fatal(err)
	}
	return &http.Cookie{Name: customerSessionCookie, Value: token}
}

func TestEntitledRepeatDownload(t *testing.T) {
	app, server, checksum := testDownloadApp(t)
	cookie := seedEntitledCustomer(t, app, "cus_repeat")
	client := server.Client()
	for i := 0; i < 2; i++ {
		req, _ := http.NewRequest(http.MethodGet, server.URL+"/downloads/desktop-windows-x64", nil)
		req.AddCookie(cookie)
		resp, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("download %d status=%d body=%q", i, resp.StatusCode, body)
		}
		if got := sha256.Sum256(body); hex.EncodeToString(got[:]) != checksum {
			t.Fatalf("download %d checksum mismatch", i)
		}
	}
}

func TestExpiredLinkRenewAfterAuth(t *testing.T) {
	app, server, _ := testDownloadApp(t)
	cookie := seedEntitledCustomer(t, app, "cus_renew")
	entitlement, ok := app.store.CustomerDownloadEntitlement("cus_renew")
	if !ok {
		t.Fatal("expected entitlement")
	}
	expiredToken, _, err := app.issueDownloadToken("cus_renew", "desktop-windows-x64", entitlement.OrderID, entitlement.LicenseID, -time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	client := server.Client()
	expiredReq, _ := http.NewRequest(http.MethodGet, server.URL+"/downloads/link/"+expiredToken, nil)
	expiredResp, err := client.Do(expiredReq)
	if err != nil {
		t.Fatal(err)
	}
	expiredResp.Body.Close()
	if expiredResp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expired token status=%d, want 401", expiredResp.StatusCode)
	}
	pageReq, _ := http.NewRequest(http.MethodGet, server.URL+"/account/downloads", nil)
	pageReq.AddCookie(cookie)
	pageResp, err := client.Do(pageReq)
	if err != nil {
		t.Fatal(err)
	}
	pageBody, _ := io.ReadAll(pageResp.Body)
	pageResp.Body.Close()
	if pageResp.StatusCode != http.StatusOK || !strings.Contains(string(pageBody), "/downloads/link/") {
		t.Fatalf("downloads page missing renewed link: status=%d", pageResp.StatusCode)
	}
	directReq, _ := http.NewRequest(http.MethodGet, server.URL+"/downloads/desktop-windows-x64", nil)
	directReq.AddCookie(cookie)
	directResp, err := client.Do(directReq)
	if err != nil {
		t.Fatal(err)
	}
	directResp.Body.Close()
	if directResp.StatusCode != http.StatusOK {
		t.Fatalf("authenticated download after renew status=%d", directResp.StatusCode)
	}
}

func TestNonEntitledDownloadDenied(t *testing.T) {
	app, server, _ := testDownloadApp(t)
	now := time.Now().UTC()
	if err := app.store.PutCustomer(&Customer{ID: "cus_none", Email: "none@example.com", CreatedAt: now, UpdatedAt: now}); err != nil {
		t.Fatal(err)
	}
	token, _ := randomToken(32)
	if err := app.store.PutCustomerSession(&CustomerSession{ID: "ses_none", CustomerID: "cus_none", TokenHash: hashToken(token), ExpiresAt: now.Add(time.Hour), CreatedAt: now, LastSeenAt: now}); err != nil {
		t.Fatal(err)
	}
	cookie := &http.Cookie{Name: customerSessionCookie, Value: token}
	req, _ := http.NewRequest(http.MethodGet, server.URL+"/downloads/desktop-windows-x64", nil)
	req.AddCookie(cookie)
	resp, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("non-entitled status=%d, want 403", resp.StatusCode)
	}
}

func TestPathTraversalDenied(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "secret.txt"), []byte("secret"), 0o644); err != nil {
		t.Fatal(err)
	}
	catalog, err := LoadReleaseCatalog(root, "")
	if err != nil {
		t.Fatal(err)
	}
	for _, relative := range []string{"../secret.txt", "..\\secret.txt", "/etc/passwd"} {
		if path, err := catalog.ResolveArtifactPath(relative); err == nil {
			t.Fatalf("relative %q resolved to %q, want error", relative, path)
		}
	}
	app, server, _ := testDownloadApp(t)
	cookie := seedEntitledCustomer(t, app, "cus_traversal")
	absRoot, _ := filepath.Abs(app.releases.Root)
	app.releases = &ReleaseCatalog{
		Root: absRoot,
		Artifacts: []ReleaseArtifact{{ID: "desktop-windows-x64", Filename: "secret.txt", RelativePath: "../secret.txt"}},
		byID: map[string]ReleaseArtifact{"desktop-windows-x64": {ID: "desktop-windows-x64", Filename: "secret.txt", RelativePath: "../secret.txt"}},
	}
	req, _ := http.NewRequest(http.MethodGet, server.URL+"/downloads/desktop-windows-x64", nil)
	req.AddCookie(cookie)
	resp, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("traversal download status=%d, want 404", resp.StatusCode)
	}
}
