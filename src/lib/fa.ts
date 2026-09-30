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
