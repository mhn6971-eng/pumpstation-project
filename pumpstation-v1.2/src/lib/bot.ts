/**
 * ارسال متن به پیام‌رسان‌های بله / ایتا (هر دو سازگار با API ربات تلگرام).
 * عمداً بدون هیچ وابستگی داخلی است تا هم در سرور (route) و هم در
 * تست‌ها (audit6 با سرور mock محلی) قابل استفاده باشد.
 * متغیرهای محیطی BALE_API_BASE و EITAA_API_BASE فقط برای تست محلی‌اند؛
 * در ایستگاه واقعی همیشه همان پیش‌فرض‌ها (tapi.bale.ai و eitaayar.ir) به کار می‌روند.
 */
export type BotProvider = "bale" | "eitaa";

export function botApiBase(provider: BotProvider): string {
  if (provider === "eitaa") return (process.env.EITAA_API_BASE ?? "https://eitaayar.ir/api").replace(/\/$/, "");
  return (process.env.BALE_API_BASE ?? "https://tapi.bale.ai").replace(/\/$/, "");
}

export function botSendUrl(provider: BotProvider, token: string): string {
  const base = botApiBase(provider);
  return provider === "eitaa" ? `${base}/${token}/sendMessage` : `${base}/bot${token}/sendMessage`;
}

/** سقف حجم فایل ارسالی به بله/ایتا: ۵۰ مگابایت */
export const BOT_FILE_SIZE_LIMIT = 50 * 1024 * 1024;

export function botSendDocumentUrl(provider: BotProvider, token: string): string {
  const base = botApiBase(provider);
  return provider === "eitaa" ? `${base}/${token}/sendDocument` : `${base}/bot${token}/sendDocument`;
}

/**
 * ارسال فایل (سند) با multipart/form-data. کپشن اختیاری حداکثر ۹۰۰ نویسه.
 * فایل بزرگ‌تر از ۵۰ مگابایت با خطای روشن رد می‌شود (بدون تلاش شبکه).
 */
export async function sendBotDocument(opts: {
  provider: BotProvider;
  token: string;
  chatId: string;
  filename: string;
  data: Uint8Array;
  caption?: string;
  timeoutMs?: number;
}): Promise<void> {
  if (opts.data.byteLength > BOT_FILE_SIZE_LIMIT) {
    throw new Error(`حجم فایل (${(opts.data.byteLength / 1048576).toFixed(1)}MB) بیش از سقف ۵۰ مگابایت است؛ ارسال نشد`);
  }
  const form = new FormData();
  form.append("chat_id", opts.chatId);
  form.append("document", new Blob([opts.data as BlobPart], { type: "application/octet-stream" }), opts.filename);
  if (opts.caption) form.append("caption", opts.caption.slice(0, 900));
  const res = await fetch(botSendDocumentUrl(opts.provider, opts.token), {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 15000),
  });
  if (!res.ok) throw new Error(`پاسخ ${res.status}`);
}

export async function sendBotText(opts: {
  provider: BotProvider;
  token: string;
  chatId: string;
  text: string;
  timeoutMs?: number;
}): Promise<void> {
  const res = await fetch(botSendUrl(opts.provider, opts.token), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: opts.chatId, text: opts.text }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 15000),
  });
  if (!res.ok) throw new Error(`پاسخ ${res.status}`);
}
