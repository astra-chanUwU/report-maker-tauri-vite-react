package controlplane

import (
	"html/template"
	"net/http"
)

const passkeyJS = `
function csrfToken(){var m=document.cookie.match(/(?:^|;\s*)report_maker_csrf=([^;]+)/);return m?decodeURIComponent(m[1]):'';}
function csrfHeaders(){return{'X-CSRF-Token':csrfToken(),'Content-Type':'application/json'};}
function b64url(buf){var b=new Uint8Array(buf),s='';for(var i=0;i<b.length;i++)s+=String.fromCharCode(b[i]);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function fromB64url(s){s=s.replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';var b=atob(s),a=new Uint8Array(b.length);for(var i=0;i<b.length;i++)a[i]=b.charCodeAt(i);return a.buffer;}
function prepCreate(o){if(o.challenge)o.challenge=fromB64url(o.challenge);if(o.user&&o.user.id)o.user.id=fromB64url(o.user.id);if(o.excludeCredentials)for(var i=0;i<o.excludeCredentials.length;i++)o.excludeCredentials[i].id=fromB64url(o.excludeCredentials[i].id);return o;}
function prepGet(o){if(o.challenge)o.challenge=fromB64url(o.challenge);if(o.allowCredentials)for(var i=0;i<o.allowCredentials.length;i++)o.allowCredentials[i].id=fromB64url(o.allowCredentials[i].id);return o;}
function credToJSON(c){var r={id:c.id,rawId:b64url(c.rawId),type:c.type};if(c.response.attestationObject){r.response={attestationObject:b64url(c.response.attestationObject),clientDataJSON:b64url(c.response.clientDataJSON)};}else{r.response={authenticatorData:b64url(c.response.authenticatorData),clientDataJSON:b64url(c.response.clientDataJSON),signature:b64url(c.response.signature),userHandle:c.response.userHandle?b64url(c.response.userHandle):null};}return r;}
async function passkeyLogin(){var st=document.getElementById('auth-status');st.textContent='Starting passkeyâ€¦';try{var b=await fetch('/auth/passkey/login/begin',{method:'POST',headers:csrfHeaders()});if(!b.ok)throw new Error('begin failed');var d=await b.json();var pk=prepGet(d.public_key.publicKey||d.public_key);var cred=await navigator.credentials.get({publicKey:pk});var f=await fetch('/auth/passkey/login/finish?challenge_id='+encodeURIComponent(d.challenge_id),{method:'POST',headers:csrfHeaders(),body:JSON.stringify(credToJSON(cred))});if(!f.ok)throw new Error('finish failed');location.href='/account';}catch(e){st.textContent='Passkey sign-in failed: '+e.message;}}
async function passkeyRegister(){var st=document.getElementById('auth-status');st.textContent='Registering passkeyâ€¦';try{var b=await fetch('/auth/passkey/register/begin',{method:'POST',headers:csrfHeaders()});if(!b.ok)throw new Error('begin failed');var d=await b.json();var pk=prepCreate(d.public_key.publicKey||d.public_key);var cred=await navigator.credentials.create({publicKey:pk});var f=await fetch('/auth/passkey/register/finish?challenge_id='+encodeURIComponent(d.challenge_id),{method:'POST',headers:csrfHeaders(),body:JSON.stringify(credToJSON(cred))});if(!f.ok)throw new Error('finish failed');st.textContent='Passkey registered.';}catch(e){st.textContent='Passkey registration failed: '+e.message;}}
async function requestPhoneCode(){var st=document.getElementById('phone-status');st.textContent='Sending codeâ€¦';var fd=new FormData();fd.append('csrf_token',csrfToken());var r=await fetch('/auth/phone/request-code',{method:'POST',headers:{'X-CSRF-Token':csrfToken()},body:fd});st.textContent=r.ok?'Code sent.':'Failed to send code.';}
async function verifyPhone(){var st=document.getElementById('phone-status');var code=document.getElementById('phone-code').value;var r=await fetch('/auth/phone/verify',{method:'POST',headers:csrfHeaders(),body:JSON.stringify({code:code})});if(r.ok){st.textContent='Phone verified.';location.reload();}else{st.textContent='Verification failed.';}}
`

var pageTemplates = template.Must(template.New("pages").Funcs(template.FuncMap{
	"csrfInput": func(token string) template.HTML {
		return template.HTML(`<input type="hidden" name="csrf_token" value="` + template.HTMLEscapeString(token) + `">`)
	},
	"passkeyJS": func() template.JS { return template.JS(passkeyJS) },
}).Parse(`{{ define "layout" }}<!doctype html><html lang="{{ .Lang }}" dir="{{ .Dir }}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>{{ .Title }} Â· Report Maker</title><script src="/static/htmx.min.js"></script><style>
body{font:16px system-ui,sans-serif;max-width:920px;margin:0 auto;padding:2rem;color:#17202a}
html[dir="rtl"] body{text-align:right}
nav.site-nav{display:flex;gap:1rem;margin-bottom:2rem;flex-wrap:wrap;align-items:center}
html[dir="rtl"] nav.site-nav{flex-direction:row-reverse}
nav.site-nav a{color:#165dff;text-decoration:none;font-weight:500}
.journey{display:flex;gap:.5rem;flex-wrap:wrap;margin:0 0 2rem;padding:0;list-style:none;font-size:.9rem;color:#5a6b7d}
html[dir="rtl"] .journey{flex-direction:row-reverse}
.journey li{padding:.35rem .75rem;border-radius:999px;background:#eef2f7}
.journey li.active{background:#165dff;color:#fff;font-weight:600}
.status-badge{display:inline-block;padding:.35rem .85rem;border-radius:999px;font-size:.875rem;font-weight:600;margin-bottom:1rem}
.status-badge.success{background:#e6f7ed;color:#0d6832}
.status-badge.pending{background:#fff8e6;color:#8a6100}
.status-badge.cancelled{background:#eef2f7;color:#4a5568}
.status-badge.failed{background:#fdecea;color:#b42318}
main{max-width:680px}
.cta-row{display:flex;gap:.75rem;flex-wrap:wrap;margin:1.5rem 0}
html[dir="rtl"] .cta-row{flex-direction:row-reverse}
button,.btn{padding:.7rem 1rem;border:0;border-radius:6px;background:#165dff;color:#fff;cursor:pointer;display:inline-block;text-decoration:none;font-size:1rem}
button.secondary,.btn.secondary{background:#eef2f7;color:#17202a}
input,select{padding:.65rem;width:100%;box-sizing:border-box;margin:.35rem 0 1rem}
article{padding:1rem;border:1px solid #dbe3ed;border-radius:8px;margin:.8rem 0}
.auth-section{margin:1.5rem 0;padding:1rem 0;border-top:1px solid #dbe3ed}
#auth-status,#phone-status{margin:.5rem 0;color:#555}
footer.site-footer{margin-top:3rem;padding-top:1.5rem;border-top:1px solid #dbe3ed;font-size:.9rem;color:#5a6b7d}
footer.site-footer nav{display:flex;gap:1rem;flex-wrap:wrap}
html[dir="rtl"] footer.site-footer nav{flex-direction:row-reverse}
.faq-section{margin:1.5rem 0}
.faq-section ul{margin:.5rem 0;padding-inline-start:1.25rem}
</style>{{ if .ExtraScript }}<script>{{ passkeyJS }}</script>{{ end }}</head><body>
{{ if not .HideFooter }}<nav class="site-nav"><a href="/">{{ .Copy.NavHome }}</a><a href="/pricing">{{ .Copy.NavPricing }}</a><a href="/download">{{ .Copy.NavDownload }}</a><a href="/login">{{ .Copy.NavSignIn }}</a></nav>{{ end }}
{{ if .ShowJourney }}<ol class="journey"><li{{ if eq .JourneyStep 1 }} class="active"{{ end }}>{{ .Copy.JourneyProduct }}</li><li{{ if eq .JourneyStep 2 }} class="active"{{ end }}>{{ .Copy.JourneyPricing }}</li><li{{ if eq .JourneyStep 3 }} class="active"{{ end }}>{{ .Copy.JourneyPay }}</li><li{{ if eq .JourneyStep 4 }} class="active"{{ end }}>{{ .Copy.JourneySignIn }}</li><li{{ if eq .JourneyStep 5 }} class="active"{{ end }}>{{ .Copy.JourneyDownloads }}</li></ol>{{ end }}
{{ template "body" . }}
{{ if not .HideFooter }}<footer class="site-footer"><nav><a href="/privacy">{{ .Copy.FooterPrivacy }}</a><a href="/refund">{{ .Copy.FooterRefund }}</a><a href="/support">{{ .Copy.FooterSupport }}</a><a href="/offline-use">{{ .Copy.FooterOffline }}</a><a href="/install">{{ .Copy.FooterInstall }}</a><a href="/faq">{{ .Copy.FooterFAQ }}</a></nav></footer>{{ end }}
</body></html>{{ end }}
{{ define "home" }}{{ template "layout" . }}{{ end }}
{{ define "checkout-status" }}{{ template "layout" . }}{{ end }}
{{ define "pricing" }}{{ template "layout" . }}{{ end }}
{{ define "login" }}{{ template "layout" . }}{{ end }}
{{ define "account" }}{{ template "layout" . }}{{ end }}
{{ define "purchases" }}{{ template "layout" . }}{{ end }}
{{ define "downloads" }}{{ template "layout" . }}{{ end }}
{{ define "download-info" }}{{ template "layout" . }}{{ end }}
{{ define "static" }}{{ template "layout" . }}{{ end }}
{{ define "admin-login" }}{{ template "layout" . }}{{ end }}
{{ define "admin" }}{{ template "layout" . }}{{ end }}
{{ define "admin-order" }}{{ template "layout" . }}{{ end }}
{{ define "body" }}<main>
{{ if .StatusLabel }}<p class="status-badge {{ .StatusKind }}">{{ .StatusLabel }}</p>{{ end }}
<h1>{{ .Heading }}</h1><p>{{ .Body }}</p>
{{ if .PrimaryCTA }}<div class="cta-row"><a class="btn" href="{{ .PrimaryCTAURL }}">{{ .PrimaryCTA }}</a>{{ if .SecondaryCTA }}<a class="btn secondary" href="{{ .SecondaryCTAURL }}">{{ .SecondaryCTA }}</a>{{ end }}</div>{{ end }}
{{ if .Sections }}{{ range .Sections }}<section class="faq-section"><h2>{{ .Title }}</h2><ul>{{ range .Items }}<li>{{ . }}</li>{{ end }}</ul></section>{{ end }}{{ end }}
{{ if .Plans }}<section>{{ range .Plans }}<article><h2>{{ .Name }}</h2><p>{{ .Description }}</p><strong>{{ .Price }}</strong><form method="post" action="/checkout/start">{{ csrfInput $.CSRFToken }}<input type="hidden" name="plan" value="{{ .ID }}"><label>First name<input name="first_name" autocomplete="given-name" required></label><label>Surname<input name="last_name" autocomplete="family-name" required></label><label>Email for delivery<input type="email" name="email" autocomplete="email" required></label><label>Phone for support<input name="phone" autocomplete="tel" inputmode="tel" required></label><button type="submit">Continue to payment</button></form></article>{{ end }}</section>{{ end }}
{{ if .Status }}<p>Order: <strong>{{ .Status }}</strong></p>{{ end }}
{{ if .LicenseKey }}<p>License key: <code>{{ .LicenseKey }}</code></p>{{ else if .LicenseMasked }}<p>License key: <code>{{ .LicenseMasked }}</code></p>{{ end }}
{{ if .Purchases }}<section>{{ range .Purchases }}<article><h2>{{ .Plan }}</h2><p>Order {{ .OrderID }} Â· {{ .Status }}{{ if .PaidAt }} Â· paid {{ .PaidAt }}{{ end }}</p>{{ if .MaskedKey }}<p>License: <code id="key-{{ .OrderID }}">{{ .MaskedKey }}</code></p>{{ if .CanReveal }}<form method="post" action="/account/purchases/reveal" hx-post="/account/purchases/reveal" hx-target="#key-{{ .OrderID }}" hx-swap="outerHTML">{{ csrfInput $.CSRFToken }}<input type="hidden" name="order_id" value="{{ .OrderID }}"><button type="submit" class="secondary">Reveal license key</button></form>{{ end }}{{ end }}</article>{{ end }}</section>{{ end }}
{{ if .ShowPurchasesLink }}<p><a href="/account/purchases">View purchases and licenses</a></p>{{ end }}
{{ if .ShowDownloads }}{{ if .Entitled }}<section>{{ range .DownloadLinks }}<article><h2>{{ .Filename }}</h2><p>{{ .Description }} Â· {{ .Platform }} Â· v{{ .Version }}</p><p>SHA-256: <code>{{ .SHA256 }}</code></p><p>Link expires {{ .ExpiresAt.Format "2006-01-02 15:04 UTC" }}</p><a class="btn" href="{{ .URL }}">Download</a></article>{{ end }}</section>{{ else }}<p>Complete a purchase to unlock downloads.</p>{{ end }}{{ end }}
{{ if .Email }}<p>Phone: {{ .Phone }} ({{ .PhoneVerified }})</p>{{ end }}
{{ if .ShowPasskeyLogin }}<div class="auth-section"><h2>Passkey</h2><button type="button" onclick="passkeyLogin()">Sign in with passkey</button></div>{{ end }}
{{ if .ShowMagicLink }}<div class="auth-section"><h2>Magic link</h2><form method="post" action="/auth/magic-link/request" hx-post="/auth/magic-link/request" hx-swap="none">{{ csrfInput .CSRFToken }}<label>Email<input type="email" name="email" autocomplete="email" required></label><button type="submit">Send sign-in link</button></form></div>{{ end }}
{{ if .ShowPasswordLogin }}<div class="auth-section"><h2>Password</h2><form method="post" action="/auth/password/login">{{ csrfInput .CSRFToken }}<label>Email<input type="email" name="email" autocomplete="email" required></label><label>Password<input type="password" name="password" autocomplete="current-password" required></label><button type="submit">Sign in with password</button></form></div>{{ end }}
{{ if .ShowPasskeyRegister }}<div class="auth-section"><h2>Passkey</h2><button type="button" onclick="passkeyRegister()">Register a passkey</button></div>{{ end }}
{{ if .ShowPhoneVerify }}<div class="auth-section"><h2>Phone verification</h2><button type="button" onclick="requestPhoneCode()">Send verification code</button><label>Code<input id="phone-code" inputmode="numeric" maxlength="6"></label><button type="button" class="secondary" onclick="verifyPhone()">Verify phone</button><p id="phone-status"></p></div>{{ end }}
{{ if .ShowDownloads }}{{ if .Entitled }}{{ if .DownloadLinks }}<section><h2>Offline desktop installer</h2><p>Order {{ .OrderID }} includes download access. Verify SHA-256 after download.</p>{{ range .DownloadLinks }}<article><h3>{{ .Platform }} Â· v{{ .Version }}</h3><p>{{ .Description }}</p><p><strong>File:</strong> {{ .Filename }}</p><p><strong>SHA-256:</strong> <code>{{ .SHA256 }}</code></p><p><strong>Install:</strong> {{ .InstallInstructions }}</p><p><a class="btn" href="{{ .URL }}">Download installer</a> <a class="btn secondary" href="/downloads/{{ .ArtifactID }}">Direct download (signed in)</a></p><form method="post" action="/account/downloads/renew">{{ csrfInput $.CSRFToken }}<input type="hidden" name="artifact_id" value="{{ .ArtifactID }}"><button type="submit" class="secondary">Renew expiring link</button></form></article>{{ end }}</section>{{ end }}{{ else }}<p>Purchase a license to unlock downloads, or sign in with the account used at checkout.</p><p><a href="/pricing">View pricing</a></p>{{ end }}{{ end }}
{{ if .ShowLogout }}<form method="post" action="/auth/logout">{{ csrfInput .CSRFToken }}<button type="submit">Sign out</button></form>{{ end }}
{{ if .ShowAdminLogin }}<form method="post" action="/admin/login">{{ csrfInput .CSRFToken }}<label>Admin password<input type="password" name="password" required></label><button type="submit">Sign in</button></form>{{ end }}
{{ if .ShowAdminLogout }}<form method="post" action="/admin/logout">{{ csrfInput .CSRFToken }}<button type="submit">Sign out</button></form><form method="get" action="/admin"><input name="q" value="{{ .AdminQuery }}"><button type="submit">Search</button></form>{{ end }}
{{ if .AdminFlash }}<p><strong>{{ .AdminFlash }}</strong></p>{{ end }}
{{ if .AdminSearchHits }}{{ range .AdminSearchHits }}<p><a href="/admin/orders/{{ .OrderID }}">{{ .OrderID }}</a> · {{ .Email }} · {{ .Status }}</p>{{ end }}{{ end }}
{{ if .AdminOrder }}<section><h2>Order {{ .AdminOrder.OrderID }}</h2><p>Status: {{ .AdminOrder.Status }} · {{ .AdminOrder.Email }} · {{ .AdminOrder.Phone }}</p><form method="post" action="/admin/orders/{{ .AdminOrder.OrderID }}/resend-delivery">{{ csrfInput .CSRFToken }}<button type="submit">Resend delivery</button></form><form method="post" action="/admin/orders/{{ .AdminOrder.OrderID }}/support-note">{{ csrfInput .CSRFToken }}<label>Support note<textarea name="note" required></textarea></label><button type="submit">Save note</button></form>{{ if .AdminOrder.SupportNotes }}<h3>Notes</h3>{{ range .AdminOrder.SupportNotes }}<article><p>{{ .Body }}</p><p><small>{{ .CreatedAt }}</small></p></article>{{ end }}{{ end }}{{ if .AdminOrder.Activations }}<h3>Activations</h3>{{ range .AdminOrder.Activations }}<article><p>{{ .ID }} · {{ .Status }} · {{ .Platform }}</p>{{ if eq .Status "active" }}<form method="post" action="/admin/activations/{{ .ID }}/revoke">{{ csrfInput $.CSRFToken }}<button type="submit" class="secondary">Revoke</button></form>{{ end }}</article>{{ end }}{{ end }}{{ if .AdminOrder.AuditLog }}<h3>Audit</h3>{{ range .AdminOrder.AuditLog }}<p>{{ .Action }} · {{ .TargetType }} · {{ .Detail }} · {{ .CreatedAt }}</p>{{ end }}{{ end }}</section>{{ end }}
<p id="auth-status"></p></main>{{ end }}`))

type PlanView struct{ ID, Name, Description, Price string }
type PurchaseView struct {
	OrderID, Plan, Status, PaidAt, MaskedKey string
	CanReveal                                bool
}
type PageSection struct {
	Title string
	Items []string
}
type PageData struct {
	Title, Heading, Body, Status string
	CSRFToken                    string
	Email, Phone, PhoneVerified  string
	LicenseKey, LicenseMasked    string
	ExtraScript                  bool
	ShowPasskeyLogin             bool
	ShowMagicLink                bool
	ShowPasswordLogin            bool
	ShowPasskeyRegister          bool
	ShowPhoneVerify              bool
	ShowLogout                   bool
	ShowPurchasesLink            bool
	ShowAdminLogin               bool
	ShowAdminLogout              bool
	Plans                        []PlanView
	Purchases                    []PurchaseView
	DownloadLinks                []DownloadLinkView
	Entitled                     bool
	OrderID                      string
	ShowDownloads                bool
	Lang, Dir                    string
	Copy                         SiteCopy
	HideFooter                   bool
	ShowJourney                  bool
	JourneyStep                  int
	PrimaryCTA, PrimaryCTAURL    string
	SecondaryCTA, SecondaryCTAURL string
	StatusKind, StatusLabel      string
	Sections                     []PageSection
	AdminQuery, AdminFlash       string
	AdminSearchHits              []AdminOrderSearchHit
	AdminOrder                   *AdminOrderView
}

func renderPage(w http.ResponseWriter, name string, data PageData) {
	if data.Lang == "" {
		data.Lang = "en"
	}
	if data.Dir == "" {
		data.Dir = "ltr"
	}
	if data.Copy.NavHome == "" {
		data.Copy = siteCopyFor(data.Lang)
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := pageTemplates.ExecuteTemplate(w, name, data); err != nil {
		http.Error(w, "template error", http.StatusInternalServerError)
	}
}
