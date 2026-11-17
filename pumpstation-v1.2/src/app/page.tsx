import { asc } from "drizzle-orm";
import { db } from "@/db";
import { shifts } from "@/db/schema";
import { ensureSeed } from "@/db/seed";
import { getSessionUser } from "@/lib/auth";
import { buildState } from "@/lib/state";
import { operationalDay } from "@/lib/jalali";
import Login from "@/components/Login";
import AppShell from "@/components/AppShell";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  await ensureSeed();
  const user = await getSessionUser();
  const op = operationalDay();

  if (!user) {
    const roster = await db
      .select({ key: shifts.key, label: shifts.label, members: shifts.members, role: shifts.role })
      .from(shifts)
      .orderBy(asc(shifts.key));
    const ordered = ["A", "B", "C", "admin"]
      .map((key) => roster.find((r) => r.key === key))
      .filter((r): r is NonNullable<typeof r> => Boolean(r));
    return <Login roster={ordered} weekday={op.weekday} day={op.day} />;
  }

  const initial = await buildState({ who: user });
  return <AppShell initial={initial} />;
}
