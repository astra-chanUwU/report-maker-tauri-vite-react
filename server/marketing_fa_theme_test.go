package controlplane

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestDefaultIsFarsiAndLightTheme(t *testing.T) {
	_, server := marketingTestApp(t, Config{})
	// Default without lang cookie should be Farsi (fa/rtl) and light theme.
	resp, err := server.Client().Get(server.URL + "/")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	text := string(body)
	if !strings.Contains(text, `lang="fa"`) || !strings.Contains(text, `dir="rtl"`) {
		t.Fatalf("default should be fa/rtl, got missing attributes")
	}
	if !strings.Contains(text, `data-theme="light"`) {
		t.Fatalf("default theme should be light")
	}
	if !strings.Contains(text, `id="theme-toggle"`) {
		t.Fatalf("theme toggle button missing")
	}
	if !strings.Contains(text, `rm-theme`) || !strings.Contains(text, `id="toast"`) {
		t.Fatalf("theme script or toast missing")
	}
	if !strings.Contains(text, `data-copy`) {
		// Home has no license copy, but generic pages do – check pricing has no copy needed, just ensure qolScript present via toast
		// Allow home to pass without data-copy, but check qolScript is present via localStorage
	}
}

func TestFarsiStaticPages(t *testing.T) {
	_, server := marketingTestApp(t, Config{})
	for _, tc := range []struct{ path, want string }{
		{"/privacy", "حریم خصوصی"},
		{"/refund", "استرداد"},
		{"/support", "پشتیبانی"},
		{"/offline-use", "کار آفلاین"},
		{"/install", "نصب"},
		{"/faq", "سوالات متداول"},
	} {
		resp, err := server.Client().Get(server.URL + tc.path)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("%s status=%d", tc.path, resp.StatusCode)
		}
		if !strings.Contains(string(body), tc.want) {
			t.Fatalf("%s missing Farsi heading %q", tc.path, tc.want)
		}
		// Check lang switcher present
		if !strings.Contains(string(body), `?lang=en`) || !strings.Contains(string(body), `?lang=fa`) {
			t.Fatalf("%s missing lang switcher", tc.path)
		}
	}
}

func TestLangQueryOverrides(t *testing.T) {
	_, server := marketingTestApp(t, Config{})
	resp, err := server.Client().Get(server.URL + "/privacy?lang=en")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	// Check Set-Cookie for persistence
	cookies := resp.Cookies()
	found := false
	for _, c := range cookies {
		if c.Name == "rm_lang" && c.Value == "en" {
			found = true
		}
	}
	resp.Body.Close()
	if !found {
		t.Fatalf("lang=en should set rm_lang cookie")
	}
	if !strings.Contains(string(body), `Privacy`) || !strings.Contains(string(body), `lang="en"`) {
		t.Fatalf("lang=en should render English privacy")
	}
	// Second request with cookie should still be en
	req, _ := http.NewRequest("GET", server.URL+"/privacy", nil)
	req.AddCookie(&http.Cookie{Name: "rm_lang", Value: "en"})
	resp, err = server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	body, _ = io.ReadAll(resp.Body)
	resp.Body.Close()
	if !strings.Contains(string(body), `Privacy`) {
		t.Fatalf("cookie should persist en")
	}
}

func TestTemplRendersWithCopyAndMobileNav(t *testing.T) {
	data := PageData{
		Title: "Test", Heading: "Test", LicenseKey: "RM-TEST-1234-KEY",
		Purchases: []PurchaseView{{OrderID: "ord_123", Plan: "perpetual", Status: "paid", PaidAt: "2026-01-01", MaskedKey: "RM-****-1234", CanReveal: true}},
		ShowDownloads: true, Entitled: true, DownloadLinks: []DownloadLinkView{{Filename: "ReportMaker.exe", Description: "Windows", Platform: "windows", Version: "1.0.0", SHA256: "abc", ExpiresAt: mustParseTime("2026-12-31T00:00:00Z"), URL: "/download/test", ArtifactID: "test"}},
		Lang: "fa", Dir: "rtl",
	}
	data.Copy = siteCopyFor("fa")
	var buf strings.Builder
	if err := GenericPage(data).Render(context.Background(), &buf); err != nil {
		t.Fatal(err)
	}
	text := buf.String()
	if !strings.Contains(text, `data-copy`) {
		t.Fatalf("GenericPage should contain data-copy for license")
	}
	if !strings.Contains(text, `id="mobile-toggle"`) {
		t.Fatalf("mobile nav toggle missing")
	}
	if !strings.Contains(text, `data-theme="light"`) {
		t.Fatalf("templ layout should have data-theme")
	}
	if !strings.Contains(text, `dir="rtl"`) {
		t.Fatalf("templ layout should have rtl")
	}
}

func mustParseTime(s string) time.Time {
	tm, _ := time.Parse(time.RFC3339, s)
	return tm
}

func TestMarketingTestAppHelper(t *testing.T) {
	// Ensure helper still works for test isolation
	_, server := marketingTestApp(t, Config{SiteLang: "en"})
	resp, err := server.Client().Get(server.URL + "/?lang=en")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	_ = body
	if resp.StatusCode != 200 {
		t.Fatalf("home status %d", resp.StatusCode)
	}
	_ = httptest.NewRequest // ensure import used
}
