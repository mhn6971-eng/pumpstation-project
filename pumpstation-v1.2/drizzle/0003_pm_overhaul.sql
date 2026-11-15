ALTER TABLE "motor_services" ADD COLUMN IF NOT EXISTS "service_kind" text NOT NULL DEFAULT 'monthly';
--> statement-breakpoint
ALTER TABLE "pm_records" ADD COLUMN IF NOT EXISTS "stage" text NOT NULL DEFAULT '1';
--> statement-breakpoint
INSERT INTO "pm_templates" ("category", "name", "items", "updated_at")
SELECT 'موتورها و الکتروپمپ‌ها', 'چک‌لیست ماهیانه الکتروموتور زمینی', '["نظافت ظاهری بدنه موتور و بادگیری قسمت خارجی آن","کنترل میکروسوئیچ","بازدید جاروبک‌ها و هواگیری","داخل محفظه زغال‌ها","بررسی اتصالات زغال‌ها به باس‌بار","بررسی وضعیت گریس‌کاری بلبرینگ‌های ابتدا و انتهای روتور","ثبت ساعت کارکرد الکتروموتور","بررسی کابل و گلند تخته‌کلیم موتور","بررسی اتصالات ارتینگ روی بدنه موتور و داخل ترمینال‌باکس","بازدید و اندازه‌گیری مقاومت عایقی سیم‌پیچ‌ها","کنترل وضعیت فن خنک‌کننده","بررسی وضعیت درزگیری‌های مانع نفوذ گرد و غبار و درب‌های زغال‌ها","بررسی عملکرد سیستم کنترل و حفاظت (اینترلاک‌ها و رله‌های حفاظتی)","بررسی و کنترل کابل‌های 6KV از لحاظ الکتریکی","بررسی وضعیت رنگ‌ها و اصلاح رنگ روی آن‌ها در صورت نیاز به ترمیم","کنترل وضعیت آغشته‌کاری موتور با سیم","بررسی وضعیت رنگ بدنه موتور و شاسی"]'::jsonb, to_char(now(), 'YYYY/MM/DD HH24:MI:SS')
WHERE EXISTS (SELECT 1 FROM "settings" WHERE "key" = 'seeded')
  AND NOT EXISTS (SELECT 1 FROM "pm_templates" WHERE "name" = 'چک‌لیست ماهیانه الکتروموتور زمینی');
