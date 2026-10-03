package controlplane

import (
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func checkoutTestApp(t *testing.T) (*App, *httptest.Server) {
	t.Helper()
	return testAppWithGateway(t, DemoGateway{})
}

func submitCheckout(t *testing.T, server *httptest.Server, form url.Values) string {
	t.Helper()
	csrf, csrfCookies := fetchCSRF(t, server.Client(), server.URL)
	form.Set("csrf_token", csrf)
	form.Set("plan", "perpetual")
	request, _ := http.NewRequest(http.MethodPost, server.URL+"/checkout/start", strings.NewReader(form.Encode()))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	for _, c := range csrfCookies {
		request.AddCookie(c)
	}
	noRedirect := *server.Client()
	noRedirect.CheckRedirect = func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }
	response, err := noRedirect.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusSeeOther {
		t.Fatalf("checkout status=%d", response.StatusCode)
	}
	redirected, err := noRedirect.Get(response.Header.Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	callbackLocation := redirected.Header.Get("Location")
	redirected.Body.Close()
	if callbackLocation == "" {
		t.Fatal("missing callback redirect")
	}
	callback, err := noRedirect.Get(server.URL + callbackLocation)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(callback.Body)
	callback.Body.Close()
	if !strings.Contains(string(body), "Payment received") {
		t.Fatalf("callback body missing success: %s", body)
	}
	parsed, _ := url.Parse(server.URL + callbackLocation)
	orderID := parsed.Query().Get("order")
	if orderID == "" {
		t.Fatal("missing order id in callback")
	}
	return orderID
}

func signInViaMagicLink(t *testing.T, app *App, server *httptest.Server, email string) *http.Client {
	t.Helper()
	outbox, ok := app.email.(*LocalOutbox)
	if !ok {
		t.Fatal("expected LocalOutbox for magic link test")
	}
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	client := &http.Client{Jar: jar}
	csrf, cookies := fetchCSRF(t, client, server.URL)
	form := url.Values{"email": {email}, "csrf_token": {csrf}}
	req, _ := http.NewRequest(http.MethodPost, server.URL+"/auth/magic-link/request", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	for _, c := range cookies {
		req.AddCookie(c)
	}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if len(outbox.Messages) == 0 {
		t.Fatal("magic link not sent")
	}
	link := outbox.Messages[len(outbox.Messages)-1].Body
	start := strings.LastIndex(link, "/auth/magic-link/consume?token=")
	if start < 0 {
		t.Fatalf("magic link URL missing: %q", link)
	}
	token := strings.TrimSpace(link[start+len("/auth/magic-link/consume?token="):])
	noRedirect := *client
	noRedirect.CheckRedirect = func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }
	consume, err := noRedirect.Get(server.URL + "/auth/magic-link/consume?token=" + url.QueryEscape(token))
	if err != nil {
		t.Fatal(err)
	}
	consume.Body.Close()
	if consume.StatusCode != http.StatusSeeOther {
		t.Fatalf("magic link consume status=%d", consume.StatusCode)
	}
	parsed, _ := url.Parse(server.URL)
	for _, c := range consume.Cookies() {
		jar.SetCookies(parsed, []*http.Cookie{c})
	}
	return client
}

func TestRepeatCheckoutSameEmailOneCustomer(t *testing.T) {
	app, server := checkoutTestApp(t)
	base := url.Values{
		"first_name": {"Ali"}, "last_name": {"Karimi"}, "email": {"buyer@example.com"}, "phone": {"09120000001"},
	}
	order1 := submitCheckout(t, server, cloneValues(base))
	order2 := submitCheckout(t, server, cloneValues(base))
	if app.store.CountCustomers() != 1 {
		t.Fatalf("customer count = %d, want 1", app.store.CountCustomers())
	}
	o1, ok := app.store.GetOrder(order1)
	if !ok || o1.CustomerID == "" || o1.Status != "paid" {
		t.Fatalf("order1 missing paid customer link: %#v", o1)
	}
	o2, ok := app.store.GetOrder(order2)
	if !ok || o2.CustomerID != o1.CustomerID || o2.Status != "paid" {
		t.Fatalf("order2 not linked to same customer: %#v vs %#v", o2, o1)
	}
}

func TestCheckoutEmailCaseInsensitive(t *testing.T) {
	app, server := checkoutTestApp(t)
	submitCheckout(t, server, url.Values{
		"first_name": {"Sara"}, "last_name": {"Ahmadi"}, "email": {"MixedCase@Example.COM"}, "phone": {"09120000002"},
	})
	submitCheckout(t, server, url.Values{
		"first_name": {"Sara"}, "last_name": {"Ahmadi"}, "email": {"mixedcase@example.com"}, "phone": {"09120000002"},
	})
	if app.store.CountCustomers() != 1 {
		t.Fatalf("customer count = %d, want 1", app.store.CountCustomers())
	}
	customer, ok := app.store.FindCustomerByEmail("MIXEDCASE@example.com")
	if !ok || customer.Email != "mixedcase@example.com" {
		t.Fatalf("normalized email = %q, found=%v", customer.Email, ok)
	}
}

func TestUnrelatedCheckoutEmailsStaySeparate(t *testing.T) {
	app, server := checkoutTestApp(t)
	submitCheckout(t, server, url.Values{
		"first_name": {"One"}, "last_name": {"Buyer"}, "email": {"one@example.com"}, "phone": {"09120000003"},
	})
	submitCheckout(t, server, url.Values{
		"first_name": {"Two"}, "last_name": {"Buyer"}, "email": {"two@example.com"}, "phone": {"09120000004"},
	})
	if app.store.CountCustomers() != 2 {
		t.Fatalf("customer count = %d, want 2", app.store.CountCustomers())
	}
}

func TestCheckoutOrdersVisibleInAccount(t *testing.T) {
	app, server := checkoutTestApp(t)
	email := "account-visible@example.com"
	submitCheckout(t, server, url.Values{
		"first_name": {"Neda"}, "last_name": {"Rahmani"}, "email": {email}, "phone": {"09120000005"},
	})
	submitCheckout(t, server, url.Values{
		"first_name": {"Neda"}, "last_name": {"Rahmani"}, "email": {email}, "phone": {"09120000005"},
	})
	client := signInViaMagicLink(t, app, server, email)
	resp, err := client.Get(server.URL + "/account/purchases")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("purchases status=%d body=%s", resp.StatusCode, body)
	}
	text := string(body)
	if strings.Count(text, "ord_") < 2 {
		t.Fatalf("expected two orders on purchases page: %s", text)
	}
}

func TestCheckoutPreservesPhoneVerifiedAt(t *testing.T) {
	app, server := checkoutTestApp(t)
	now := time.Now().UTC()
	verifiedAt := now.Add(-24 * time.Hour)
	if err := app.store.PutCustomer(&Customer{
		ID: "cus_verified", FirstName: "Verified", LastName: "User", Email: "verified@example.com",
		Phone: "09121111111", PhoneVerifiedAt: &verifiedAt, CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatal(err)
	}
	submitCheckout(t, server, url.Values{
		"first_name": {"Verified"}, "last_name": {"User"}, "email": {"verified@example.com"}, "phone": {"09129999999"},
	})
	customer, ok := app.store.GetCustomer("cus_verified")
	if !ok || customer.PhoneVerifiedAt == nil {
		t.Fatal("phone_verified_at was cleared")
	}
	if customer.Phone != "09121111111" {
		t.Fatalf("verified phone overwritten: %q", customer.Phone)
	}
}

func TestCheckoutDoesNotOverwriteVerifiedIdentity(t *testing.T) {
	store := NewStore()
	defer store.Close()
	now := time.Now().UTC()
	verifiedAt := now.Add(-48 * time.Hour)
	if err := store.PutCustomer(&Customer{
		ID: "cus_identity", FirstName: "Original", LastName: "Family", Email: "identity@example.com",
		Phone: "09123334444", PhoneVerifiedAt: &verifiedAt, CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatal(err)
	}
	updated, conflicts, err := store.EnsureCheckoutCustomer("Other", "CheckoutName", "identity@example.com", "09125556666")
	if err != nil {
		t.Fatal(err)
	}
	if updated.LastName != "Family" || updated.Phone != "09123334444" {
		t.Fatalf("verified identity overwritten: %#v", updated)
	}
	if len(conflicts) != 2 {
		t.Fatalf("conflicts = %#v, want phone and last_name", conflicts)
	}
}

func TestMergeCheckoutIntoCustomerUnverifiedUpdatesContact(t *testing.T) {
	store := NewStore()
	defer store.Close()
	now := time.Now().UTC()
	if err := store.PutCustomer(&Customer{
		ID: "cus_open", FirstName: "Old", LastName: "Name", Email: "open@example.com", Phone: "09120000000",
		CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatal(err)
	}
	updated, conflicts, err := store.EnsureCheckoutCustomer("New", "Surname", "open@example.com", "09128888888")
	if err != nil {
		t.Fatal(err)
	}
	if len(conflicts) != 0 {
		t.Fatalf("unexpected conflicts: %#v", conflicts)
	}
	if updated.FirstName != "New" || updated.LastName != "Surname" || updated.Phone != "09128888888" {
		t.Fatalf("unverified contact not updated: %#v", updated)
	}
}

func cloneValues(values url.Values) url.Values {
	copy := url.Values{}
	for key, items := range values {
		copy[key] = append([]string(nil), items...)
	}
	return copy
}
