# پوشهٔ تست و بازبینی (Audit)

این اسکریپت‌ها همان تست‌هایی هستند که در گزارش `docs/AUDIT_v1.2_FA.md` استفاده شد.
هدف: هر بار تغییری در کد دادیم، همین‌ها را دوباره اجرا کنیم و مطمئن شویم چیزی نشکسته.

## پیش‌نیاز
سامانه باید در حال اجرا روی `http://127.0.0.1:3000` باشد و PINهای **آزمایشی** سر جایشان باشند
(A=1011، B=2022، C=3033، ادمین=9009 — از روستر نمونهٔ `data/roster.sample.json`؛
نام و PIN واقعی فقط در `data/roster.local.json` روی دستگاه ایستگاه است و در تست‌ها استفاده نمی‌شود).

> ⚠️ این تست‌ها **دادهٔ نمونه** در دیتابیس می‌نویسند (تاریخ‌های ۱۴۰۵/۰۸/۱۴ به بعد، بک‌آپ، کاتالوگ تستی و…).
> برای تست، همیشه از یک دیتابیس آزمایشی استفاده کنید، نه دیتابیس واقعی ایستگاه.

## اجرا
```bash
npm run preview            # در ترمینال اول

node audit/jalali.test.mjs # تاریخ شمسی (بدون نیاز به سرور؛ باید روی /tmp/jal/ کامپایل شود)
node audit/audit1.mjs      # احراز هویت، مجوزها، تزریق، XSS، نویز
node audit/audit2.mjs      # بک‌آپ/بازیابی، آپلود، هدرها، حجم بدنه، صف ارسال
node audit/audit3.mjs      # اعتبارسنجی ورودی‌ها و گزارش‌ها
node audit/audit4.mjs      # بک‌آپ/بازیابی داخلی و سلامت
node audit/audit5.mjs      # هم‌خوانی تنظیمات و گزارش کامل
node audit/audit6.mjs      # ۱٫۴٫۱: روستر، بایند، نگهبان مسیر، ورود گروهی
node audit/conc.mjs        # نوشتن همزمان و بررسی تکرار رکورد
node audit/perf.mjs        # زمان پاسخ در حجم دادهٔ فعلی
node audit/sess.mjs        # نشست، خروج، تغییر PIN، دو تب
```

برای دادهٔ انبوه (فقط با سرور خاموش، چون دیتابیس تک‌فرآیندی است):
```bash
node audit/bulk.mjs --db /tmp/bulk-test --days 730 --confirm-test   # دادهٔ حجیم TEST (SQL مستقیم)
node scripts/bulk-import.mjs --file rows.csv --shift A --pin 1011 --confirm-test  # ورود واقعی از مسیر API
node audit/db-inspect.mjs .data/pglite   # شمارش و بررسی تکرارها
node audit/probe.mjs               # آزمون سالم‌بودن دیتابیس پس از قطع ناگهانی
```

## تفسیر نتایج
هر خط `PASS`/`FAIL` چاپ می‌شود. در پایان هر اسکریپت خلاصهٔ تعداد قبول/رد می‌آید.
موارد `FAIL` شناخته‌شده تا پیش از اجرای فازهای اصلاحی، همان ایرادهای گزارش هستند و تا زمانی که
برطرف نشوند طبیعی‌اند.

---

## تست‌های نسخه ۱.۳ (تاب‌آوری و نگه‌داری)

```bash
node audit/audit3.mjs   # نشست سروری، ابطال دستگاه، شناسهٔ یکتا، CSRF، ETag، بایگانی، CSV، سطل بازیافت
node audit/audit4.mjs   # بک‌آپ و بازیابی از فایل، سناریوی «ویندوز عوض شد»، تداوم پس از بازیابی
node audit/audit5.mjs   # ورود دوعاملی، آینهٔ بک‌آپ، هدرهای امنیتی، آمادگی HTTPS و PostgreSQL
npm run test:audit      # اجرای هر پنج مجموعه با هم
npm run test            # بررسی نوع‌ها + همهٔ تست‌های بالا
```

### ابزارهای عملیاتی

```bash
npm run doctor                        # بررسی سلامت دیتابیس و شمارش ردیف‌ها
node scripts/doctor.mjs --repair      # قرنطینهٔ دیتابیس خراب و بازیابی از آخرین بک‌آپ
node scripts/doctor.mjs --restore FILE
node scripts/mirror-backup.mjs        # کپی بک‌آپ روی آینه (سامانه روشن؛ برای Task Scheduler)
node scripts/pg-init.mjs              # ساخت اسکیما روی PostgreSQL سروری (DATABASE_URL)
node scripts/pg-dump.mjs              # دامپ فشردهٔ روزانه با pg_dump
node scripts/pg-import-json.mjs       # انتقال دادهٔ بک‌آپ JSON به PostgreSQL
```

> پیش از هر اسکریپت عملیاتی، سامانه را ببندید؛ قفل پوشهٔ داده مانع اجرای هم‌زمان می‌شود.
