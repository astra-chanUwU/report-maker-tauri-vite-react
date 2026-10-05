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
	if q := r.URL.Query().Get("lang"); q == "fa" || q == "en" {
		data.Lang = q
	} else if c, err := r.Cookie("rm_lang"); err == nil && (c.Value == "fa" || c.Value == "en") {
		if data.Lang == "" {
			data.Lang = c.Value
		}
	}
	if data.Lang == "" {
		data.Lang = a.cfg.SiteLang
	}
	if data.Lang == "" {
		data.Lang = "fa"
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
	if q := r.URL.Query().Get("lang"); q == "fa" || q == "en" {
		http.SetCookie(w, &http.Cookie{Name: "rm_lang", Value: q, Path: "/", MaxAge: 60 * 60 * 24 * 365, SameSite: http.SameSiteLaxMode})
	}
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
	lang := a.mergePageData(r, PageData{}).Lang
	if lang == "fa" {
		a.renderSite(w, r, "static", PageData{Lang: "fa", Title: "حریم خصوصی", Heading: "حریم خصوصی — چه چیزی را نگه می‌داریم، چه چیزی را هرگز نمی‌بینیم", Body: "گزارش‌ساز آفلاین-اول است. فایل‌های SP3، CSV و DOCX شما روی دستگاهتان می‌ماند. سرویس Go فقط فراداده حساب و سفارش لازم برای تحویل لایسنس را نگه می‌دارد.",
			Sections: []PageSection{
				{Title: "هرگز دریافت نمی‌کنیم", Items: []string{"محتوای گزارش لرزش، عکس‌های سایت یا داده وارد شده SP3/CSV", "فایل‌های DOCX تولید شده — به صورت محلی در اپ دسکتاپ Tauri رندر می‌شود", "مسیرهای فایل یا پوشه پروژه — بخشی از هیچ فراخوانی API نیست"}},
				{Title: "چه چیزی را نگه می‌داریم", Items: []string{"حساب: ایمیل، نام، تلفن، اعتبارنامه پس‌کی، وضعیت تأیید تلفن", "سفارش: پلن، authority/reference ماسک شده، هش جستجوی لایسنس و متن رمز شده تحویل", "فعال‌سازی: کلید عمومی دستگاه، پلتفرم، زمان‌های اجاره (بدون کلید خصوصی خام)", "صندوق خروجی تحویل: تلاش ارسال ایمیل/پیامک — در لاگ‌ها ویرایش شده"}},
				{Title: "پردازش و نگهداری", Items: []string{"پرداخت‌ها سرور-به-سرور از طریق زرین‌پال تأیید می‌شود؛ ما مرجع را نگه می‌داریم نه داده کارت", "متن لایسنس با کلید تحویل جداگانه AES رمز می‌شود؛ متن آشکار فقط برای نشست مالک نمایش داده می‌شود", "تله‌متری (در صورت فعال‌سازی) دسته‌ای و ناشناس است و هرگز محتوای گزارش را شامل نمی‌شود"}},
			}, PrimaryCTA: "سوالی دارید؟", PrimaryCTAURL: "/support", SecondaryCTA: "کار آفلاین", SecondaryCTAURL: "/offline-use"})
		return
	}
	a.renderSite(w, r, "static", PageData{
		Title: "Privacy", Heading: "Privacy — what we store, what we never see",
		Body: "Report Maker is offline-first. Your SP3, CSV, and DOCX files stay on your machine. The Go service only stores account and order metadata needed to deliver your licence and keep downloads working.",
		Sections: []PageSection{
			{Title: "We never receive", Items: []string{"Vibration report content, site photos, or imported SP3/CSV data", "Generated DOCX files — rendered locally in the Tauri desktop app", "Filesystem paths or project folders — not part of any API call"}},
			{Title: "We do store", Items: []string{"Account: email, name, phone, passkey credentials, phone-verification state", "Order: plan, masked authority/reference, licence lookup hash and encrypted delivery ciphertext", "Activation: device public key, platform, lease timestamps (no raw private keys)", "Delivery outbox: email/SMS send attempts — redacted in logs and admin views"}},
			{Title: "Processing & retention", Items: []string{"Payments are verified server-to-server via ZarinPal; we store the reference, not card data", "Licence ciphertext is AES-encrypted with a separate delivery key; plaintext is revealed only to the owning session", "Telemetry (if you enable it) is batched, anonymised, and never includes report content"}},
		},
		PrimaryCTA: "Questions?", PrimaryCTAURL: "/support", SecondaryCTA: "Offline use", SecondaryCTAURL: "/offline-use",
	})
}

func (a *App) refundPage(w http.ResponseWriter, r *http.Request) {
	lang := a.mergePageData(r, PageData{}).Lang
	if lang == "fa" {
		a.renderSite(w, r, "static", PageData{Lang: "fa", Title: "استرداد", Heading: "استرداد — ۱۴ روز، با شناسه سفارش", Body: "اگر لایسنس برایتان مفید نبود، تا ۱۴ روز پس از خرید با شناسه سفارش از صفحه خریدهایتان با پشتیبانی تماس بگیرید.",
			Sections: []PageSection{
				{Title: "چگونه درخواست دهید", Items: []string{"وارد شوید و خریدها را باز کنید — شناسه سفارش (ord_…) را کپی کنید", "با شناسه سفارش و ایمیل خرید با پشتیبانی تماس بگیرید", "وضعیت پرداختی که دیدید (موفق / در انتظار / لغو شده) و رسید درگاه را ضمیمه کنید"}},
				{Title: "چه چیزی را بررسی می‌کنیم", Items: []string{"تأیید سرور-به-سرور زرین‌پال (authority + مبلغ) — درگاه مرجع حقیقت پرداخت است", "آیا لایسنس روی چند دستگاه فعال شده — لایسنس‌های استفاده نشده سریع‌تر استرداد می‌شود", "زمان‌بندی بانکی داخلی — استرداد از طریق درگاه ممکن است چند روز کاری طول بکشد"}},
				{Title: "غیر قابل استرداد پس از", Items: []string{"۱۴ روز از زمان تأیید پرداخت", "مواردی که سفارش با authority درگاه قابل تطبیق نیست"}},
			}, PrimaryCTA: "تماس با پشتیبانی", PrimaryCTAURL: "/support", SecondaryCTA: "سوالات متداول", SecondaryCTAURL: "/faq"})
		return
	}
	a.renderSite(w, r, "static", PageData{
		Title: "Refunds", Heading: "Refunds — 14 days, with your order ID",
		Body: "If the licence has not been useful, contact support within 14 days of the purchase with the order ID from your Purchases page. We handle refunds manually so we can verify payment state directly.",
		Sections: []PageSection{
			{Title: "How to request", Items: []string{"Sign in and open Purchases — copy the order ID (ord_…)", "Contact support with the order ID and the email used at checkout", "Include the payment status you saw (success / pending / cancelled) and any gateway receipt"}},
			{Title: "What we check", Items: []string{"Server-to-server ZarinPal verification (authority + amount) — the gateway owns payment truth", "Whether the licence has been activated on multiple devices — unused licences are fastest", "Domestic bank timelines — refunds via the gateway can take a few business days"}},
			{Title: "Not refundable after", Items: []string{"14 days from the payment verification timestamp", "Cases where the order cannot be matched to a gateway authority"}},
		},
		PrimaryCTA: "Contact support", PrimaryCTAURL: "/support", SecondaryCTA: "View FAQ", SecondaryCTAURL: "/faq",
	})
}

func (a *App) supportPage(w http.ResponseWriter, r *http.Request) {
	lang := a.mergePageData(r, PageData{}).Lang
	if lang == "fa" {
		a.renderSite(w, r, "static", PageData{Lang: "fa", Title: "پشتیبانی", Heading: "پشتیبانی — شناسه سفارش را ضمیمه کنید", Body: "ما خرید، تحویل لایسنس و دانلود را پشتیبانی می‌کنیم. شناسه سفارش از صفحه خریدها را ضمیمه کنید تا بدون پرسش مجدد سفارش را پیدا کنیم.",
			Sections: []PageSection{
				{Title: "هنگام نوشتن ضمیمه کنید", Items: []string{"شناسه سفارش (ord_…) از خریدها — یا ایمیل خرید اگر نمی‌توانید وارد شوید", "مرجع پرداخت یا اسکرین‌شات اگر بازگشت درگاه در انتظار / ناموفق نشان داد", "پلتفرم دسکتاپ و نسخه اپ اگر مشکل فعال‌سازی یا دانلود است"}},
				{Title: "چه کاری می‌توانیم انجام دهیم", Items: []string{"ارسال مجدد ایمیل تحویل لایسنس و تمدید لینک دانلود منقضی", "بررسی وضعیت تأیید پرداخت و توضیح نتایج در انتظار/لغو شده", "لغو فعال‌سازی دستگاه گمشده تا بتوانید صندلی را دوباره استفاده کنید (تأیید ادمین)"}},
				{Title: "زمان پاسخگویی", Items: []string{"پاسخ در روزهای کاری — سفارش‌ها به صورت idempotent ذخیره می‌شود بنابراین تلاش مجدد نسخه تکراری نمی‌سازد", "اقدامات ادمین (ارسال مجدد، لغو، یادداشت) برای هر سفارش حسابرسی می‌شود"}},
			}, PrimaryCTA: "رفتن به خریدها", PrimaryCTAURL: "/account/purchases", SecondaryCTA: "راهنمای نصب", SecondaryCTAURL: "/install"})
		return
	}
	a.renderSite(w, r, "static", PageData{
		Title: "Support", Heading: "Support — include your order ID",
		Body: "We support purchases, licence delivery, and downloads. Include the order ID from Purchases so we can locate the order without asking for it again.",
		Sections: []PageSection{
			{Title: "When you write, include", Items: []string{"Order ID (ord_…) from Purchases — or the email used at checkout if you cannot sign in", "Payment reference or screenshot if the callback showed pending / failed", "Desktop platform and app version if the issue is activation or download"}},
			{Title: "What we can do", Items: []string{"Re-send licence delivery email and renew an expired download link", "Check payment verification state and clarify pending/cancelled outcomes", "Revoke a lost device activation so you can reuse a seat (admin-verified)"}},
			{Title: "Response time", Items: []string{"Replies on business days — orders are stored idempotently so retries do not create duplicates", "Admin actions (resend, revoke, notes) are audited per order for handover between agents"}},
		},
		PrimaryCTA: "Go to Purchases", PrimaryCTAURL: "/account/purchases", SecondaryCTA: "Install help", SecondaryCTAURL: "/install",
	})
}

func (a *App) offlineUsePage(w http.ResponseWriter, r *http.Request) {
	lang := a.mergePageData(r, PageData{}).Lang
	if lang == "fa" {
		a.renderSite(w, r, "static", PageData{Lang: "fa", Title: "کار آفلاین", Heading: "گزارش آفلاین — داده شما هرگز دستگاه را ترک نمی‌کند", Body: "گزارش‌های لرزش را از SP3 یا CSV بدون آپلود بسازید. اپ دسکتاپ پایپ‌لاین گزارش است: واردسازی، بازبینی، خروجی DOCX — همه محلی. یک اجاره آفلاین امضا شده تا ۳۰ روز بدون اینترنت را پوشش می‌دهد.",
			Sections: []PageSection{
				{Title: "چه چیزی محلی می‌ماند", Items: []string{"واردسازی SP3 از طریق mdb-export — پوسته Rust جدول Data را مستقیم استریم می‌کند", "فیکسچرهای CSV و هر ویرایشی که در رابط React انجام می‌دهید", "تولید DOCX و فایل Word نهایی که به کارفرما می‌دهید"}},
				{Title: "چه چیزی به شبکه نیاز دارد", Items: []string{"خرید و تحویل لایسنس (یک بار برای هر لایسنس)", "دریافت یا تمدید اجاره امضا شده Ed25519 — لایسنس را به کلید دستگاه متصل می‌کند", "دانلود نصب‌کننده Tauri — سپس SHA-256 را پیش از اجرا تأیید کنید", "تمدید دوره‌ای اجاره برای دریافت لغوها — نه برای آپلود مجدد گزارش‌ها"}},
				{Title: "آفلاین چگونه اجرا می‌شود", Items: []string{"هر دستگاه یک جفت کلید Ed25519 در keychain سیستم‌عامل تولید می‌کند؛ اجاره به آن کلید عمومی مقید است", "Rust امضا، اتصال دستگاه و پنجره آفلاین را پیش از نمایش استحقاق به React تأیید می‌کند", "انقضا در اپ قابل مشاهده است — پیش از پایان تمدید کنید؛ هیچ fallback آپلود بی‌صدا وجود ندارد"}},
			}, ShowJourney: true, JourneyStep: 1, PrimaryCTA: "مشاهده قیمت", PrimaryCTAURL: "/pricing", SecondaryCTA: "نصب و تأیید", SecondaryCTAURL: "/install"})
		return
	}
	a.renderSite(w, r, "static", PageData{
		Title: "Offline use", Heading: "Offline reports — your data never leaves the device",
		Body: "Build vibration reports from SP3 or CSV without uploading. The desktop app is the report pipeline: import, review, DOCX export — all local. A signed offline lease covers up to 30 days without internet.",
		Sections: []PageSection{
			{Title: "What stays local", Items: []string{"SP3 import via mdb-export — the Rust shell streams the Data table directly", "CSV fixtures and every edit you make in the React interface", "DOCX generation and the final Word file you hand to the client"}},
			{Title: "What needs the network", Items: []string{"Purchase and licence delivery (once per licence)", "Fetching or refreshing the Ed25519-signed lease — binds licence to device key", "Downloading the Tauri installer — then verify SHA-256 before running", "Refreshing the lease periodically to pick up revocations — not to re-upload reports"}},
			{Title: "How offline is enforced", Items: []string{"Each device generates an Ed25519 keypair in the OS keychain; the lease is bound to that public key", "Rust verifies signature, device binding, and offline window before exposing entitlement to React", "Expiry is visible in the app — refresh before it lapses; no silent upload fallback exists"}},
		},
		ShowJourney: true, JourneyStep: 1, PrimaryCTA: "View pricing", PrimaryCTAURL: "/pricing", SecondaryCTA: "Install & verify", SecondaryCTAURL: "/install",
	})
}

func (a *App) installPage(w http.ResponseWriter, r *http.Request) {
	lang := a.mergePageData(r, PageData{}).Lang
	if lang == "fa" {
		a.renderSite(w, r, "static", PageData{Lang: "fa", Title: "نصب", Heading: "نصب و تأیید — SHA-256 پیش از اجرا", Body: "پس از دانلود و پیش از اجرا، چک‌سام نصب‌کننده را تأیید کنید. نصب‌کننده‌ها از کاتالوگ انتشار امضا شده با لینک‌های HMAC منقضی‌شونده سرو می‌شوند.",
			Sections: []PageSection{
				{Title: "ویندوز (x64)", Items: []string{"از دانلودها Report Maker ویندوز x64 .exe را دانلود کنید", "در PowerShell: Get-FileHash .\\ReportMaker_*.exe -Algorithm SHA256", "با SHA-256 نمایش داده شده در دانلودها مقایسه کنید — باید دقیقاً مطابقت داشته باشد"}},
				{Title: "macOS (یونیورسال)", Items: []string{"فایل .dmg یونیورسال را از دانلودها دانلود کنید", "در ترمینال: shasum -a 256 ReportMaker_*universal.dmg", "فایل .dmg را باز کنید و Report Maker را به Applications بکشید — gatekeeper باندل را تأیید می‌کند"}},
				{Title: "لینک‌های دانلود", Items: []string{"لینک‌ها منقضی می‌شود — برای تمدید از دانلودها وارد شوید در حالی که لایسنس فعال است", "VerifyArtifactChecksum پیش از هر سرو، SHA-256 را سمت سرور بررسی می‌کند؛ بررسی کلاینت دفاع در عمق است", "اگر چک‌سام ناموفق بود، فایل را حذف و دوباره دانلود کنید — با شناسه آرتیفکت با پشتیبانی تماس بگیرید"}},
			}, PrimaryCTA: "دانلودها", PrimaryCTAURL: "/account/downloads", SecondaryCTA: "کار آفلاین", SecondaryCTAURL: "/offline-use"})
		return
	}
	a.renderSite(w, r, "static", PageData{
		Title: "Install", Heading: "Install and verify — SHA-256 before you run",
		Body: "Verify the installer checksum after download and before running. Installers are served from the signed release catalog with HMAC-expiring links.",
		Sections: []PageSection{
			{Title: "Windows (x64)", Items: []string{"Download Reports: Windows x64 .exe from Downloads", "In PowerShell: Get-FileHash .\\ReportMaker_*.exe -Algorithm SHA256", "Compare to the SHA-256 shown on Downloads — must match exactly before running the installer"}},
			{Title: "macOS (universal)", Items: []string{"Download the universal .dmg from Downloads", "In Terminal: shasum -a 256 ReportMaker_*universal.dmg", "Open the .dmg and drag Report Maker into Applications — gatekeeper will verify the bundle"}},
			{Title: "Download links", Items: []string{"Links expire — sign in to renew from Downloads while your licence is active", "VerifyArtifactChecksum checks SHA-256 server-side before every serve; client re-check is defence in depth", "If checksum fails, delete the file and re-download — contact support with the artifact ID (desktop-windows-x64 / desktop-macos-universal)"}},
		},
		PrimaryCTA: "Downloads", PrimaryCTAURL: "/account/downloads", SecondaryCTA: "Offline use", SecondaryCTAURL: "/offline-use",
	})
}

func (a *App) faqPage(w http.ResponseWriter, r *http.Request) {
	lang := a.mergePageData(r, PageData{}).Lang
	if lang == "fa" {
		a.renderSite(w, r, "static", PageData{Lang: "fa", Title: "سوالات متداول", Heading: "سوالات متداول",
			Body: "پاسخ‌های لایسنس، پرداخت و دانلود در یک جا. اگر پاسخ خود را نیافتید، با شناسه سفارش به پشتیبانی بنویسید.",
			Sections: []PageSection{
				{Title: "خرید و لایسنس", Items: []string{"پس از پرداخت وارد شوید تا کلید کامل لایسنس را ببینید — بازگشت‌های بدون احراز هویت فقط کلید ماسک شده را نشان می‌دهد", "یک لایسنس Perpetual خروجی اصلی این نسخه اصلی را روی تا ۳ دستگاه پوشش می‌دهد", "وضعیت پرداخت به صورت بج نشان داده می‌شود: در انتظار → انتظار تأیید درگاه، لغو شده → بدون هزینه، موفق → لایسنس آماده"}},
				{Title: "پرداخت‌ها (زرین‌پال)", Items: []string{"تسویه حساب سفارش در انتظار ایجاد می‌کند سپس به درگاه داخلی هدایت می‌کند؛ ما authority + مبلغ را سرور-به-سرور پیش از هر صدور لایسنس تأیید می‌کنیم", "اگر بازگشت در انتظار می‌گوید، رسید را نگه دارید — تأیید ممکن است در تلاش مجدد یا از طریق پشتیبانی موفق شود", "پرداخت‌های آزمایشی فقط در توسعه کار می‌کند (REPORT_ALLOW_DEMO_PAYMENTS=1) و در پروداکشن رد می‌شود"}},
				{Title: "فعال‌سازی و کار آفلاین", Items: []string{"هر دستگاه کلید Ed25519 خود را در keychain سیستم‌عامل نگه می‌دارد؛ اجاره با Ed25519 امضا و به آن کلید مقید است", "پنجره آفلاین ۳۰ روز است (قابل تنظیم via REPORT_LEASE_DAYS) — در حالت آنلاین تمدید کنید", "دستگاهی را گم کردید؟ از پشتیبانی بخواهید فعال‌سازی آن را لغو کند و صندلی را آزاد کند"}},
				{Title: "دانلودها", Items: []string{"خرید را کامل کنید تا لینک‌های دانلود امضا شده باز شود — منقضی می‌شود و پس از ورود می‌توان تمدید کرد", "پس از دانلود SHA-256 را تأیید کنید: Windows PowerShell Get-FileHash یا macOS shasum -a 256", "پیش از اجرای هر نصب‌کننده برای مراحل پلتفرم به نصب مراجعه کنید"}},
				{Title: "حساب و ورود", Items: []string{"با پس‌کی (WebAuthn)، لینک جادویی با ایمیل یا رمز عبور وارد شوید — تأیید تلفن اختیاری است", "لینک‌های جادویی در ۱۵ دقیقه منقضی می‌شود؛ مراسم پس‌کی از هدرهای X-CSRF-Token محافظت شده استفاده می‌کند", "نشست‌ها می‌چرخد: ورود جدید قبلی را باطل می‌کند — اگر دستگاه مشترک است از خروج استفاده کنید"}},
			}, PrimaryCTA: "هنوز گیر کرده‌اید؟", PrimaryCTAURL: "/support", SecondaryCTA: "مشاهده قیمت", SecondaryCTAURL: "/pricing"})
		return
	}
	a.renderSite(w, r, "static", PageData{
		Title: "FAQ", Heading: "Frequently asked questions",
		Body: "Licence, payment, and download answers in one place. If you do not find yours, write to support with your order ID.",
		Sections: []PageSection{
			{Title: "Purchase & licence", Items: []string{"Sign in after payment to reveal your full licence key — unauthenticated callbacks show a masked key only", "One Perpetual licence covers core export for this major version on up to 3 devices", "Payment states are shown as badges: pending → waiting for gateway verify, cancelled → no charge, success → licence ready"}},
			{Title: "Payments (ZarinPal)", Items: []string{"Checkout creates a pending order then redirects to the domestic gateway; we verify authority + amount server-to-server before any licence is issued", "If the callback says pending, keep your receipt — verification may still succeed on retry or via support", "Demo payments only work in development (REPORT_ALLOW_DEMO_PAYMENTS=1) and are rejected in production"}},
			{Title: "Activation & offline use", Items: []string{"Each device holds its own Ed25519 keypair in the OS keychain; the lease is Ed25519-signed and bound to that key", "Offline window is 30 days (configurable via REPORT_LEASE_DAYS) — refresh while online to extend", "Lost a device? Ask support to revoke its activation and free the seat"}},
			{Title: "Downloads", Items: []string{"Complete a purchase to unlock signed download links — they expire and can be renewed after sign-in", "Verify SHA-256 after download: Windows PowerShell Get-FileHash or macOS shasum -a 256", "See Install for platform steps before running any installer"}},
			{Title: "Account & sign-in", Items: []string{"Sign in with passkey (WebAuthn), magic link by email, or password — phone verification is optional", "Magic links expire in 15 minutes; passkey ceremonies use CSRF-protected X-CSRF-Token headers", "Sessions rotate: a new sign-in invalidates the previous one — use Sign out if the device is shared"}},
		},
		PrimaryCTA: "Still stuck?", PrimaryCTAURL: "/support", SecondaryCTA: "View pricing", SecondaryCTAURL: "/pricing",
	})
}
