import { existsSync, readFileSync } from "node:fs";

export type UpdateManifest = {
  version: string;
  archiveUrl: string;
  sha256: string;
  notes: string[];
  publishedAt: string;
};

export type UpdateStatus = {
  phase: "idle" | "preparing" | "restarting" | "complete" | "failed";
  message: string;
  version?: string;
  updatedAt?: string;
  logPath?: string;
};

export const DEFAULT_UPDATE_FEED =
  "https://raw.githubusercontent.com/mhn6971-eng/pumpstation-project/arena/9a0919c6-pumpstation-project/updates/latest.json";

export function currentAppVersion() {
  // Kept in sync with health route: package.json is the single source of truth.
  return JSON.parse(readFileSync("package.json", "utf8")).version as string;
}

function parseVersion(value: string): number[] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/.exec(value);
  return match ? match.slice(1, 4).map(Number) : null;
}

export function isNewerVersion(candidate: string, current: string) {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

function trustedFeedUrl() {
  const raw = (process.env.PUMPSTATION_UPDATE_FEED ?? DEFAULT_UPDATE_FEED).trim();
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.hostname !== "raw.githubusercontent.com" || !url.pathname.startsWith("/mhn6971-eng/pumpstation-project/")) {
    throw new Error("نشانی منبع به‌روزرسانی مورد اعتماد نیست");
  }
  return url;
}

export async function fetchUpdateManifest(): Promise<UpdateManifest> {
  const feed = trustedFeedUrl();
  const response = await fetch(feed, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`دریافت فهرست نسخه‌ها ناموفق بود (HTTP ${response.status})`);
  const raw = await response.json() as Record<string, unknown>;
  const version = typeof raw.version === "string" ? raw.version : "";
  const archiveUrl = typeof raw.archiveUrl === "string" ? raw.archiveUrl : "";
  const sha256 = typeof raw.sha256 === "string" ? raw.sha256.toLowerCase() : "";
  const notes = Array.isArray(raw.notes) ? raw.notes.filter((x): x is string => typeof x === "string").slice(0, 8).map((x) => x.slice(0, 240)) : [];
  const publishedAt = typeof raw.publishedAt === "string" ? raw.publishedAt.slice(0, 40) : "";
  const archive = new URL(archiveUrl);
  const trustedArchivePrefix = feed.pathname.slice(0, feed.pathname.lastIndexOf("/") + 1);
  if (!parseVersion(version) || archive.protocol !== "https:" || archive.hostname !== feed.hostname || !archive.pathname.startsWith(trustedArchivePrefix) || !/^\/[A-Za-z0-9._/-]+$/.test(archive.pathname) || !/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error("فهرست به‌روزرسانی ساختار معتبر یا منبع قابل اعتماد ندارد");
  }
  return { version, archiveUrl: archive.toString(), sha256, notes, publishedAt };
}

export function readUpdateStatus(): UpdateStatus {
  const statusPath = process.env.PUMPSTATION_UPDATE_STATUS_FILE;
  if (statusPath && existsSync(statusPath)) {
    try {
      const status = JSON.parse(readFileSync(statusPath, "utf8")) as UpdateStatus;
      if (["idle", "preparing", "restarting", "complete", "failed"].includes(status.phase) && typeof status.message === "string") return status;
    } catch {
      // A partial status write is ignored; the updater log remains the diagnostic source.
    }
  }
  return { phase: "idle", message: "آمادهٔ بررسی نسخهٔ جدید" };
}
