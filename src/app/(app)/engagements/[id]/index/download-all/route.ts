import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import { fileExportEntries, planExport } from "@/server/file-export";
import { zipStream } from "@/server/zip";

export const dynamic = "force-dynamic";
/**
 * 300 seconds is the default and the maximum on Vercel's Hobby plan, and within Pro and Enterprise, with fluid compute (on by default):
 * https://vercel.com/docs/functions/limitations (last updated 2026-08-24, read 2026-11-26). The limit includes the time spent sending a streamed response.
 */
export const maxDuration = 300;

/**
 * Download the whole engagement file as one zip, streamed: partners and administrators only (role read again from the database), anyone else gets 404.
 * Allowed on open, locked and archived engagements, since an inspection usually happens after the lock. `?section=` takes one index section; a
 * whole file over the cap is refused here, before a byte is sent.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });

  const section = new URL(request.url).searchParams.get("section") || null;
  const result = await withFirm(await getDb(), session.firmId, (tx) => planExport(tx, session, id, section));
  if (result.kind === "not_found") return new Response("Not found", { status: 404 });
  if (result.kind === "too_large") return new Response(result.message, { status: 413, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  return new Response(zipStream(fileExportEntries(session, result.plan)), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${result.plan.fileName}"`, "Cache-Control": "no-store" },
  });
}
