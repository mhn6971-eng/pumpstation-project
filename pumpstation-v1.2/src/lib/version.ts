import { readFileSync } from "node:fs";
import path from "node:path";

const packageJson = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as { version: string };

/** نسخهٔ سامانه — از یک مرجع واحد (package.json) برای health و تب ادمین خوانده می‌شود */
export const APP_VERSION = process.env.APP_VERSION ?? packageJson.version;
export const APP_NAME = "سامانه پایش ایستگاه پمپاژ زیرزمینی — تونل انتقال آب گلاب";
