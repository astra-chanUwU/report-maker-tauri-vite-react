/** Persian helpers: Jalali date, FA digits, letterhead. No deps. */

const FA_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];

export function toFaDigits(s: string | number): string {
  return String(s).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);
}

function div(a: number, b: number): number {
  return Math.floor(a / b);
}
function mod(a: number, b: number): number {
  return a - Math.floor(a / b) * b;
}

/** Gregorian yyyy-mm-dd → Jalali [jy, jm, jd]. Algorithm: jalaali-js (public domain logic). */
export function gregorianToJalali(gy: number, gm: number, gd: number): [number, number, number] {
  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let jy = gy <= 1600 ? 0 : 979;
  let gy2 = gy <= 1600 ? gy : gy - 1600;
  let days =
    365 * gy2 +
    div(gy2 + 3, 4) -
    div(gy2 + 99, 100) +
    div(gy2 + 399, 400) -
    80 +
    gd +
    g_d_m[gm - 1];
  jy += 33 * div(days, 12053);
  days = mod(days, 12053);
  jy += 4 * div(days, 1461);
  days = mod(days, 1461);
  if (days > 365) {
    jy += div(days - 1, 365);
    days = mod(days - 1, 365);
  }
  let jm: number;
  let jd: number;
  if (days < 186) {
    jm = 1 + div(days, 31);
    jd = 1 + mod(days, 31);
  } else {
    jm = 7 + div(days - 186, 30);
    jd = 1 + mod(days - 186, 30);
  }
  return [jy, jm, jd];
}

/** ISO yyyy-mm-dd → Jalali yyyy/mm/dd (latin digits; use toFaDigits for FA). */
export function isoToJalali(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return "";
  const [jy, jm, jd] = gregorianToJalali(Number(m[1]), Number(m[2]), Number(m[3]));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${jy}/${p(jm)}/${p(jd)}`;
}

export function isoToJalaliFa(iso: string): string {
  const j = isoToJalali(iso);
  return j ? toFaDigits(j) : "";
}

export const DEFAULT_ADDRESS_BLOCK_FA =
  "یزد، اردکان - بلوار شهید بهشتی - کوچه ۱۹۶ - کد پستی 8951964634 - تلفکس: 03532239167";
export const DEFAULT_ADDRESS_BLOCK_EN =
  "No. 8951964634 - 196 St - Dr. Beheshti Ave. - Ardakan - Yazd - Iran - Tel: 32239167";

const FA_SECTIONS: Record<string, string> = {
  summary: "خلاصه",
  overall: "ارتعاش کلی",
  spectra: "طیف فرکانسی",
  data: "جدول داده",
  measuring: "نتایج اندازه‌گیری",
  trends: "روند ارتعاشات",
  trendsAll: "روند ارتعاشات همه نقاط",
  fft: "طیف فرکانسی نقاط مختلف",
  methodology: "روش",
  observations: "مشاهدات",
  recommendations: "اقدامات اصلاحی",
  conclusion: "نتیجه‌گیری",
  notes: "یادداشت",
  iso: "جدول استاندارد ISO 10816-3",
  isoBlurb: "حدود شدت ارتعاش بر اساس گروه ماشین، فونداسیون و توان",
  approval: "تأیید",
  velocity: "روند سرعت",
  acceleration: "روند شتاب",
  envelope: "روند انولوپ",
  equipment: "تجهیز",
  toc: "فهرست مطالب",
  description: "شرح وضعیت",
  specs: "مشخصات فنی",
  lastReport: "آخرین گزارش",
  problems: "مشکلات شناسایی‌شده",
  actions: "اقدامات لازم",
  status: "وضعیت تجهیز",
  schematic: "شماتیک",
  measPoint: "نقطه",
  measTotal: "کل",
  measAvg: "میانگین",
  measPrev: "قبلی",
  measCurr: "فعلی",
  measZoneV: "ناحیه سرعت",
  measZoneA: "ناحیه شتاب",
  measPeaks: "فهرست پیک",
  measPointLong: "نقطه اندازه‌گیری",
  machineName: "نام ماشین",
  plant: "واحد",
  measVelocity: "سرعت — RMS (mm/s)",
  measTrend: "روند (میانگین · قبلی · فعلی)",
  freq: "فرکانس",
  amp: "دامنه",
  metric: "مورد",
  value: "مقدار",
  unit: "واحد",
  measured: "تاریخ اندازه‌گیری",
  pointDir: "نقطه / جهت",
  rmsDva: "RMS جابجایی / سرعت / شتاب",
  peakDva: "پیک جابجایی / سرعت / شتاب",
  peakFreq: "فرکانس پیک",
  freqLines: "محدوده فرکانس / خطوط",
  zoneVLimits: "حدود ناحیه سرعت (B/U/C)",
  zoneALimits: "حدود ناحیه شتاب / BC (B/U/C)",
  zoneELimits: "حدود ناحیه انولوپ (B/U/C)",
};

const EN_SECTIONS: Record<string, string> = {
  summary: "Summary",
  overall: "Overall vibration",
  spectra: "Spectra chart",
  data: "Data",
  measuring: "Measuring results",
  trends: "Vibration trends",
  trendsAll: "Vibration trends (all points)",
  fft: "Frequency spectra (all points)",
  methodology: "Methodology",
  observations: "Observations",
  recommendations: "Recommendations",
  conclusion: "Conclusion",
  notes: "Notes",
  iso: "ISO 10816-3 standards",
  isoBlurb: "Vibration severity limits by machinery group, mounting, and rated power",
  approval: "Approval",
  velocity: "Velocity RMS trend",
  acceleration: "Acceleration RMS trend",
  envelope: "Envelope RMS trend",
  equipment: "Equipment",
  toc: "Table of contents",
  description: "Description",
  specs: "Technical specifications",
  lastReport: "Last report",
  problems: "Identified problems (AI)",
  actions: "Corrective actions",
  status: "Condition status",
  schematic: "Schematic",
  measPoint: "Point",
  measTotal: "Total",
  measAvg: "Avg",
  measPrev: "Prev",
  measCurr: "Curr",
  measZoneV: "V Zone",
  measZoneA: "A Zone",
  measPeaks: "Peak List",
  measPointLong: "Measuring point",
  machineName: "Machine Name",
  plant: "Plant",
  measVelocity: "Velocity — RMS (mm/s)",
  measTrend: "Trend (Avg · Prev · Cur)",
  freq: "Freq",
  amp: "Amp",
  metric: "Metric",
  value: "Value",
  unit: "Unit",
  measured: "Measured",
  pointDir: "Point / Direction",
  rmsDva: "RMS D / V / A",
  peakDva: "Peak D / V / A",
  peakFreq: "Peak freq",
  freqLines: "Freq range / lines",
  zoneVLimits: "Velocity zone limits (B/U/C)",
  zoneALimits: "Acceleration / BC zone limits (B/U/C)",
  zoneELimits: "Envelope zone limits (B/U/C)",
};

export function sectionTitle(lang: "en" | "fa" | undefined, key: string): string {
  const table = lang === "fa" ? FA_SECTIONS : EN_SECTIONS;
  return table[key] ?? EN_SECTIONS[key] ?? key;
}
