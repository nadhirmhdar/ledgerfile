import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import { fileExportEntries, planExport } from "@/server/file-export";
import { zipStream } from "@/server/zip";

export const dynamic = "force-dynamic";

/**
 * Download the whole engagement file as one zip, streamed: partners and administrators only (role read again from the database), anyone else gets 404.
 * Allowed on open, locked and archived engagements, since an inspection usually happens after the lock.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });

  const result = await withFirm(await getDb(), session.firmId, (tx) => planExport(tx, session, id));
  if (result.kind === "not_found") return new Response("Not found", { status: 404 });
  if (result.kind === "too_large") return new Response(result.message, { status: 413, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  return new Response(zipStream(fileExportEntries(session, result.plan)), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${result.plan.fileName}"`, "Cache-Control": "no-store" },
  });
}
