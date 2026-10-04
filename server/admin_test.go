package controlplane

import ("net/http"; "net/http/httptest"; "net/url"; "strings"; "testing"; "time")

func adminLoginClient(t *testing.T, s *httptest.Server) (*http.Client, *http.Cookie) {
	t.Helper(); c := s.Client(); c.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	csrf, cookies := fetchCSRF(t, c, s.URL); req, _ := http.NewRequest(http.MethodPost, s.URL+"/admin/login", strings.NewReader(url.Values{"password": {"admin-secret"}, "csrf_token": {csrf}}.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded"); for _, ck := range cookies { req.AddCookie(ck) }
	resp, err := c.Do(req); if err != nil { t.Fatal(err) }; defer resp.Body.Close(); if resp.StatusCode != http.StatusSeeOther { t.Fatal(resp.StatusCode) }; return c, resp.Cookies()[0]
}

func seedPaidAdminOrder(t *testing.T, st *Store, oid, email, phone, ref string) {
	t.Helper(); now := time.Now().UTC(); cid := "cus_" + oid
	if err := st.PutCustomer(&Customer{ID: cid, Email: email, Phone: phone, PasswordHash: "hash", CreatedAt: now, UpdatedAt: now}); err != nil { t.Fatal(err) }
	if err := st.PutOrder(&Order{ID: oid, CustomerID: cid, Plan: "perpetual", Email: email, Phone: phone, AmountRials: 1000, PaymentRef: ref, Status: "paid", CreatedAt: now, PaidAt: &now}); err != nil { t.Fatal(err) }
	if err := st.PutPaymentAttempt(&PaymentAttempt{ID: randomID("pay_"), OrderID: oid, Provider: "demo", Authority: "AUTHORITY-SECRET-TOKEN-VALUE", Reference: ref, AmountRials: 1000, Status: "verified", CreatedAt: now, VerifiedAt: &now}); err != nil { t.Fatal(err) }
}

func TestAdminSearchByContactAndPaymentRef(t *testing.T) {
	st := NewStore(); seedPaidAdminOrder(t, st, "ord1", "s@ex.com", "0912", "REF1")
	h, err := st.SearchAdminOrders("s@ex.com"); if err != nil || len(h) != 1 { t.Fatalf("%+v %v", h, err) }
}

func TestAdminOrderViewOmitsSecrets(t *testing.T) {
	st := NewStore(); now := time.Now().UTC(); oid := "ord_sec"; cid := "cus_" + oid
	_ = st.PutCustomer(&Customer{ID: cid, Email: "s@ex.com", CreatedAt: now, UpdatedAt: now}); lid := randomID("lic_"); kh := LicenseKeyHash("RM-AAAA-BBBB-CCCC")
	lic := &License{ID: lid, KeyHash: kh, Plan: "perpetual", Status: "active", Features: map[string]bool{}, MaxDevices: 2, CustomerID: cid, OrderID: oid, DeliveryCiphertext: "cipher", CreatedAt: now}
	if _, err := st.InsertPaidOrderWithLicense(cid, lic, oid); err != nil { t.Fatal(err) }
	_ = st.PutPaymentAttempt(&PaymentAttempt{ID: randomID("pay_"), OrderID: oid, Provider: "demo", Authority: "AUTHORITY-SECRET-TOKEN-VALUE", Reference: "R", AmountRials: 1, Status: "verified", CreatedAt: now, VerifiedAt: &now})
	dk := "device-public-key-material-should-not-leak"; _ = st.PutActivation(&Activation{ID: randomID("act_"), LicenseID: lid, DevicePublicKey: dk, Platform: "w", AppVersion: "1", CreatedAt: now, LastSeen: now})
	o, _ := st.GetOrder(oid); v, err := buildAdminOrderView(st, o); if err != nil { t.Fatal(err) }
	b := v.Payments[0].AuthorityHint + v.Activations[0].DeviceKeyHint
	for _, s := range []string{"AUTHORITY-SECRET-TOKEN-VALUE", kh, "cipher", dk} { if strings.Contains(b, s) { t.Fatalf("leaked %q", s) } }
}

func TestAdminMutationsAreAudited(t *testing.T) {
	app, srv, ob := testAppWithOutbox(t, true); oid := "ord_aud"; seedPaidAdminOrder(t, app.store, oid, "a@ex.com", "0912", "REF")
	c, ac := adminLoginClient(t, srv); csrf, cookies := fetchCSRF(t, c, srv.URL)
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/admin/orders/"+oid+"/support-note", strings.NewReader(url.Values{"note": {"ok"}, "csrf_token": {csrf}}.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded"); req.AddCookie(ac); for _, ck := range cookies { req.AddCookie(ck) }
	r, _ := c.Do(req); r.Body.Close(); a, _ := app.store.ListAdminAuditForTarget("order", oid, 5); if len(a) != 1 { t.Fatalf("%+v", a) }
	req2, _ := http.NewRequest(http.MethodPost, srv.URL+"/admin/orders/"+oid+"/resend-delivery", strings.NewReader(url.Values{"csrf_token": {csrf}}.Encode()))
	req2.Header.Set("Content-Type", "application/x-www-form-urlencoded"); req2.AddCookie(ac); for _, ck := range cookies { req2.AddCookie(ck) }
	r2, _ := c.Do(req2); r2.Body.Close(); if len(ob.Messages) == 0 { t.Fatal("no resend") }
}
