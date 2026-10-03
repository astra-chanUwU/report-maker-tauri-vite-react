package controlplane

import (
	"net/http"
	"strings"
)

type SiteCopy struct {
	NavHome, NavPricing, NavDownload, NavSignIn string
	FooterPrivacy, FooterRefund, FooterSupport  string
	FooterOffline, FooterInstall, FooterFAQ      string
	JourneyProduct, JourneyPricing, JourneyPay   string
	JourneySignIn, JourneyDownloads              string
}

func siteCopyFor(lang string) SiteCopy {
	if lang == "fa" {
		return SiteCopy{
			NavHome: "گزارش‌ساز", NavPricing: "قیمت", NavDownload: "دانلود", NavSignIn: "ورود",
			FooterPrivacy: "حریم خصوصی", FooterRefund: "استرداد", FooterSupport: "پشتیبانی",
			FooterOffline: "کار آفلاین", FooterInstall: "نصب", FooterFAQ: "سوالات",
			JourneyProduct: "محصول", JourneyPricing: "قیمت", JourneyPay: "پرداخت",
			JourneySignIn: "ورود", JourneyDownloads: "دانلود",
		}
	}
	return SiteCopy{
		NavHome: "Report Maker", NavPricing: "Pricing", NavDownload: "Download", NavSignIn: "Sign in",
		FooterPrivacy: "Privacy", FooterRefund: "Refunds", FooterSupport: "Support",
		FooterOffline: "Offline use", FooterInstall: "Install", FooterFAQ: "FAQ",
		JourneyProduct: "Product", JourneyPricing: "Pricing", JourneyPay: "Payment",
		JourneySignIn: "Sign in", JourneyDownloads: "Downloads",
	}
}

func (a *App) marketingRoutes() {
	a.mux.HandleFunc("GET /privacy", a.privacyPage)
	a.mux.HandleFunc("GET /refund", a.refundPage)
	a.mux.HandleFunc("GET /support", a.supportPage)
	a.mux.HandleFunc("GET /offline-use", a.offlineUsePage)
	a.mux.HandleFunc("GET /install", a.installPage)
	a.mux.HandleFunc("GET /faq", a.faqPage)
}

func (a *App) mergePageData(r *http.Request, data PageData) PageData {
	if data.Lang == "" {
		data.Lang = a.cfg.SiteLang
	}
	if data.Lang == "" {
		data.Lang = "en"
	}
	if data.Dir == "" {
		data.Dir = a.cfg.SiteDir
	}
	if data.Dir == "" {
		if data.Lang == "fa" {
			data.Dir = "rtl"
		} else {
			data.Dir = "ltr"
		}
	}
	data.Copy = siteCopyFor(data.Lang)
	return data
}

func (a *App) renderSite(w http.ResponseWriter, r *http.Request, name string, data PageData) {
	data = a.mergePageData(r, data)
	renderPage(w, name, data)
}

func orderStatusBadge(status string) (kind, label string) {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "paid":
		return "success", "Payment successful"
	case "pending":
		return "pending", "Payment pending"
	case "cancelled", "canceled":
		return "cancelled", "Payment cancelled"
	case "failed":
		return "failed", "Payment failed"
	default:
		return "failed", status
	}
}

func paymentStatusView(kind, orderID string) PageData {
	data := PageData{StatusKind: kind, OrderID: orderID}
	switch kind {
	case "success":
		data.StatusLabel = "Payment successful"
	case "pending":
		data.StatusLabel = "Payment pending"
	case "cancelled":
		data.StatusLabel = "Payment cancelled"
	case "failed":
		data.StatusLabel = "Payment failed"
	default:
		data.StatusLabel = kind
	}
	if orderID != "" {
		data.Status = orderID
	}
	return data
}

func (a *App) privacyPage(w http.ResponseWriter, r *http.Request) {
	a.renderSite(w, r, "static", PageData{Title: "Privacy", Heading: "Privacy policy", Body: "Report data stays on your device. We store account and order metadata only."})
}

func (a *App) refundPage(w http.ResponseWriter, r *http.Request) {
	a.renderSite(w, r, "static", PageData{Title: "Refunds", Heading: "Refund policy", Body: "Contact support within 14 days with your order ID from Purchases."})
}

func (a *App) supportPage(w http.ResponseWriter, r *http.Request) {
	a.renderSite(w, r, "static", PageData{Title: "Support", Heading: "Support", Body: "Include your order ID from Purchases when contacting support."})
}

func (a *App) offlineUsePage(w http.ResponseWriter, r *http.Request) {
	a.renderSite(w, r, "static", PageData{Title: "Offline use", Heading: "Offline reports", Body: "Build CSV/DOCX engineering reports locally without uploading project data.", ShowJourney: true, JourneyStep: 1, PrimaryCTA: "View pricing", PrimaryCTAURL: "/pricing"})
}

func (a *App) installPage(w http.ResponseWriter, r *http.Request) {
	a.renderSite(w, r, "static", PageData{Title: "Install", Heading: "Install and checksum", Body: "Verify SHA-256 checksums before running installers. See Downloads for platform-specific steps.", PrimaryCTA: "Downloads", PrimaryCTAURL: "/account/downloads"})
}

func (a *App) faqPage(w http.ResponseWriter, r *http.Request) {
	a.renderSite(w, r, "static", PageData{Title: "FAQ", Heading: "Frequently asked questions", Sections: []PageSection{
		{Title: "Purchase", Items: []string{"Sign in after payment to reveal your license key.", "Payment states (pending, cancelled, failed, success) are shown clearly on callback pages."}},
		{Title: "Downloads", Items: []string{"Complete a purchase to unlock signed download links.", "Verify SHA-256 after download; see Install for guidance."}},
	}})
}
