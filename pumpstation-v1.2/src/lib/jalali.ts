/** تبدیل و قالب‌بندی تاریخ شمسی (الگوریتم استاندارد jalaali) — تمام UI شمسی است. */

const TEHRAN = "Asia/Tehran";

function div(a: number, b: number) {
  return Math.trunc(a / b);
}
function mod(a: number, b: number) {
  return a - div(a, b) * b;
}

function jalCal(jy: number) {
  const breaks = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];
  let bl = breaks.length;
  let gy = jy + 621;
  let leapJ = -14;
  let jp = breaks[0];
  let jump = 0;
  for (let i = 1; i < bl; i += 1) {
    const jm = breaks[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

export function isLeapJalaali(jy: number) {
  return jalCal(jy).leap === 0;
}

export function jalaaliMonthLength(jy: number, jm: number) {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return isLeapJalaali(jy) ? 30 : 29;
}

export function toJalaali(gy: number, gm: number, gd: number) {
  let jy = gy - 621;
  const r = jalCal(jy);
  const gDayNo = gregorianDayNo(gy, gm, gd);
  let jDayNo = gDayNo - gregorianDayNo(r.gy, 3, r.march);
  let jm = 0;
  let jd = 0;
  if (jDayNo >= 0) {
    if (jDayNo <= 185) {
      jm = 1 + div(jDayNo, 31);
      jd = mod(jDayNo, 31) + 1;
      return { jy, jm, jd };
    }
    jDayNo -= 186;
  } else {
    jy -= 1;
    jDayNo += 179;
    if (r.leap === 1) jDayNo += 1;
  }
  jm = 7 + div(jDayNo, 30);
  jd = mod(jDayNo, 30) + 1;
  return { jy, jm, jd };
}

function gregorianDayNo(gy: number, gm: number, gd: number) {
  const d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
  return d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
}

export function jalaaliDayNo(jy: number, jm: number, jd: number) {
  const r = jalCal(jy);
  return gregorianDayNo(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

export function dayNoToGregorian(jdn: number) {
  let j = 4 * jdn + 139361631;
  j += div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

export function toGregorian(jy: number, jm: number, jd: number) {
  return dayNoToGregorian(jalaaliDayNo(jy, jm, jd));
}

export const PERSIAN_MONTHS = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
];

export const WEEKDAYS = ["یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه"];

export const INTERVALS = [
  { start: 7, end: 11, label: "۷ تا ۱۱" },
  { start: 11, end: 15, label: "۱۱ تا ۱۵" },
  { start: 15, end: 19, label: "۱۵ تا ۱۹" },
  { start: 19, end: 23, label: "۱۹ تا ۲۳" },
  { start: 23, end: 3, label: "۲۳ تا ۳" },
  { start: 3, end: 7, label: "۳ تا ۷" },
];

export function tehranParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TEHRAN,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  return {
    gy: Number(parts.year),
    gm: Number(parts.month),
    gd: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

export function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** ارقام لاتین به فارسی برای برچسب‌های نمایشی */
export function faDigits(input: string | number) {
  return String(input).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}

export function intervalIndexForHour(hour: number) {
  if (hour >= 7 && hour < 11) return 0;
  if (hour >= 11 && hour < 15) return 1;
  if (hour >= 15 && hour < 19) return 2;
  if (hour >= 19 && hour < 23) return 3;
  if (hour >= 23 || hour < 3) return 4;
  return 5;
}

/** روز عملیاتی از ساعت ۷ صبح تا ۷ صبح روز بعد */
export function operationalDay(now = new Date()) {
  const p = tehranParts(now);
  let dayNo = Math.floor(Date.UTC(p.gy, p.gm - 1, p.gd) / 86400000);
  let weekdayIndex = new Date(Date.UTC(p.gy, p.gm - 1, p.gd)).getUTCDay();
  if (p.hour < 7) {
    dayNo -= 1;
    weekdayIndex = (weekdayIndex + 6) % 7;
  }
  const g = new Date(dayNo * 86400000);
  const j = toJalaali(g.getUTCFullYear(), g.getUTCMonth() + 1, g.getUTCDate());
  return {
    day: `${j.jy}/${pad(j.jm)}/${pad(j.jd)}`,
    jy: j.jy,
    jm: j.jm,
    jd: j.jd,
    monthLabel: PERSIAN_MONTHS[j.jm - 1],
    weekday: WEEKDAYS[weekdayIndex],
    ordinal: dayNo,
    hour: p.hour,
    minute: p.minute,
    second: p.second,
    time: `${pad(p.hour)}:${pad(p.minute)}`,
    full: `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`,
    intervalIndex: intervalIndexForHour(p.hour),
  };
}

export function jalaliNow(now = new Date()) {
  const p = tehranParts(now);
  const j = toJalaali(p.gy, p.gm, p.gd);
  return `${j.jy}/${pad(j.jm)}/${pad(j.jd)} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

export function jalaliStamp(now = new Date()) {
  const p = tehranParts(now);
  const j = toJalaali(p.gy, p.gm, p.gd);
  return `${j.jy}-${pad(j.jm)}-${pad(j.jd)}_${pad(p.hour)}-${pad(p.minute)}-${pad(p.second)}`;
}

export function addDaysToDay(day: string, delta: number) {
  const [jy, jm, jd] = day.split("/").map(Number);
  const g = toGregorian(jy, jm, jd);
  const date = new Date(Date.UTC(g.gy, g.gm - 1, g.gd) + delta * 86400000);
  const j = toJalaali(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  return `${j.jy}/${pad(j.jm)}/${pad(j.jd)}`;
}

export function dayRangeBack(days: number, endDay: string) {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) out.push(addDaysToDay(endDay, -i));
  return out;
}

export function monthDaysOf(jy: number, jm: number) {
  return jalaaliMonthLength(jy, jm);
}
