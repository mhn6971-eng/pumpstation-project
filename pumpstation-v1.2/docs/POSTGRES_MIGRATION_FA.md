# مهاجرت از PGlite به PostgreSQL سروری (نسخه ۱.۴)

> **وضعیت:** کد آماده است — با ست کردن `DATABASE_URL` سامانه خودکار به PostgreSQL وصل می‌شود
> (`src/db/index.ts`). مهاجرت **در این محیط توسعه انجام نشده** (سرور PostgreSQL در دسترس نیست)،
> اما مسیر کامل، اسکریپت‌ها و معیارهای پذیرش مشخص است.
>
> اگر دادهٔ واقعی دارید، **قبل از هر کاری** یک بک‌آپ JSON تازه بگیرید و آن را روی فلش هم کپی کنید
> (پنل ادمین → «بک‌آپ کامل» + «آینهٔ بک‌آپ»).

---

## ۱. چرا مهاجرت کنیم؟

| موضوع | PGlite (حالت فعلی) | PostgreSQL سروری |
|---|---|---|
| نصب | بدون نصب، داخل خود اپ | نیاز به نصب سرویس |
| نوشتن هم‌زمان | تک‌نویسنده (قفل فایل) | چند نویسندهٔ واقعی |
| پشتیبان‌گیری | فایل JSON کامل از اپ | `pg_dump` استاندارد + ابزارهای سازمانی |
| بازیابی نقطه‌ای (PITR) | ندارد | با WAL و آرشیو ممکن است |
| مناسب برای | یک دستگاه، یک اپراتور | چند دستگاه هم‌زمان، نگهداری سازمانی |

**تصمیم پیشنهادی:** تا وقتی همهٔ ثبت‌ها از یک دستگاه انجام می‌شود، PGlite کافی و ساده‌تر است.
اگر قرار است هم‌زمان از دفتر و اتاق کنترل ثبت شود (یا IT سازمان پشتیبان‌گیری متمرکز می‌خواهد)،
PostgreSQL را انتخاب کنید.

---

## ۲. پیش‌نیازها

- PostgreSQL ۱۵ یا بالاتر روی همان ماشین یا سرور شبکه.
- کاربر دیتابیس مخصوص اپ (نه `postgres`):
  ```sql
  CREATE ROLE psuser LOGIN PASSWORD 'یک-رمز-قوی-تصادفی';
  CREATE DATABASE pumpstation OWNER psuser ENCODING 'UTF8' LC_COLLATE 'C' TEMPLATE template0;
  ```
  > `LC_COLLATE 'C'` باعث می‌شود مرتب‌سازی متن مستقل از تنظیمات ویندوز باشد.
- در `pg_hba.conf` دسترسی از `127.0.0.1` با `scram-sha-256` مجاز باشد.
- `pg_dump`/`pg_restore` در PATH (پوشهٔ `bin` نصب PostgreSQL).

---

## ۳. مراحل انتقال (بدون از دست دادن داده)

### گام ۱ — بک‌آپ تازه از وضعیت فعلی
```powershell
cd C:\pumpstation\pumpstation-v1.2
# در پنل ادمین «بک‌آپ کامل» را بزنید، یا:
dir .data\backups          # آخرین pumpstation-*.json و .sha256 را بردارید
```
فایل JSON و `.sha256` را روی فلش کپی کنید (یا از دکمهٔ «آینهٔ بک‌آپ» استفاده کنید).

### گام ۲ — ساخت اسکیما روی PostgreSQL
```powershell
$env:DATABASE_URL = "postgresql://psuser:SECRET@127.0.0.1:5432/pumpstation"
node scripts/pg-init.mjs
```
خروجی مورد انتظار: مهاجرت‌های `0000` تا `0006` (از جمله `0006_alerts_open_unique`) و در پایان شمارش جدول‌ها. مهاجرت 0006 یکتایی هشدارهای باز را اعمال می‌کند.

### گام ۳ — انتقال داده
```powershell
node scripts/pg-import-json.mjs --file .data\backups\pumpstation-....json
```
اسکریپت: هش فایل را بررسی می‌کند، همه‌چیز را در **یک تراکنش** می‌نویسد، ستون‌های ناشناخته را
گزارش می‌دهد و شمارنده‌های `id` را هم‌تراز می‌کند. اگر مقصد داده داشت، بدون `--replace` متوقف می‌شود.

> **راه جایگزین (تأییدشده‌تر):** اپ را با همان `DATABASE_URL` بالا بیاورید و از پنل ادمین
> «بازیابی از فایل» را روی همان JSON اجرا کنید. این مسیر همان کد `restoreAll` را استفاده می‌کند
> که در تست‌های بازیابی (audit4) ۱۱/۱۱ سبز است.

### گام ۴ — اجرای اپ روی PostgreSQL
در `.env.local` سرویس اپ:
```
DATABASE_URL=postgresql://psuser:SECRET@127.0.0.1:5432/pumpstation
PG_POOL_MAX=10
COOKIE_SECURE=1
```
سرویس را ری‌استارت کنید. سپس:
- `/api/health` باید `db.ok: true` بدهد؛
- تعداد رکوردهای داشبورد با قبل یکی باشد؛
- یک ثبت آزمایشی (روی تاریخ آزمایشی) انجام و بعد حذف شود.

### گام ۵ — بازگشت (Rollback)
تا زمانی که پوشهٔ `.data/pglite` دست‌نخورده است، حذف `DATABASE_URL` و ری‌استارت = بازگشت کامل
به وضعیت قبل. **پوشهٔ `.data/pglite` را تا یک هفته پس از مهاجرت پاک نکنید.**

---

## ۴. پشتیبان‌گیری روزانه با pg_dump

```powershell
$env:DATABASE_URL = "postgresql://psuser:SECRET@127.0.0.1:5432/pumpstation"
$env:MIRROR_DIR   = "E:\pumpstation-mirror"     # فلش یا درایو بیرونی
node scripts/pg-dump.mjs
```
- خروجی: `.data/pgdump/pumpstation-YYYYMMDD-HHMMSS.dump` (فرمت custom، فشرده ۹).
- همهٔ دامپ‌ها نگه‌داری می‌شوند؛ پاک‌سازی خودکار وجود ندارد. حذف نسخه فقط دستی و پس از بررسی کپی سالم مجاز است.
- اگر `MIRROR_DIR` ست باشد، نسخهٔ تازه همان‌جا هم کپی می‌شود.
- اگر `pg_dump` در PATH نبود: `set PGDUMP_BIN=C:\Program Files\PostgreSQL\16\bin\pg_dump.exe`.

### ثبت در Task Scheduler (هر شب ۲:۳۰)
```powershell
schtasks /Create /TN "Pumpstation pg_dump" /SC DAILY /ST 02:30 /RU SYSTEM ^
  /TR "cmd /c cd /d C:\pumpstation\pumpstation-v1.2 && set DATABASE_URL=postgresql://psuser:SECRET@127.0.0.1:5432/pumpstation && set MIRROR_DIR=E:\pumpstation-mirror && node scripts\pg-dump.mjs >> .data\logs\pgdump.log 2>&1"
```
> رمز دیتابیس داخل دستور Task Scheduler ذخیره می‌شود؛ دسترسی به این Task را محدود کنید یا از
> فایل `pgpass.conf` با `PGPASSFILE` استفاده کنید.

### بازیابی از دامپ
```powershell
# بررسی محتوای دامپ بدون بازیابی
pg_restore --list .data\pgdump\pumpstation-20261104-023000.dump

# بازیابی کامل روی دیتابیس خالی
createdb -h 127.0.0.1 -U psuser pumpstation_restore
pg_restore --no-owner --no-privileges -h 127.0.0.1 -U psuser -d pumpstation_restore .data\pgdump\....dump
```
سپس `DATABASE_URL` را موقتاً به `pumpstation_restore` تغییر دهید و صحت داده را بررسی کنید؛
در صورت تأیید، نام دیتابیس‌ها جابه‌جا می‌شود.

---

## ۵. سنجه‌های پذیرش مهاجرت

- [ ] `pg-init` روی دیتابیس خالی کامل و بدون خطا تمام می‌شود.
- [ ] `pg-import-json` با `--file` بک‌آپ تازه، هش را تأیید و همهٔ ردیف‌ها را منتقل می‌کند.
- [ ] شمارش رکوردها (موتور، فرآیندی، توتال، سرویس، هشدار) با قبل یکی است.
- [ ] `/api/state` و نمودار ۱ ساله بدون خطا می‌آیند و سرعت بهتر یا برابر است.
- [ ] ثبت آزمایشی، دو تب هم‌زمان، و ثبت آفلاین (صف) کار می‌کند.
- [ ] `pg_dump` شبانه اجرا و فایل روی آینه دیده می‌شود.
- [ ] بازیابی از دامپ روی دیتابیس آزمایشی و مقایسهٔ شمارش‌ها انجام شده است.
- [ ] پوشهٔ `.data/pglite` هنوز به‌عنوان نسخهٔ پشتیبان نگه داشته شده است.

---

## ۶. مشکلات رایج

| نشانه | علت | راه‌حل |
|---|---|---|
| `password authentication failed` | کاربر/رمز یا `pg_hba` | همان `DATABASE_URL` را با `psql` امتحان کنید |
| `relation "motor_readings_all" does not exist` | مهاجرت ناقص | `node scripts/pg-init.mjs` را کامل اجرا کنید |
| `duplicate key value violates unique constraint` در import | داده در مقصد بوده | با `--replace` یا روی مقصد خالی اجرا کنید |
| اپ بالا نمی‌آید و `db.ok:false` | رمز در `.env.local` قدیمی | `DATABASE_URL` را بازبینی و سرویس را ری‌استارت کنید |
| `pg_dump: command not found` | PATH ندارد | `PGDUMP_BIN` را ست کنید |
| کندی بعد از مهاجرت | ایندکس‌ها/آمار | `ANALYZE;` روی دیتابیس اجرا شود |
