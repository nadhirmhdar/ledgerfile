import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import { canSeeAuditLog, checkFilters, exportLog } from "@/server/audit-log";
import { parseFilters } from "@/domain/audit-log";

export const dynamic = "force-dynamic";

/** Download the log for the current filters as Excel or CSV. Partners and administrators only (read again from the database); anyone else gets 404. */
export async function GET(request: Request) {
  const session = await getSession();
  const query = Object.fromEntries(new URL(request.url).searchParams);
  const format = query.format === "csv" ? "csv" : query.format === "xlsx" ? "xlsx" : null;
  if (!format) return new Response("Choose xlsx or csv.", { status: 400 });
  const parsed = parseFilters(query);

  const result = await withFirm(await getDb(), session.firmId, async (tx) => {
    if (!(await canSeeAuditLog(tx, session))) return null;
    const checked = await checkFilters(tx, parsed.filters);
    return exportLog(tx, session, checked.filters, format);
  });
  if (!result) return new Response("Not found", { status: 404 });
  if (!result.ok) return new Response(result.message, { status: 413, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const body = typeof result.body === "string" ? result.body : new Uint8Array(result.body);
  return new Response(body, {
    headers: { "Content-Type": result.contentType, "Content-Disposition": `attachment; filename="${result.fileName}"`, "Cache-Control": "no-store" },
  });
}
