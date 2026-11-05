#!/usr/bin/env node
/**
 * استخراج CODE_ALL_FA.txt به پوشهٔ مقصد (بایت‌به‌بایت برابر با منبع).
 *
 *   node scripts/extract-code-all.mjs [bundle] [outDir]
 *   پیش‌فرض: CODE_ALL_FA.txt در ریشهٔ برنامه → ./fresh-extract
 *
 * قرارداد قالب (تولیدشده با scripts/generate-code-all.mjs):
 *   ── FILE: <مسیر>  (<n> خط) ──\n\n<محتوا>\n\n
 * که <محتوا> دقیقاً خط‌های منبع بدون \n پایانی است و n = تعداد خط‌های
 * محتوا + ۱. برش با n انجام و سپس مرزبندی (خط خالی + مارکر/سربرگ/پایان)
 * اعتبارسنجی می‌شود؛ هر انحرافی خطا می‌دهد نه خروجی خراب.
 * ورودی‌های «../...» (فایل CI بیرون از ریشهٔ برنامه) رد می‌شوند چون برای
 * ساخت/اجرا/تست لازم نیستند.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export function extractBundle(bundlePath, outDir) {
  const abs = path.resolve(bundlePath);
  const dest = path.resolve(outDir);
  const text = readFileSync(abs, "utf8").replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const files = [];
  const skipped = [];
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(/^── FILE: (\S+)  \((\d+) خط\) ──$/);
    if (!m) { i += 1; continue; }
    const [, rel, countStr] = m;
    const expected = Number(countStr);
    i += 1;
    if (lines[i] !== "") throw new Error(`قالب خراب پس از مارکر ${rel}: خط خالی نیست`);
    i += 1;
    const start = i;
    // شمارش خط از روی مارکر قطعی است؛ پس از برش، مرزبندی اعتبارسنجی می‌شود
    const content = lines.slice(start, start + expected - 1);
    i = start + expected - 1;
    if (content.length !== expected - 1 || lines[i] !== "") {
      throw new Error(`شمارش خط ${rel} هم‌خوان نیست (مارکر=${expected})`);
    }
    const next = lines[i + 1] ?? "";
    const restBlank = lines.slice(i + 1).join("\n").trim() === "";
    if (!restBlank && !next.startsWith("── FILE: ") && !next.startsWith("####")) {
      throw new Error(`مرز پایانی ${rel} خراب است`);
    }
    if (rel.startsWith("../") || path.isAbsolute(rel)) {
      skipped.push(rel);
    } else {
      const target = path.join(dest, rel);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, content.join("\n") + "\n");
      files.push(rel);
    }
    i += 1; // رد شدن از خط خالی جداکننده
  }
  if (!files.length) throw new Error("هیچ فایلی از بسته استخراج نشد");
  return { files, skipped };
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) === new URL(import.meta.url).pathname : false;
if (invoked) {
  const appRoot = path.dirname(path.dirname(new URL(import.meta.url).pathname));
  const bundle = process.argv[2] ?? path.join(appRoot, "CODE_ALL_FA.txt");
  const out = process.argv[3] ?? path.join(appRoot, "fresh-extract");
  const { files, skipped } = extractBundle(bundle, out);
  console.log(`استخراج شد: ${files.length} فایل → ${out}`);
  for (const s of skipped) console.warn(`رد شد (بیرون از ریشهٔ برنامه): ${s}`);
}
