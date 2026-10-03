package controlplane

import (
	"html/template"
	"net/http"
)

var pageTemplates = template.Must(template.New("pages").Parse(`{{ define "layout" }}<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>{{ .Title }} · Report Maker</title><script src="https://unpkg.com/htmx.org@2.0.4"></script><style>body{font:16px system-ui,sans-serif;max-width:860px;margin:0 auto;padding:2rem;color:#17202a}nav{display:flex;gap:1rem;margin-bottom:3rem}a{color:#165dff}main{max-width:650px}button{padding:.7rem 1rem;border:0;border-radius:6px;background:#165dff;color:#fff;cursor:pointer}input,select{padding:.65rem;width:100%;box-sizing:border-box;margin:.35rem 0 1rem}article{padding:1rem;border:1px solid #dbe3ed;border-radius:8px;margin:.8rem 0}</style></head><body><nav><a href="/">Report Maker</a><a href="/pricing">Pricing</a><a href="/download">Download</a></nav>{{ template "content" . }}</body></html>{{ end }}
{{ define "home" }}{{ template "layout" . }}{{ end }}
{{ define "pricing" }}{{ template "layout" . }}{{ end }}
{{ define "checkout" }}{{ template "layout" . }}{{ end }}
{{ define "checkout-status" }}{{ template "layout" . }}{{ end }}
{{ define "login" }}{{ template "layout" . }}{{ end }}
{{ define "account" }}{{ template "layout" . }}{{ end }}
{{ define "content" }}<main><h1>{{ .Heading }}</h1><p>{{ .Body }}</p>{{ if .Plans }}<section>{{ range .Plans }}<article><h2>{{ .Name }}</h2><p>{{ .Description }}</p><strong>{{ .Price }}</strong><form method="post" action="/checkout/start"><input type="hidden" name="plan" value="{{ .ID }}"><label>First name<input name="first_name" autocomplete="given-name" required></label><label>Surname<input name="last_name" autocomplete="family-name" required></label><label>Email for delivery<input type="email" name="email" autocomplete="email" required></label><label>Phone for support<input name="phone" autocomplete="tel" inputmode="tel" required></label><button type="submit">Continue to payment</button></form></article>{{ end }}</section>{{ end }}{{ if .Status }}<p><strong>{{ .Status }}</strong></p>{{ end }}</main>{{ end }}`))

type PlanView struct{ ID, Name, Description, Price string }
type PageData struct {
	Title, Heading, Body, Status string
	Plans                        []PlanView
}

func renderPage(w http.ResponseWriter, name string, data PageData) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := pageTemplates.ExecuteTemplate(w, name, data); err != nil {
		http.Error(w, "template error", http.StatusInternalServerError)
	}
}
