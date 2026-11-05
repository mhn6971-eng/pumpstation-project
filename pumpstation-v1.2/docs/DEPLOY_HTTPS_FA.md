# راه‌اندازی HTTPS برای سامانهٔ ایستگاه پمپاژ گلاب (نسخه ۱.۴)

> **چرا؟** تا نسخهٔ ۱.۳ سامانه روی `http://` سرو می‌شد؛ در این حالت PIN و کوکی نشست
> روی شبکهٔ محلی بدون رمزنگاری رد و بدل می‌شد. هر کسی با دسترسی به سوئیچ/وای‌فای ایستگاه
> می‌توانست آن‌ها را با یک ابزار سادهٔ شنود (Wireshark) بخواند. از ۱.۴ سامانه
> پشت یک پروکسی TLS قرار می‌گیرد و کوکی نشست با پرچم `Secure` صادر می‌شود.

> ⚠️ **در این محیط توسعه HTTPS واقعی راه‌اندازی نشده است.** کد و پیکربندی آماده‌سازی شده و
> در سه سطح بررسی شده است: (۱) پرچم‌های کوکی، (۲) هدرهای امنیتی، (۳) آمادگی برای
> `x-forwarded-proto`. خودِ گواهی و پروکسی روی دستگاه ایستگاه نصب می‌شود.

---

## ۱. انتخاب سناریو

| سناریو | مناسب برای | گواهی |
|---|---|---|
| **الف) شبکهٔ محلی بدون دامنه** (توصیه‌شده) | ایستگاه بدون اینترنت | CA داخلی Caddy یا self-signed |
| ب) آدرس IP ثابت محلی | چند دستگاه در شبکه | self-signed با SAN آدرس IP |
| ج) دامنهٔ عمومی | دسترسی از بیرون (توصیه نمی‌شود) | Let's Encrypt |

دسترسی از اینترنت برای این سامانه **توصیه نمی‌شود**؛ اگر لازم شد، اول VPN/ tunneling
سازمانی را در نظر بگیرید، نه انتشار مستقیم پورت.

---

## ۲. سناریوی الف — Caddy (ساده‌ترین راه)

Caddy گواهی را خودش می‌سازد و تمدید/چرخش را هم خودکار انجام می‌دهد.

1. نصب Caddy (نسخهٔ ویندوزی از `caddyserver.com/download`) و کپی پوشه در `C:\caddy`.
2. فایل [`deploy/Caddyfile`](../deploy/Caddyfile) این مخزن را در `C:\caddy\Caddyfile` بگذارید
   و آدرس‌ها را با IP واقعی ایستگاه جایگزین کنید.
3. اجرا به‌عنوان سرویس:
   ```powershell
   caddy validate --config C:\caddy\Caddyfile
   sc.exe create caddy binPath= "C:\caddy\caddy.exe run --config C:\caddy\Caddyfile --adapter caddyfile" start= auto
   sc.exe start caddy
   ```
4. **نصب ریشهٔ گواهی روی دستگاه‌های اپراتور** (وگرنه مرورگر هشدار می‌دهد):
   فایل `C:\ProgramData\Caddy\pki\authorities\local\root.crt` را در مرورگر
   (Trusted Root Certification Authorities) وارد کنید. با Group Policy می‌توان
   یک‌باره روی همهٔ دستگاه‌های شبکه پخش کرد.
5. در `C:\pumpstation\.env.local` سرور اپ:
   ```
   COOKIE_SECURE=1
   FORCE_HTTPS=1
   TRUST_PROXY=1
   ```
   و سرویس اپ را ری‌استارت کنید (هدر HSTS فقط با این پرچم‌ها فرستاده می‌شود؛
   `TRUST_PROXY=1` یعنی «هدر IP را فقط از همین پروکسیِ خودمان قبول کن» —
   بدون آن، هدرهای IP نادیده گرفته می‌شوند).
6. آزمون:
   ```powershell
   curl.exe -I https://192.168.1.50
   curl.exe -I http://192.168.1.50        # باید ۳۰۱ به https بدهد
   ```
   در مرورگر: قفل سبز/خاکستری، و در DevTools → Application → Cookies پرچم‌های
   `HttpOnly` و `Secure` روی `ps_session` دیده شود.

---

## ۳. سناریوی ب — nginx

1. ساخت گواهی self-signed با SAN (آدرس IP و نام محلی):
   ```powershell
   openssl req -x509 -nodes -days 825 -newkey rsa:2048 `
     -keyout C:\nginx\ssl\pumpstation.key -out C:\nginx\ssl\pumpstation.crt `
     -subj "/CN=pumpstation.local" `
     -addext "subjectAltName=DNS:pumpstation.local,IP:192.168.1.50"
   ```
   یا با `mkcert -install; mkcert pumpstation.local 192.168.1.50`.
2. کپی [`deploy/nginx.conf`](../deploy/nginx.conf) در `C:\nginx\conf\nginx.conf` و
   اصلاح `server_name` و مسیر گواهی.
3. `nginx -t` سپس `nginx -s reload` (یا ثبت به‌عنوان سرویس با `nssm`).
4. همان مرحلهٔ ۵ و ۶ سناریوی قبل (`COOKIE_SECURE=1` + ‏`TRUST_PROXY=1` + آزمون).

> در `nginx.conf` هدر `X-Forwarded-Proto https` ست شده است. سامانه از همین هدر
> برای «secure» کردن کوکی هم استفاده می‌کند؛ ولی `COOKIE_SECURE=1` را هم صریح
> بگذارید تا اگر روزی پروکسی عوض شد، محافظت قطع نشود.

---

## ۴. کارهایی که سامانه از سمت خودش انجام می‌دهد

| مورد | جای پیاده‌سازی | رفتار |
|---|---|---|
| کوکی `Secure` | `src/lib/auth.ts` | با `COOKIE_SECURE=1` یا هدر `x-forwarded-proto: https` |
| کوکی `HttpOnly` + `SameSite=Lax` | همان | از ۱.۲ فعال، بدون تغییر |
| هدر HSTS | `next.config.ts` | فقط با `COOKIE_SECURE=1` یا `FORCE_HTTPS=1` |
| CSP / nosniff / frame-options | `next.config.ts` | از ۱.۲ فعال |
| محدودیت نرخ بر اساس IP واقعی | `src/proxy.ts` | `x-real-ip` یا اولین `x-forwarded-for` — فقط با `TRUST_PROXY=1` |
| توکن CSRF برای درخواست‌های تغییردهنده | `src/proxy.ts` | همان‌طور که بود |

---

## ۵. چک‌لیست پذیرش HTTPS (قبل از تحویل به اپراتور)

- [ ] `https://<آدرس>` بالا می‌آید و گواهی معتبر است (بدون هشدار مرورگر).
- [ ] `http://<آدرس>` با 301 به HTTPS می‌رود.
- [ ] کوکی `ps_session` در DevTools هم `HttpOnly` و هم `Secure` دارد.
- [ ] هدر `Strict-Transport-Security` در پاسخ دیده می‌شود.
- [ ] ورود با PIN و ورود دوعاملی روی HTTPS کار می‌کند.
- [ ] ورود دوعاملی: کد ۶ رقمی پذیرفته می‌شود (ساعت دستگاه و گوشی هم‌زمان).
- [ ] گواهی expiry کمتر از ۱ سال ندارد یا تمدید خودکار تنظیم شده است.
- [ ] تاریخ تمدید گواهی در تقویم نگهداری ثبت شده است.
- [ ] در شبکهٔ محلی، پورت ۳۰۰۰ از بیرون قابل دسترس نیست (فایروال ویندوز:
      فقط ۴۴۳ باز، ۳۰۰۰ روی `127.0.0.1`).

> **نکتهٔ مهم دربارهٔ اتصال مستقیم به ۳۰۰۰:** اگر اپ روی `0.0.0.0:3000` اجرا شود،
> کاربران می‌توانند HTTPS را دور بزنند. پس از نصب پروکسی، سرویس اپ را با
> `-H 127.0.0.1` (یا `HOSTNAME=127.0.0.1`) اجرا کنید و در فایروال هم پورت ۳۰۰۰ را ببندید.

---

## ۶. عیب‌یابی رایج

| نشانه | علت محتمل | راه‌حل |
|---|---|---|
| `ERR_CERT_AUTHORITY_INVALID` | ریشهٔ CA روی دستگاه نصب نشده | نصب `root.crt` (بند ۲-۴) |
| حلقهٔ ریدایرکت بی‌پایان | پروکسی `X-Forwarded-Proto` را ست نمی‌کند | هدر را در Caddy/nginx اضافه کنید |
| ورود انجام می‌شود ولی بلافاصله خارج می‌شویم | کوکی `Secure` روی HTTP ست شده | آدرس را HTTPS کنید یا موقتاً `COOKIE_SECURE=0` |
| ۴۲۹ پشت‌سرهم | محدودیت نرخ با IP پروکسی به‌جای IP کاربر | `x-real-ip` در پروکسی ست شود |
| بارگذاری کاتالوگ ۴۱۳ | سقف بدنهٔ پروکسی | `client_max_body_size 12m` / `max_size 12MB` |
