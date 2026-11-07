import { existsSync, readFileSync } from "node:fs";

export type UpdateStatus = {
  phase: "idle" | "staged" | "preparing" | "restarting" | "complete" | "failed";
  message: string;
  version?: string;
  updatedAt?: string;
  logPath?: string;
  stageId?: string;
  fileName?: string;
  sha256?: string;
  sizeBytes?: number;
  entryCount?: number;
};

export function currentAppVersion() {
  // Kept in sync with health route: package.json is the single source of truth.
  return JSON.parse(readFileSync("package.json", "utf8")).version as string;
}

function parseVersion(value: string): number[] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
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

export function readUpdateStatus(): UpdateStatus {
  const statusPath = process.env.PUMPSTATION_UPDATE_STATUS_FILE;
  if (statusPath && existsSync(statusPath)) {
    try {
      const status = JSON.parse(readFileSync(statusPath, "utf8")) as UpdateStatus;
      if (["idle", "staged", "preparing", "restarting", "complete", "failed"].includes(status.phase) && typeof status.message === "string") return status;
    } catch {
      // A partial status write is ignored; the updater log remains the diagnostic source.
    }
  }
  return { phase: "idle", message: "برای به‌روزرسانی، فایل ZIP نسخهٔ جدید را انتخاب کنید" };
}
