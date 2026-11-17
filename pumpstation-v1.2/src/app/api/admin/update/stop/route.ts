export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Internal hand-off only. The single-use token is created in the admin update request. */
function authorized(request: Request) {
  const expected = process.env.PUMPSTATION_UPDATE_STOP_TOKEN;
  const supplied = request.headers.get("x-pumpstation-update-token");
  return Boolean(expected && supplied && supplied === expected);
}

export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ ok: false, error: "درخواست داخلی نامعتبر است" }, { status: 403 });
  const response = Response.json({ ok: true, stopping: true });
  // Let the HTTP response flush, then ask Next.js to shut down so open DB handles can close.
  setTimeout(() => process.kill(process.pid, "SIGTERM"), 700).unref();
  return response;
}

/** Clear the single-use hand-off secret after the candidate passes health-check. */
export async function DELETE(request: Request) {
  if (!authorized(request)) return Response.json({ ok: false, error: "درخواست داخلی نامعتبر است" }, { status: 403 });
  delete process.env.PUMPSTATION_UPDATE_STOP_TOKEN;
  return Response.json({ ok: true, cleared: true });
}
