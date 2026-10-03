package controlplane

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"regexp"
	"strings"
	"testing"
	"time"
)

func testAppWithOutbox(t *testing.T, allowDevSeed bool) (*App, *httptest.Server, *LocalOutbox) {
	t.Helper()
	outbox := &LocalOutbox{}
	cfg := Config{
		SigningKeyID: "test-key", LeaseDays: 30, AllowDevSeed: allowDevSeed,
		PublicBaseURL: "http://example.test", AdminPassword: "admin-secret",
		EmailSender: outbox, SMSSender: &FakeSMS{},
	}
	app, err := NewApp(cfg)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(app.Handler())
	t.Cleanup(server.Close)
	app.cfg.PublicBaseURL = server.URL
	app.cfg.Gateway = DemoGateway{BaseURL: server.URL}
	return app, server, outbox
}

func fetchCSRF(t *testing.T, client *http.Client, baseURL string) (token string, cookies []*http.Cookie) {
	t.Helper()
	resp, err := client.Get(baseURL + "/login")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	for _, c := range resp.Cookies() {
		if c.Name == csrfCookieName {
			token = c.Value
		}
		cookies = append(cookies, c)
	}
	if token == "" {
		body, _ := io.ReadAll(resp.Body)
		re := regexp.MustCompile(`name="csrf_token" value="([^"]+)"`)
		if m := re.FindSubmatch(body); len(m) == 2 {
			token = string(m[1])
		}
	}
	if token == "" {
		t.Fatal("CSRF token not found")
	}
	return token, cookies
}

func TestMagicLinkDevHeaderVsProductionOutbox(t *testing.T) {
	t.Run("AllowDevSeed", func(t *testing.T) {
		app, server, outbox := testAppWithOutbox(t, true)
		now := time.Now().UTC()
		if err := app.store.PutCustomer(&Customer{ID: "cus_dev", Email: "dev@example.com", CreatedAt: now, UpdatedAt: now}); err != nil {
			t.Fatal(err)
		}
		client := server.Client()
		token, cookies := fetchCSRF(t, client, server.URL)
		form := url.Values{"email": {"dev@example.com"}, "csrf_token": {token}}
		req, _ := http.NewRequest(http.MethodPost, server.URL+"/auth/magic-link/request", strings.NewReader(form.Encode()))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		for _, c := range cookies {
			req.AddCookie(c)
		}
		resp, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		if resp.Header.Get("X-Dev-Magic-Link") == "" {
			t.Fatal("expected X-Dev-Magic-Link header in dev mode")
		}
		resp.Body.Close()
		if len(outbox.Messages) != 1 {
			t.Fatalf("outbox messages = %d, want 1", len(outbox.Messages))
		}
	})

	t.Run("ProductionNoHeader", func(t *testing.T) {
		app, server, outbox := testAppWithOutbox(t, false)
		now := time.Now().UTC()
		if err := app.store.PutCustomer(&Customer{ID: "cus_prod", Email: "prod@example.com", CreatedAt: now, UpdatedAt: now}); err != nil {
			t.Fatal(err)
		}
		client := server.Client()
		token, cookies := fetchCSRF(t, client, server.URL)
		form := url.Values{"email": {"prod@example.com"}, "csrf_token": {token}}
		req, _ := http.NewRequest(http.MethodPost, server.URL+"/auth/magic-link/request", strings.NewReader(form.Encode()))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		for _, c := range cookies {
			req.AddCookie(c)
		}
		resp, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		if resp.Header.Get("X-Dev-Magic-Link") != "" {
			t.Fatal("production must not expose magic link header")
		}
		resp.Body.Close()
		if len(outbox.Messages) != 1 || !strings.Contains(outbox.Messages[0].Body, "/auth/magic-link/consume?token=") {
			t.Fatalf("outbox missing magic link URL: %#v", outbox.Messages)
		}
	})
}

func TestMagicLinkRateLimit(t *testing.T) {
	app, server, _ := testAppWithOutbox(t, true)
	now := time.Now().UTC()
	if err := app.store.PutCustomer(&Customer{ID: "cus_rl", Email: "rl@example.com", CreatedAt: now, UpdatedAt: now}); err != nil {
		t.Fatal(err)
	}
	client := server.Client()
	token, cookies := fetchCSRF(t, client, server.URL)
	for i := 0; i < 6; i++ {
		form := url.Values{"email": {"rl@example.com"}, "csrf_token": {token}}
		req, _ := http.NewRequest(http.MethodPost, server.URL+"/auth/magic-link/request", strings.NewReader(form.Encode()))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		for _, c := range cookies {
			req.AddCookie(c)
		}
		resp, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		if i < 5 && resp.StatusCode != http.StatusAccepted {
			t.Fatalf("request %d status=%d", i, resp.StatusCode)
		}
		if i == 5 && resp.StatusCode != http.StatusTooManyRequests {
			t.Fatalf("request 6 status=%d, want 429", resp.StatusCode)
		}
		resp.Body.Close()
	}
}

func TestCheckoutCSRFRequired(t *testing.T) {
	_, server, _ := testAppWithOutbox(t, true)
	form := url.Values{"plan": {"perpetual"}, "first_name": {"A"}, "last_name": {"B"}, "email": {"a@b.com"}, "phone": {"09120000000"}}
	req, _ := http.NewRequest(http.MethodPost, server.URL+"/checkout/start", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("checkout without CSRF status=%d, want 403", resp.StatusCode)
	}
}

func TestSessionRotation(t *testing.T) {
	app, server, _ := testAppWithOutbox(t, true)
	now := time.Now().UTC()
	hash, _ := hashPassword("a-long-development-password")
	if err := app.store.PutCustomer(&Customer{ID: "cus_rot", Email: "rot@example.com", PasswordHash: hash, CreatedAt: now, UpdatedAt: now}); err != nil {
		t.Fatal(err)
	}
	baseClient := server.Client()
	token, cookies := fetchCSRF(t, baseClient, server.URL)
	client := *baseClient
	client.CheckRedirect = func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }

	login1, _ := http.NewRequest(http.MethodPost, server.URL+"/auth/password/login", strings.NewReader(`{"email":"rot@example.com","password":"a-long-development-password"}`))
	login1.Header.Set("Content-Type", "application/json")
	login1.Header.Set("X-CSRF-Token", token)
	for _, c := range cookies {
		login1.AddCookie(c)
	}
	resp1, err := client.Do(login1)
	if err != nil {
		t.Fatal(err)
	}
	oldCookie := sessionCookie(resp1.Cookies())
	if oldCookie == nil {
		t.Fatal("expected session cookie after first login")
	}
	resp1.Body.Close()

	account1, _ := http.NewRequest(http.MethodGet, server.URL+"/account", nil)
	account1.AddCookie(oldCookie)
	accResp1, err := client.Do(account1)
	if err != nil {
		t.Fatal(err)
	}
	accResp1.Body.Close()
	if accResp1.StatusCode != http.StatusOK {
		t.Fatalf("first session account status=%d", accResp1.StatusCode)
	}

	login2, _ := http.NewRequest(http.MethodPost, server.URL+"/auth/password/login", strings.NewReader(`{"email":"rot@example.com","password":"a-long-development-password"}`))
	login2.Header.Set("Content-Type", "application/json")
	login2.Header.Set("X-CSRF-Token", token)
	for _, c := range cookies {
		login2.AddCookie(c)
	}
	resp2, err := client.Do(login2)
	if err != nil {
		t.Fatal(err)
	}
	resp2.Body.Close()

	account2, _ := http.NewRequest(http.MethodGet, server.URL+"/account", nil)
	account2.AddCookie(oldCookie)
	accResp2, err := client.Do(account2)
	if err != nil {
		t.Fatal(err)
	}
	accResp2.Body.Close()
	if accResp2.StatusCode != http.StatusSeeOther {
		t.Fatalf("old session cookie should redirect after rotation, got status=%d", accResp2.StatusCode)
	}
}

func sessionCookie(cookies []*http.Cookie) *http.Cookie {
	for _, c := range cookies {
		if c.Name == customerSessionCookie {
			return c
		}
	}
	return nil
}

func TestAdminRejectsCustomerSession(t *testing.T) {
	app, server, _ := testAppWithOutbox(t, true)
	now := time.Now().UTC()
	if err := app.store.PutCustomer(&Customer{ID: "cus_admin", Email: "cust@example.com", CreatedAt: now, UpdatedAt: now}); err != nil {
		t.Fatal(err)
	}
	baseClient := server.Client()
	csrf, cookies := fetchCSRF(t, baseClient, server.URL)
	client := *baseClient
	client.CheckRedirect = func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }

	token, _ := randomToken(32)
	sessNow := time.Now().UTC()
	if err := app.store.PutCustomerSession(&CustomerSession{ID: "ses_test", CustomerID: "cus_admin", TokenHash: hashToken(token), ExpiresAt: sessNow.Add(time.Hour), CreatedAt: sessNow, LastSeenAt: sessNow}); err != nil {
		t.Fatal(err)
	}
	customerCookie := &http.Cookie{Name: customerSessionCookie, Value: token}

	adminReq, _ := http.NewRequest(http.MethodGet, server.URL+"/admin", nil)
	adminReq.AddCookie(customerCookie)
	adminResp, err := client.Do(adminReq)
	if err != nil {
		t.Fatal(err)
	}
	adminResp.Body.Close()
	if adminResp.StatusCode != http.StatusSeeOther || !strings.Contains(adminResp.Header.Get("Location"), "/admin/login") {
		t.Fatalf("customer cookie must not access admin: status=%d loc=%q", adminResp.StatusCode, adminResp.Header.Get("Location"))
	}

	loginForm := url.Values{"password": {"admin-secret"}, "csrf_token": {csrf}}
	loginReq, _ := http.NewRequest(http.MethodPost, server.URL+"/admin/login", strings.NewReader(loginForm.Encode()))
	loginReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	for _, c := range cookies {
		loginReq.AddCookie(c)
	}
	loginResp, err := client.Do(loginReq)
	if err != nil {
		t.Fatal(err)
	}
	if loginResp.StatusCode != http.StatusSeeOther {
		t.Fatalf("admin login status=%d", loginResp.StatusCode)
	}
	adminCookie := loginResp.Cookies()[0]
	loginResp.Body.Close()

	adminOK, _ := http.NewRequest(http.MethodGet, server.URL+"/admin", nil)
	adminOK.AddCookie(adminCookie)
	okResp, err := client.Do(adminOK)
	if err != nil {
		t.Fatal(err)
	}
	defer okResp.Body.Close()
	body, _ := io.ReadAll(okResp.Body)
	if okResp.StatusCode != http.StatusOK || !strings.Contains(string(body), "Admin") {
		t.Fatalf("admin access failed: status=%d body=%q", okResp.StatusCode, body)
	}
}

func TestPhoneVerifyHappyPath(t *testing.T) {
	app, server, _ := testAppWithOutbox(t, true)
	now := time.Now().UTC()
	if err := app.store.PutCustomer(&Customer{ID: "cus_phone", Email: "phone@example.com", Phone: "09120000000", CreatedAt: now, UpdatedAt: now}); err != nil {
		t.Fatal(err)
	}
	client := server.Client()
	csrf, cookies := fetchCSRF(t, client, server.URL)

	sessToken, _ := randomToken(32)
	if err := app.store.PutCustomerSession(&CustomerSession{ID: "ses_phone", CustomerID: "cus_phone", TokenHash: hashToken(sessToken), ExpiresAt: now.Add(time.Hour), CreatedAt: now, LastSeenAt: now}); err != nil {
		t.Fatal(err)
	}
	sessionCookie := &http.Cookie{Name: customerSessionCookie, Value: sessToken}

	codeReqForm := url.Values{"csrf_token": {csrf}}
	codeReq, _ := http.NewRequest(http.MethodPost, server.URL+"/auth/phone/request-code", strings.NewReader(codeReqForm.Encode()))
	codeReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	codeReq.Header.Set("X-CSRF-Token", csrf)
	codeReq.AddCookie(sessionCookie)
	for _, c := range cookies {
		if c.Name == csrfCookieName {
			codeReq.AddCookie(c)
		}
	}
	codeResp, err := client.Do(codeReq)
	if err != nil {
		t.Fatal(err)
	}
	codeResp.Body.Close()
	if codeResp.StatusCode != http.StatusAccepted {
		t.Fatalf("request code status=%d", codeResp.StatusCode)
	}
	fake := app.FakeSMSRef()
	if fake == nil || len(fake.Messages) != 1 {
		t.Fatal("expected SMS message")
	}
	re := regexp.MustCompile(`(\d{6})`)
	m := re.FindStringSubmatch(fake.Messages[0].Body)
	if len(m) != 2 {
		t.Fatalf("no code in SMS: %q", fake.Messages[0].Body)
	}

	verifyReq, _ := http.NewRequest(http.MethodPost, server.URL+"/auth/phone/verify", strings.NewReader(`{"code":"`+m[1]+`"}`))
	verifyReq.Header.Set("Content-Type", "application/json")
	verifyReq.Header.Set("X-CSRF-Token", csrf)
	verifyReq.AddCookie(sessionCookie)
	for _, c := range cookies {
		if c.Name == csrfCookieName {
			verifyReq.AddCookie(c)
		}
	}
	verifyResp, err := client.Do(verifyReq)
	if err != nil {
		t.Fatal(err)
	}
	verifyResp.Body.Close()
	if verifyResp.StatusCode != http.StatusOK {
		t.Fatalf("verify status=%d", verifyResp.StatusCode)
	}
	customer, ok := app.store.GetCustomer("cus_phone")
	if !ok || customer.PhoneVerifiedAt == nil {
		t.Fatal("phone_verified_at not set")
	}
}
