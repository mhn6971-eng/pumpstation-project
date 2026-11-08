# نقشهٔ سریع کد Pumpstation

این فایل برای پیدا کردن محل تغییر هر تجهیز است؛ برای اصلاح یک مورد، لازم نیست کل پروژه را بخوانید. مسیرها نسبت به پوشهٔ `pumpstation-v1.2` هستند.

## موتور و پمپ‌های اصلی

| چه چیزی را می‌خواهید تغییر دهید؟ | فایل اصلی | محل/راهنما |
|---|---|---|
| اتصال موتور به پمپ و شناسه‌های `M-01` / `P-01` | `src/lib/domain.ts` | آرایهٔ `MOTORS`؛ ردیف هر تجهیز همین‌جاست. |
| توان و سازندهٔ درج‌شده روی پلاک شماتیک | `src/lib/domain.ts` و `src/components/MotorVisual.tsx` | `MOTOR_POWER_KW` و `MOTOR_BRAND` را در domain عوض کنید؛ جای متن و ظاهر پلاک در `MotorVisual` است. |
| عنوان و خلاصهٔ وضعیت پمپ‌ها در داشبورد | `src/components/Dashboard.tsx` | عنوان پنل، روشن/خاموش/سرویس و شناسه‌هایی که در خلاصه نشان داده می‌شوند. |
| سربرگ هر کارت پمپ و دکمه‌های همان کارت | `src/components/MotorCard.tsx` | نمایش شناسهٔ `P-xx` و ظاهر کارت. |
| شکل SVG موتور و پمپ | `src/components/MotorVisual.tsx` | اجزای تصویر، رنگ‌ها و پلاک؛ این فایل فقط مسئول شماتیک است. |
| فرم جزئیات، دما، جریان و مقادیر موتور | `src/components/MotorDetail.tsx` | رابط ورود و مشاهدهٔ اندازه‌گیری‌ها. |
| پارامترها و گروه‌بندی آن‌ها | `src/lib/domain.ts` | `MOTOR_PARAMS` و `MOTOR_PARAM_GROUPS`. |
| مقدارهای اولیهٔ دیتابیس خالی | `src/db/seed.ts` | دادهٔ آغازین؛ تغییر این فایل دیتابیس‌های از قبل مقداردهی‌شده را بازنویسی نمی‌کند. |
| جدول‌ها و ساختار ذخیره‌سازی | `src/db/schema.ts` و پوشهٔ `drizzle/` | تغییر ساختار ذخیره‌سازی نیازمند migration است؛ برای تغییر متن داشبورد این بخش را دست نزنید. |
| ثبت مقدارها و تغییر وضعیت از API | `src/app/api/actions/route.ts` | شناسهٔ داخلی موتور در درخواست‌ها و دیتابیس همچنان `M-xx` است. |

## قاعدهٔ شناسه‌ها

- در **داشبورد**، موتورهای کوپل‌شده به‌صورت پمپ با شناسهٔ `P-01` تا `P-08` نمایش داده می‌شوند.
- داخل برنامه، API، دیتابیس و سابقهٔ گزارش‌ها شناسهٔ موتور `M-01` تا `M-08` حفظ می‌شود؛ نگاشت هر موتور به پمپ در آرایهٔ `MOTORS` و تابع `pumpTagOf` در `src/lib/domain.ts` است.
- در شماتیک، پلاک بدنه شناسهٔ خود موتور را نشان می‌دهد؛ پلاک پمپ شناسهٔ `P-xx` را. توان و سازنده از ثابت‌های مرکزی `MOTOR_POWER_KW` و `MOTOR_BRAND` می‌آیند.
- بنابراین برای عوض‌کردن شناسهٔ نمایشی داشبورد، از تغییر دیتابیس یا migration شروع نکنید؛ ابتدا `Dashboard.tsx` و `MotorCard.tsx` را بررسی کنید.

## جست‌وجوی سریع در ترمینال

از پوشهٔ `pumpstation-v1.2` اجرا کنید:

```sh
rg -n "MOTORS|MOTOR_POWER_KW|MOTOR_BRAND|MOTOR_PARAMS|MOTOR_PARAM_GROUPS" src/lib/domain.ts
rg -n "پمپ‌های اصلی|pumpTag|onOpen|onService|onChart" src/components/Dashboard.tsx src/components/MotorCard.tsx
rg -n "پلاک موتور|MOTOR_BRAND|1800" src/components/MotorVisual.tsx src/lib/domain.ts
```

## سایر بخش‌های رابط

- ورود و صفحهٔ اصلی: `src/components/Login.tsx` و `src/components/AppShell.tsx`
- تجهیزات جانبی و فهرست تجهیزات: `src/components/AuxTab.tsx` و `src/components/RegistryTab.tsx`
- آلارم‌ها و مشکلات: `src/components/AlertsTab.tsx` و `src/components/ProblemsTab.tsx`
- گزارش‌ها: `src/components/ReportsHub.tsx`, `src/components/ReportsTab.tsx` و `src/app/report/[id]/page.tsx`
- پنل مدیریت: `src/components/AdminTab.tsx`
- رنگ‌ها و چیدمان سراسری: `src/app/globals.css`
- آزمون‌های خودکار: `audit/`؛ دستور کامل پروژه `npm test` است.
