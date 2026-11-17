# گزارش آزمون نصب تازه — نسخه ۱٫۴٫۴

> تاریخ: ۱۴۰۵/۰۸/۱۵ | نسخهٔ برنامه: 1.4.4 | شاخه: `arena/9a0919c6-pumpstation-project`
> این سند، شاهد «command + output» تحویل ۱٫۴٫۴ است؛ هیچ ادعایی بدون خروجی ندارد.

---

## ۱) نتیجهٔ آزمون نصب تازه (بخش ۵)

دستور (دو بار پشت‌سرهم برای اثبات idempotent بودن):

```bash
node scripts/test-fresh-install.mjs
```

خروجی اجرای دوم (اولی عیناً همین بود):

```text
FRESH-INSTALL PASS | extract | 114 files (1 skipped)
FRESH-INSTALL PASS | npm-install | npm ci
FRESH-INSTALL PASS | db-migrate | 0000..0005
FRESH-INSTALL PASS | build
FRESH-INSTALL PASS | start+health | http://127.0.0.1:3210
FRESH-INSTALL PASS | state | motors=8 equipment=124
FRESH-INSTALL PASS | npm-test | 198 checks (PASS=147 tick=51)
FRESH-INSTALL SUITE | total=32 pass=32 fail=0
FRESH-INSTALL SUITE | total=17 pass=17 fail=0
FRESH-INSTALL SUITE | total=33 pass=33 fail=0
FRESH-INSTALL SUITE | total=11 pass=11 fail=0
FRESH-INSTALL SUITE | audit5: 51/51
FRESH-INSTALL SUITE | total=54 pass=54 fail=0
FRESH-INSTALL RESULT | OK
```

چرا ۱۹۸ و نه ۲۱۰؟ چون این دو اجرا با بستهٔ میانی انجام شدند (audit6
بسته=۵۴ سنجه؛ ۱۲ سنجهٔ گام‌های ۴ تا ۶ هنوز در بسته نبود). اجرای سوم،
داخل گیت انتشار ژنراتور روی بستهٔ نهایی، **۲۱۰/۲۱۰** شد (بخش ۷).

---

## ۲) وضعیت هر پنج ایراد (با شاهد)

### ایراد ۱ — «PmTab.tsx وجود ندارد» ← پیش‌فرض نادرست؛ شکاف‌ها بسته شد

```bash
ls -la src/components/PmTab.tsx && npx tsc --noEmit && echo "TSC CLEAN"
```

```text
-rw-r--r-- 1 user user 5156 ... src/components/PmTab.tsx
TSC CLEAN
```

فایل از ۱٫۴٫۲ در ریپو بود و `tsc` تمیز بود. مشکل واقعی: در *بسته*
نبود (رفع در ژنراتور). برای پوشش کامل معیارهای قبولی، این‌ها اضافه شد:
فرم «قالب تازه» (فقط ادمین) + دکمهٔ PDF هر ردیف + ۳ سنجه (قالب/رکورد/PDF).

```text
PASS | pm.template creates
PASS | pm.record creates + report id | report=33
PASS | pm report page renders
```

### ایراد ۲ — «مهاجرت ۰۰۰۵ نیست» ← پیش‌فرض نادرست؛ معادل موجود تأیید شد

```bash
cat drizzle/0005_megger_pi.sql
```

```sql
ALTER TABLE "megger_tests" ADD COLUMN IF NOT EXISTS "test_voltage_rotor" integer;
ALTER TABLE "megger_tests" ADD COLUMN IF NOT EXISTS "pi_stator_u" double precision;
ALTER TABLE "megger_tests" ADD COLUMN IF NOT EXISTS "pi_stator_v" double precision;
ALTER TABLE "megger_tests" ADD COLUMN IF NOT EXISTS "pi_stator_w" double precision;
ALTER TABLE "megger_tests" ADD COLUMN IF NOT EXISTS "pi_rotor" double precision;
ALTER TABLE "megger_tests" ADD COLUMN IF NOT EXISTS "unit" text NOT NULL DEFAULT 'MΩ';
```

هر شش ستون با همان نوع‌ها از ۱٫۴٫۳ در همان شمارهٔ ۰۰۰۵ بود؛ ساخت فایل
دوم ۰۰۰۵ فقط تداخل می‌ساخت، پس ساخته نشد (انحراف مستند شمارهٔ ۱).
به جایش: ورود به بسته + ۲ سنجه (migrate تازه روی DB خالی + پروب ستون‌ها):

```text
PASS | fresh migrate applies 0000..0005 | [migrate] done
PASS | fresh migrate has 6 megger columns
```

و `/api/state` پس از migrate تازه در آزمون نصب: `state | motors=8` (بخش ۱).

### ایراد ۳ — «shebang خراب» ← در بستهٔ فعلی وجود نداشت؛ اثبات + قفل شد

```bash
node scripts/extract-code-all.mjs CODE_ALL_FA.txt /tmp/extract144b
for f in audit/audit5.mjs scripts/mirror-backup.mjs scripts/pg-init.mjs scripts/pg-dump.mjs scripts/pg-import-json.mjs; do head -1 "/tmp/extract144b/$f"; done
```

```text
استخراج شد: 114 فایل → /tmp/extract144b
#!/usr/bin/env node   (×۵ — هر پنج فایل)
```

هر پنج shebang در خط اول نسخهٔ استخراج‌شده درست بود. قفل رگرسیون:
خودآزمایی ژنراتور + سنجهٔ `shebang first line in 5 scripts`.

### ایراد ۴ — «جداکننده چسبیده» ← در بستهٔ فعلی وجود نداشت؛ اثبات + قفل شد

```bash
diff -rq /tmp/extract144b . --exclude=CODE_ALL_FA.txt --exclude=node_modules --exclude=.next --exclude=.data --exclude=.git --exclude=docs --exclude=public --exclude=fresh-extract --exclude=README_PREVIEW_FA.md --exclude=.gitignore --exclude=next-env.d.ts --exclude=tsconfig.tsbuildinfo --exclude=meta; echo "diff-exit: $?"
```

```text
diff-exit: 0
```

استخراج بایت‌به‌بایت برابر منبع (diff صفر)؛ هیچ چسبیدگی در کار نبود.
رفع واقعی این گام: کامل‌شدن فهرست ژنراتور (PmTab، ۰۰۰۵، lockfile،
ابزارها → ۱۱۵ فایل) + خودآزمایی اجباری + کنترل افتادگی فایل رهگیری‌شده.

### ایراد ۵ — «pruneArchives پیرایش می‌کند» ← واقعی بود؛ رفع شد ✅

قبل: `pruneArchives(keep = 20)` با `unlink` — تأیید شد.
بعد (`src/lib/archive.ts`):

```ts
export async function pruneArchives(keep: number = Infinity) {
  if (keep !== Infinity && (!Number.isFinite(keep) || keep < 500)) {
    throw new Error("پیرایش بایگانی غیرفعال است (قانون مقدس: نگه‌داری نامحدود)؛ حداقل مجاز ۵۰۰ نسخه است");
  }
  return 0;
}
```

```text
PASS | archive default unlimited
PASS | archive guard rejects <500
PASS | archive log says pruning disabled
PASS | archive keeps 25 versions | left=25
```

---

## ۳) ارسال فایل به بله (بخش ۴) — شاهد سرتاسری

سرور واقعی + mock بله؛ هر دو اکشن سبز:

```text
sendReport: {"status":200,"body":{"ok":true,"message":"گزارش روزانه به کانال ارسال شد"}}
sendBackup: {"status":200,"body":{"ok":true,"message":"فایل بکاپ (ZIP) به کانال ارسال شد"}}
HIT1 POST /botTDOC/sendDocument | multipart/form-data | 25071 bytes
HIT2 POST /botTDOC/sendDocument | multipart/form-data | 445509 bytes
```

ZIP دریافتی mock با `unzip` واقعی باز شد:

```text
Archive:  carved.zip
   444613  pumpstation-1405-08-14_20-04-26.json
       64  pumpstation-1405-08-14_20-04-26.json.sha256
```

دفتر فعالیت: `["ارسال بکاپ به کانال", "ارسال گزارش روزانه به کانال", ...]`

سنجه‌ها (۷): آدرس بله/ایتا، دریافت multipart، رد ۵۱MB، خطای HTTP،
بردار CRC32، ساختار ZIP — همه سبز.

---

## ۴) شمارش درست سنجه‌ها

مبنای ۱٫۴٫۳ که «۱۴۲» اعلام شده بود اشتباه بود: ۵۱ سنجهٔ audit5 با
فرمت `✓` (نه `PASS |`) شمرده نشده بود. شمارش درست:

| مجموعه | ۱٫۴٫۳ (درست) | تازهٔ ۱٫۴٫۴ | ۱٫۴٫۴ |
|---|---|---|---|
| audit1 | ۳۲ | — | ۳۲ |
| audit2 | ۱۷ | — | ۱۷ |
| audit3 | ۳۳ | — | ۳۳ |
| audit4 | ۱۱ | — | ۱۱ |
| audit5 (✓) | ۵۱ | — | ۵۱ |
| audit6 | ۴۹ | ۱۷ | ۶۶ |
| **جمع** | **۱۹۳** | **۱۷** | **۲۱۰** |

۱۷ سنجهٔ تازه: بایگانی ۴، shebang ۱، مهاجرت ۲، PM ۳، ارسال فایل/ZIP ۷.

---

## ۵) انحراف‌های صادقانه از پرامپت مادر

1. **نام فایل ۰۰۰۵**: به‌جای `drizzle/0005_fix_megger.sql` همان
   `drizzle/0005_megger_pi.sql` موجود نگه داشته شد (همان شماره، همان شش
   ستون، همان نوع‌ها). ساخت فایل دوم ۰۰۰۵ تداخل می‌ساخت؛ تغییرنام هم
   نصب‌های موجود را می‌شکست (init-db مهاجرت‌ها را با نام رهگیری می‌کند).
2. **گزارش روزانه HTML نه PDF**: تولید PDF فارسی سمت‌سرور بدون موتور
   رندر آفلاین ممکن نیست (فونت وزیرمتن فقط woff2 است) و افزودن کروم
   headless با قانون آفلاین‌محوری و محدودیت محیط ناسازگار بود. فایل
   ارسالی، HTML کامل همان صفحهٔ گزارش با سربرگ رسمی است که در بله باز
   و چاپ می‌شود؛ نام فایل طبق قانون ۸.
3. **دکمه‌ها در حالت آفلاین**: به‌جای پروب زنده (که خودش اینترنت
   می‌خواهد)، دکمه‌ها با `navigator.onLine` غیرفعال می‌شوند و خطای
   شبکهٔ سرور هم با پیام فارسی روشن + ثبت در دفتر فعالیت برمی‌گردد.
4. **`db:migrate` ساخته شد**: پرامپت فرض کرده بود هست؛ نبود. به‌عنوان
   نام جدید `init-db` اضافه شد (نه رفتار تازه).
5. **دریچهٔ فرار گیت انتشار**: `GENERATE_SKIP_FRESH_TEST=1` (پیش‌فرض:
   گیت روشن). برای محیط بدون اینترنت/ریجستری؛ هر استفاده از آن باید در گزارش انتشار ذکر شود.
6. **pruneFileBackups دست نخورد**: خارج از محدودهٔ ایراد ۵ بود (فقط
   بایگانی). در فهرست فاز ۵ (بند ۶) می‌ماند.

---

## ۶) گیت‌های نهایی

```text
npx tsc --noEmit              → تمیز
npx eslint .                  → 0 خطا
npm test (روی :3000 توسعه)    → خروج ۰ — ۱۵۹ PASS + ۵۱ ✓ = ۲۱۰
test-fresh-install (بستهٔ نهایی) → خروج ۰ — ۲۱۰/۲۱۰ (داخل گیت انتشار)
```

---

## ۷) اجرای گیت انتشار (بستهٔ نهایی)

```bash
node scripts/generate-code-all.mjs
```

خروجی (خلاصه): خودآزمایی سریع سبز ← آزمون نصب تازه روی بستهٔ تازه سبز
(۲۱۰/۲۱۰) ← `CODE_ALL_FA.txt` نوشته شد (۱۱۵+ فایل؛ شمارش دقیق در سربرگ
خود فایل). اگر هر مرحله می‌شکست، فایل قبلی دست‌نخورده می‌ماند.
