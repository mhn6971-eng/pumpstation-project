import SAMPLE_ROSTER_FILE from "../../data/roster.sample.json";

export type EquipmentStatus = "ready" | "in_service";
export type MotorState = "on" | "off" | "service";
export type Severity = "ok" | "warning" | "critical";

/**
 * روستر نمونهٔ ساختگی (نام‌ها و PINها واقعی نیستند) — فقط برای تست و توسعه.
 * نام واقعی اپراتورها و PIN واقعی در `data/roster.local.json` روی دستگاه
 * ایستگاه است و هرگز در کد و گیت نمی‌آید (src/lib/roster.ts).
 */
export type RosterEntry = {
  key: string;
  label: string;
  role: "operator" | "admin";
  pin: string;
  members: string[];
};

export const SAMPLE_ROSTER: RosterEntry[] = (SAMPLE_ROSTER_FILE as unknown as { roster: RosterEntry[] }).roster;

export const MOTORS = [
  { tag: "M-01", pumpTag: "P-01" },
  { tag: "M-02", pumpTag: "P-02" },
  { tag: "M-03", pumpTag: "P-03" },
  { tag: "M-04", pumpTag: "P-04" },
  { tag: "M-05", pumpTag: "P-05" },
  { tag: "M-06", pumpTag: "P-06" },
  { tag: "M-07", pumpTag: "P-07" },
  { tag: "M-08", pumpTag: "P-08" },
];

export const PROCESS_PARAMS = [
  { tag: "PIT-001", label: "فشار تونل / مکش", unit: "bar", warnMin: null, warnMax: null, critMin: null, critMax: null },
  { tag: "PIT-002", label: "فشار خط رانش", unit: "bar", warnMin: 18, warnMax: 24, critMin: 16, critMax: 26 },
  { tag: "PIT-003", label: "فشار سرچ تانک ۱", unit: "bar", warnMin: 2, warnMax: 5, critMin: 1, critMax: 6 },
  { tag: "PIT-004", label: "فشار سرچ تانک ۲", unit: "bar", warnMin: 2, warnMax: 5, critMin: 1, critMax: 6 },
  { tag: "FIT-001", label: "دبی لحظه‌ای", unit: "L/s", warnMin: 320, warnMax: 520, critMin: 280, critMax: 540 },
  { tag: "LT-01", label: "ارتفاع مخزن تصفیه‌خانه ۱", unit: "cm", warnMin: 40, warnMax: 280, critMin: 20, critMax: 300 },
  { tag: "LT-02", label: "ارتفاع مخزن تصفیه‌خانه ۲", unit: "cm", warnMin: 40, warnMax: 280, critMin: 20, critMax: 300 },
];

export const MOTOR_PARAM_GROUPS = [
  {
    title: "جریان سه‌فاز",
    params: [
      { key: "I1", label: "جریان فاز ۱", unit: "A", type: "current" },
      { key: "I2", label: "جریان فاز ۲", unit: "A", type: "current" },
      { key: "I3", label: "جریان فاز ۳", unit: "A", type: "current" },
    ],
  },
  {
    title: "دمای سیم‌پیچ و بدنه (T1 تا T10)",
    params: Array.from({ length: 10 }, (_, i) => ({
      key: `T${i + 1}`,
      label: `دما ${i + 1}`,
      unit: "°C",
      type: "temp",
    })),
  },
  {
    title: "دمای یاتاقان پمپ",
    params: [
      { key: "BRG-P-DE", label: "یاتاقان DE", unit: "°C", type: "bearing" },
      { key: "BRG-P-NDE", label: "یاتاقان NDE", unit: "°C", type: "bearing" },
    ],
  },
  {
    title: "لرزش (mm/s)",
    params: [
      { key: "VIB-P-DE", label: "پمپ جلو", unit: "mm/s", type: "vib" },
      { key: "VIB-P-NDE", label: "پمپ عقب", unit: "mm/s", type: "vib" },
      { key: "VIB-M-DE", label: "موتور جلو", unit: "mm/s", type: "vib" },
      { key: "VIB-M-NDE", label: "موتور عقب", unit: "mm/s", type: "vib" },
    ],
  },
];

export const MOTOR_PARAMS = MOTOR_PARAM_GROUPS.flatMap((g) =>
  g.params.map((p) => ({ ...p, group: g.title })),
);

export const APP_NAME = "سامانه پایش ایستگاه پمپاژ زیرزمینی";
export const APP_SUBTITLE = "تونل انتقال آب گلاب";
export const ORG_NAME = "شرکت سهامی آب منطقه‌ای اصفهان";

export const CATEGORIES = [
  "شیرآلات",
  "ابزار دقیق",
  "موتورها و الکتروپمپ‌ها",
  "سیستم‌ها و اتوماسیون اتاق کنترل",
  "ابزارآلات و آچارها",
  "تابلوهای فشار ضعیف",
  "تابلوهای فشار قوی",
  "تابلوهای لوکال",
  "تابلوهای بانک خازنی",
  "ترانس‌ها",
  "تجهیزات جانبی و پشتیبان",
];

/** قالب‌های اولیه PM؛ فرم کامل بعداً از کارفرما دریافت و توسط ادمین ویرایش می‌شود */
export const PM_TEMPLATE_SEED: { category: string; name: string; items: string[] }[] = [
  { category: "موتورها و الکتروپمپ‌ها", name: "PM سالانه الکتروموتور/پمپ", items: ["بازدید چشمی بدنه و پایه‌ها", "کنترل سفتی پیچ‌های فونداسیون", "کنترل هم‌محوری کوپلینگ", "بررسی نشتی آب‌بند/پکینگ", "کنترل سطح و کیفیت روغن یاتاقان", "اندازه‌گیری لرزش", "اندازه‌گیری دمای یاتاقان‌ها", "تمیزکاری مسیر هوای خنک‌کننده"] },
  { category: "شیرآلات", name: "PM شیرآلات", items: ["بازدید نشتی از بدنه و فلنج‌ها", "تست باز/بسته کامل", "روغن‌کاری ساقه", "کنترل عملکرد اکچویتور/هندول", "کنترل لیمیت‌سوئیچ‌ها"] },
  { category: "ابزار دقیق", name: "PM ابزار دقیق", items: ["کنترل صفر و اسپن", "بازدید کابل و گلند", "تمیزکاری سنسور", "مقایسه با مرجع"] },
  { category: "تابلوهای فشار ضعیف", name: "PM تابلو فشار ضعیف", items: ["ترموگرافی اتصالات", "سفت‌کردن ترمینال‌ها", "تمیزکاری داخلی", "تست کلیدها و کنتاکتورها", "کنترل لامپ‌های سیگنال"] },
  { category: "تابلوهای فشار قوی", name: "PM تابلو فشار قوی", items: ["بازدید عایق‌ها و مقره‌ها", "تست مکانیزم بریکر", "کنترل رله‌های حفاظتی", "اندازه‌گیری مقاومت تماس", "تمیزکاری سلول‌ها"] },
  { category: "تابلوهای لوکال", name: "PM تابلو لوکال", items: ["کنترل شستی‌ها و سلکتورها", "کنترل لامپ‌ها", "بازدید کابل‌کشی", "تمیزکاری"] },
  { category: "تابلوهای بانک خازنی", name: "PM بانک خازنی", items: ["اندازه‌گیری جریان هر پله", "بازدید تورم/نشتی خازن‌ها", "کنترل کنتاکتورهای خازنی", "تست رگولاتور"] },
  { category: "ترانس‌ها", name: "PM ترانس", items: ["کنترل سطح روغن/سیلیکاژل", "ترموگرافی بوشینگ‌ها", "تست مقاومت عایقی", "کنترل سیستم خنک‌کاری", "بازدید تپ‌چنجر"] },
  { category: "تجهیزات جانبی و پشتیبان", name: "PM تجهیزات جانبی", items: ["تست راه‌اندازی", "کنترل سوخت/روغن/فیلتر", "کنترل باتری و شارژر", "بازدید نشتی و صدای غیرعادی"] },
  { category: "سیستم‌ها و اتوماسیون اتاق کنترل", name: "PM اتوماسیون/UPS", items: ["تست باتری UPS", "بک‌آپ برنامه PLC", "کنترل آلارم‌های HMI", "تمیزکاری فیلتر هوای تابلو"] },
  { category: "ابزارآلات و آچارها", name: "PM ابزارآلات", items: ["شمارش و کنترل سلامت", "کالیبراسیون ابزار اندازه‌گیری"] },
];

export const AUX_TAGS = [
  "GEN-01", "GEN-02", "F-01", "F-02", "F-03", "F-04", "COMP-01", "COMP-02",
  "P-13", "P-14", "P-15", "P-16", "P-17", "P-18", "P-19", "P-21", "P-22",
  "DP-01", "DP-02", "DP-03", "DP-04", "PKG-01", "AHU-01", "TR-A", "TR-B",
  "XV-301", "XV-302", "RV-01", "RV-02", "UPS-1", "UPS-2", "UPS-3", "SIREN-01",
];

export const SAFETY_TAGS = [
  "XV-301", "XV-302", "P-21", "P-22", "RV-01", "RV-02", "GEN-01", "GEN-02",
  "UPS-1", "UPS-2", "UPS-3", "SIREN-01",
];

export type Settings = {
  serviceInterval: number;
  vibWarn: number;
  vibCrit: number;
  windingWarn: number;
  windingCrit: number;
  bearingWarn: number;
  bearingCrit: number;
  currentWarn: number;
  currentCrit: number;
  /** خالی = چرخش خودکار شیفت */
  shiftOverride: string;
};

export const DEFAULT_SETTINGS: Settings = {
  serviceInterval: 1500,
  vibWarn: 4.5,
  vibCrit: 7.1,
  windingWarn: 80,
  windingCrit: 90,
  bearingWarn: 70,
  bearingCrit: 80,
  currentWarn: 120,
  currentCrit: 140,
  shiftOverride: "",
};

export const EQUIPMENT_SEED: {
  tag: string;
  name: string;
  category: string;
  spec?: string;
  location?: string;
  status?: EquipmentStatus;
  isAux?: boolean;
  safetyCritical?: boolean;
  isMotor?: boolean;
}[] = [
  ...MOTORS.map((m, i) => ({
    tag: m.tag,
    name: `الکتروموتور اصلی اسلیپ‌رینگ ${m.tag}`,
    category: "موتورها و الکتروپمپ‌ها",
    spec: "۱۸۰۰ kW / ۶.۶ kV / ۱۴۸۵ rpm",
    location: "مغار اصلی",
    isMotor: true,
    status: "ready" as EquipmentStatus,
  })),
  ...MOTORS.map((m) => ({
    tag: m.pumpTag,
    name: `پمپ سانتریفیوژ اصلی ${m.pumpTag}`,
    category: "موتورها و الکتروپمپ‌ها",
    spec: "۵۰۰ L/s / هد ۲۲۰ m",
    location: "مغار اصلی",
  })),
  { tag: "GEN-01", name: "دیزل ژنراتور تونل", category: "تجهیزات جانبی و پشتیبان", spec: "۲۰۰ kVA / ۴۰۰ V", location: "تونل", isAux: true, safetyCritical: true },
  { tag: "GEN-02", name: "دیزل ژنراتور سوله", category: "تجهیزات جانبی و پشتیبان", spec: "۱۵۰ kVA / ۴۰۰ V", location: "سوله", isAux: true, safetyCritical: true },
  { tag: "F-01", name: "فن تهویه ۱", category: "تجهیزات جانبی و پشتیبان", spec: "۴۰۰ V", location: "تونل", isAux: true },
  { tag: "F-02", name: "فن تهویه ۲", category: "تجهیزات جانبی و پشتیبان", spec: "۴۰۰ V", location: "تونل", isAux: true },
  { tag: "F-03", name: "فن تهویه ۳", category: "تجهیزات جانبی و پشتیبان", spec: "۴۰۰ V", location: "سوله", isAux: true },
  { tag: "F-04", name: "فن تهویه ۴", category: "تجهیزات جانبی و پشتیبان", spec: "۴۰۰ V", location: "سوله", isAux: true },
  { tag: "COMP-01", name: "کمپرسور سرچ تانک ۱", category: "تجهیزات جانبی و پشتیبان", spec: "۱۱ kW", location: "انتهای مغار", isAux: true },
  { tag: "COMP-02", name: "کمپرسور سرچ تانک ۲", category: "تجهیزات جانبی و پشتیبان", spec: "۱۱ kW", location: "انتهای مغار", isAux: true },
  { tag: "P-13", name: "پمپ خنک‌کن موتورها ۱", category: "موتورها و الکتروپمپ‌ها", spec: "۴۰۰ V", location: "تاسیسات", isAux: true },
  { tag: "P-14", name: "پمپ خنک‌کن موتورها ۲", category: "موتورها و الکتروپمپ‌ها", spec: "۴۰۰ V", location: "تاسیسات", isAux: true },
  { tag: "P-15", name: "پمپ خنک‌کن ترانس‌ها ۱", category: "موتورها و الکتروپمپ‌ها", spec: "۴۰۰ V", location: "تاسیسات", isAux: true },
  { tag: "P-16", name: "پمپ خنک‌کن ترانس‌ها ۲", category: "موتورها و الکتروپمپ‌ها", spec: "۴۰۰ V", location: "تاسیسات", isAux: true },
  { tag: "P-17", name: "پمپ خنک‌کن پکیج", category: "موتورها و الکتروپمپ‌ها", spec: "۴۰۰ V", location: "تاسیسات", isAux: true },
  { tag: "P-18", name: "پمپ خنک‌کن هواساز", category: "موتورها و الکتروپمپ‌ها", spec: "۴۰۰ V", location: "تاسیسات", isAux: true },
  { tag: "P-19", name: "پمپ میکاپ", category: "موتورها و الکتروپمپ‌ها", spec: "۴۰۰ V", location: "تاسیسات", isAux: true },
  { tag: "P-21", name: "پمپ آتش‌نشانی ۱", category: "موتورها و الکتروپمپ‌ها", spec: "۴۰۰ V", location: "اتاق آتش‌نشانی", isAux: true, safetyCritical: true },
  { tag: "P-22", name: "پمپ آتش‌نشانی ۲", category: "موتورها و الکتروپمپ‌ها", spec: "۴۰۰ V", location: "اتاق آتش‌نشانی", isAux: true, safetyCritical: true },
  { tag: "DP-01", name: "کفکش چاهک ۱", category: "موتورها و الکتروپمپ‌ها", spec: "۴۰۰ V", location: "چاهک‌ها", isAux: true },
  { tag: "DP-02", name: "کفکش چاهک ۲", category: "موتورها و الکتروپمپ‌ها", spec: "۴۰۰ V", location: "چاهک‌ها", isAux: true },
  { tag: "DP-03", name: "کفکش چاهک ۳", category: "موتورها و الکتروپمپ‌ها", spec: "۴۰۰ V", location: "چاهک‌ها", isAux: true },
  { tag: "DP-04", name: "کفکش چاهک ۴", category: "موتورها و الکتروپمپ‌ها", spec: "۴۰۰ V", location: "چاهک‌ها", isAux: true },
  { tag: "PKG-01", name: "پکیج خنک‌کاری", category: "تجهیزات جانبی و پشتیبان", spec: "—", location: "اتاق تاسیسات", isAux: true },
  { tag: "AHU-01", name: "هواساز", category: "تجهیزات جانبی و پشتیبان", spec: "—", location: "اتاق تاسیسات", isAux: true },
  { tag: "TR-A", name: "ترانس هوایی A", category: "ترانس‌ها", spec: "۱۲۰ kVA", location: "محوطه", isAux: true },
  { tag: "TR-B", name: "ترانس هوایی B", category: "ترانس‌ها", spec: "۱۲۰ kVA", location: "محوطه", isAux: true },
  { tag: "TR-01", name: "ترانس اصلی ۱", category: "ترانس‌ها", spec: "۱۰ MVA / 20kV/6.6kV", location: "اتاق ترانس ۱" },
  { tag: "TR-02", name: "ترانس اصلی ۲", category: "ترانس‌ها", spec: "۱۰ MVA / 20kV/6.6kV", location: "اتاق ترانس ۲" },
  { tag: "TR-03", name: "ترانس خشک", category: "ترانس‌ها", spec: "20kV/400V", location: "اتاق ترانس خشک" },
  { tag: "XV-301", name: "شیر دلیوژ آتش‌نشانی ترانس ۱", category: "شیرآلات", spec: "موتوردار", location: "ترانس ۱", isAux: true, safetyCritical: true },
  { tag: "XV-302", name: "شیر دلیوژ آتش‌نشانی ترانس ۲", category: "شیرآلات", spec: "موتوردار", location: "ترانس ۲", isAux: true, safetyCritical: true },
  { tag: "RV-01", name: "شیر اطمینان سامپ ۱", category: "شیرآلات", spec: "—", location: "سامپ", isAux: true, safetyCritical: true },
  { tag: "RV-02", name: "شیر اطمینان سامپ ۲", category: "شیرآلات", spec: "—", location: "سامپ", isAux: true, safetyCritical: true },
  { tag: "UPS-1", name: "UPS اتاق کنترل ۱", category: "سیستم‌ها و اتوماسیون اتاق کنترل", spec: "۱۰ kVA", location: "اتاق کنترل", isAux: true, safetyCritical: true },
  { tag: "UPS-2", name: "UPS اتاق کنترل ۲", category: "سیستم‌ها و اتوماسیون اتاق کنترل", spec: "۱۰ kVA", location: "اتاق کنترل", isAux: true, safetyCritical: true },
  { tag: "UPS-3", name: "UPS اتاق کنترل ۳", category: "سیستم‌ها و اتوماسیون اتاق کنترل", spec: "۱۰ kVA", location: "اتاق کنترل", isAux: true, safetyCritical: true },
  { tag: "SIREN-01", name: "سیرن اعلام حریق", category: "سیستم‌ها و اتوماسیون اتاق کنترل", spec: "—", location: "ایستگاه", isAux: true, safetyCritical: true },
  { tag: "PIT-001", name: "ترانسمیتر فشار مکش", category: "ابزار دقیق", spec: "۰ تا ۱۶ bar", location: "خط مکش" },
  { tag: "PIT-002", name: "ترانسمیتر فشار رانش", category: "ابزار دقیق", spec: "۰ تا ۴۰ bar", location: "خط رانش" },
  { tag: "PIT-003", name: "ترانسمیتر فشار سرچ تانک ۱", category: "ابزار دقیق", spec: "۰ تا ۱۰ bar", location: "سرچ تانک ۱" },
  { tag: "PIT-004", name: "ترانسمیتر فشار سرچ تانک ۲", category: "ابزار دقیق", spec: "۰ تا ۱۰ bar", location: "سرچ تانک ۲" },
  { tag: "FIT-001", name: "فلومتر خط رانش", category: "ابزار دقیق", spec: "۰ تا ۷۰۰ L/s", location: "خط رانش" },
  { tag: "LT-01", name: "سطح‌سنج مخزن تصفیه‌خانه ۱", category: "ابزار دقیق", spec: "۰ تا ۳۰۰ cm", location: "تصفیه‌خانه" },
  { tag: "LT-02", name: "سطح‌سنج مخزن تصفیه‌خانه ۲", category: "ابزار دقیق", spec: "۰ تا ۳۰۰ cm", location: "تصفیه‌خانه" },
  ...Array.from({ length: 8 }, (_, i) => ({
    tag: `XV-${101 + i}`,
    name: `شیر خروجی موتوردار پمپ ${i + 1}`,
    category: "شیرآلات",
    spec: "موتوردار",
    location: `پمپ P-0${i + 1}`,
  })),
  ...Array.from({ length: 8 }, (_, i) => ({
    tag: `XV-${201 + i}`,
    name: `شیر ورودی پمپ ${i + 1}`,
    category: "شیرآلات",
    spec: "دستی/موتوردار",
    location: `پمپ P-0${i + 1}`,
  })),
  ...Array.from({ length: 8 }, (_, i) => ({
    tag: `MOV-1400-0${i + 1}`,
    name: `ولو موتوری ۱۴۰۰ شماره ${i + 1}`,
    category: "شیرآلات",
    spec: "VAG 1400",
    location: "خطوط فرآیند",
  })).slice(0, 3),
  ...Array.from({ length: 8 }, (_, i) => ({
    tag: `RS-0${i + 1}`,
    name: `استارتر مقاومتی ${i + 1}`,
    category: "تابلوهای فشار قوی",
    spec: "استارت مقاومتی",
    location: "اتاق استارتر",
    status: (i === 7 ? "in_warehouse" : "ready") as EquipmentStatus,
  })),
  ...["PLC-400H", "IRP", "BUSVT-1", "BUSVT-2", "RISER-VT", "METERING"].map((tag) => ({
    tag,
    name: `تابلو ${tag}`,
    category: "سیستم‌ها و اتوماسیون اتاق کنترل",
    spec: "—",
    location: "اتاق کنترل",
  })),
  ...["LVS1", "LVS2", "BAT-CHG", "SW-PNL-1", "SW-PNL-2", "TNLP-1", "TNLP-2", "NLP"].map((tag) => ({
    tag,
    name: `تابلو ${tag}`,
    category: "تابلوهای فشار ضعیف",
    spec: "—",
    location: "اتاق برق",
  })),
  ...["INCOMING-A", "INCOMING-B", "COUPL", "TR1", "TR2", "TR3", "MOTOR-01", "MOTOR-02", "MOTOR-03", "MOTOR-04", "MOTOR-05", "MOTOR-06", "MOTOR-07", "MOTOR-08"].map((tag) => ({
    tag,
    name: `سلول فشار قوی ${tag}`,
    category: "تابلوهای فشار قوی",
    spec: "20 kV / 6.6 kV",
    location: "اتاق برق MV",
  })),
  ...Array.from({ length: 8 }, (_, i) => ({
    tag: `CP-0${i + 1}`,
    name: `تابلو لوکال پمپ ${i + 1}`,
    category: "تابلوهای لوکال",
    spec: "کنترل محلی",
    location: `کنار پمپ P-0${i + 1}`,
  })),
  { tag: "CAP-BANK-1", name: "بانک خازنی ۱", category: "تابلوهای بانک خازنی", spec: "400 V", location: "اتاق برق" },
  { tag: "CAP-BANK-2", name: "بانک خازنی ۲", category: "تابلوهای بانک خازنی", spec: "400 V", location: "اتاق برق" },
];

export const STATUS_FA: Record<string, string> = {
  ready: "آماده به کار",
  in_service: "در حال سرویس",
  in_warehouse: "در انبار",
};

export const MOTOR_STATE_FA: Record<string, string> = {
  on: "روشن",
  off: "خاموش",
  service: "در سرویس",
};

export function severityRank(s: Severity) {
  return s === "critical" ? 2 : s === "warning" ? 1 : 0;
}

export function serviceTone(pct: number): "ok" | "warn" | "crit" {
  if (pct >= 90) return "crit";
  if (pct >= 50) return "warn";
  return "ok";
}

/* ---------------------------------------------------------------------------
 * محدودهٔ فیزیکی مقادیر (H4 در گزارش بازبینی)
 * مقدار بیرون از این محدوده یعنی خطای تایپ اپراتور، نه یک اندازه‌گیری واقعی.
 * ------------------------------------------------------------------------- */
export const PROCESS_LIMITS: Record<string, [number, number]> = {
  "PIT-001": [0, 40],        // فشار تونل / مکش (bar)
  "PIT-002": [0, 40],        // فشار خط رانش (bar)
  "PIT-003": [0, 10],        // فشار سرچ تانک ۱ (bar)
  "PIT-004": [0, 10],        // فشار سرچ تانک ۲ (bar)
  "FIT-001": [0, 800],       // دبی لحظه‌ای (L/s)
  "LT-01": [0, 400],         // ارتفاع مخزن تصفیه‌خانه ۱ (cm)
  "LT-02": [0, 400],         // ارتفاع مخزن تصفیه‌خانه ۲ (cm)
};

/** محدودهٔ مجاز بر اساس نوع پارامتر موتور */
export const MOTOR_TYPE_LIMITS: Record<string, [number, number]> = {
  current: [0, 2000],   // آمپر
  temp: [-20, 250],     // درجه سانتی‌گراد
  bearing: [-20, 250],  // درجه سانتی‌گراد
  vib: [0, 100],        // mm/s
};

/** توتال روزانه (متر مکعب) */
export const TOTAL_LIMITS: [number, number] = [0, 1_000_000];

export function limitError(label: string, unit: string, min: number, max: number) {
  return new Error(`${label}: مقدار باید بین ${min} و ${max} ${unit} باشد`);
}
