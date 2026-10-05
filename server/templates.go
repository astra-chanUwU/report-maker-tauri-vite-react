package controlplane

//go:generate templ generate

import (
	"context"
	"net/http"

	"github.com/a-h/templ"
)

const passkeyJS = `
function csrfToken(){var m=document.cookie.match(/(?:^|;\s*)report_maker_csrf=([^;]+)/);return m?decodeURIComponent(m[1]):'';}
function csrfHeaders(){return{'X-CSRF-Token':csrfToken(),'Content-Type':'application/json'};}
function b64url(buf){var b=new Uint8Array(buf),s='';for(var i=0;i<b.length;i++)s+=String.fromCharCode(b[i]);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function fromB64url(s){s=s.replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';var b=atob(s),a=new Uint8Array(b.length);for(var i=0;i<b.length;i++)a[i]=b.charCodeAt(i);return a.buffer;}
function prepCreate(o){if(o.challenge)o.challenge=fromB64url(o.challenge);if(o.user&&o.user.id)o.user.id=fromB64url(o.user.id);if(o.excludeCredentials)for(var i=0;i<o.excludeCredentials.length;i++)o.excludeCredentials[i].id=fromB64url(o.excludeCredentials[i].id);return o;}
function prepGet(o){if(o.challenge)o.challenge=fromB64url(o.challenge);if(o.allowCredentials)for(var i=0;i<o.allowCredentials.length;i++)o.allowCredentials[i].id=fromB64url(o.allowCredentials[i].id);return o;}
function credToJSON(c){var r={id:c.id,rawId:b64url(c.rawId),type:c.type};if(c.response.attestationObject){r.response={attestationObject:b64url(c.response.attestationObject),clientDataJSON:b64url(c.response.clientDataJSON)};}else{r.response={authenticatorData:b64url(c.response.authenticatorData),clientDataJSON:b64url(c.response.clientDataJSON),signature:b64url(c.response.signature),userHandle:c.response.userHandle?b64url(c.response.userHandle):null};}return r;}
async function passkeyLogin(){var st=document.getElementById('auth-status');st.textContent='Starting passkey…';try{var b=await fetch('/auth/passkey/login/begin',{method:'POST',headers:csrfHeaders()});if(!b.ok)throw new Error('begin failed');var d=await b.json();var pk=prepGet(d.public_key.publicKey||d.public_key);var cred=await navigator.credentials.get({publicKey:pk});var f=await fetch('/auth/passkey/login/finish?challenge_id='+encodeURIComponent(d.challenge_id),{method:'POST',headers:csrfHeaders(),body:JSON.stringify(credToJSON(cred))});if(!f.ok)throw new Error('finish failed');location.href='/account';}catch(e){st.textContent='Passkey sign-in failed: '+e.message;}}
async function passkeyRegister(){var st=document.getElementById('auth-status');st.textContent='Registering passkey…';try{var b=await fetch('/auth/passkey/register/begin',{method:'POST',headers:csrfHeaders()});if(!b.ok)throw new Error('begin failed');var d=await b.json();var pk=prepCreate(d.public_key.publicKey||d.public_key);var cred=await navigator.credentials.create({publicKey:pk});var f=await fetch('/auth/passkey/register/finish?challenge_id='+encodeURIComponent(d.challenge_id),{method:'POST',headers:csrfHeaders(),body:JSON.stringify(credToJSON(cred))});if(!f.ok)throw new Error('finish failed');st.textContent='Passkey registered.';}catch(e){st.textContent='Passkey registration failed: '+e.message;}}
async function requestPhoneCode(){var st=document.getElementById('phone-status');st.textContent='Sending code…';var fd=new FormData();fd.append('csrf_token',csrfToken());var r=await fetch('/auth/phone/request-code',{method:'POST',headers:{'X-CSRF-Token':csrfToken()},body:fd});st.textContent=r.ok?'Code sent.':'Failed to send code.';}
async function verifyPhone(){var st=document.getElementById('phone-status');var code=document.getElementById('phone-code').value;var r=await fetch('/auth/phone/verify',{method:'POST',headers:csrfHeaders(),body:JSON.stringify({code:code})});if(r.ok){st.textContent='Phone verified.';location.reload();}else{st.textContent='Verification failed.';}}
`

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
		data.Lang = "fa"
	}
	if data.Dir == "" {
		if data.Lang == "fa" {
			data.Dir = "rtl"
		} else {
			data.Dir = "ltr"
		}
	}
	if data.Copy.NavHome == "" {
		data.Copy = siteCopyFor(data.Lang)
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	var comp templ.Component
	switch name {
	case "home":
		comp = HomePage(data)
	case "pricing":
		comp = PricingPage(data)
	case "static":
		comp = StaticPage(data)
	default:
		comp = GenericPage(data)
	}
	if err := comp.Render(context.Background(), w); err != nil {
		http.Error(w, "template error", http.StatusInternalServerError)
	}
}
