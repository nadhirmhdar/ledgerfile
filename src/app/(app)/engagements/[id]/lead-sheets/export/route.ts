import { getDb, withFirm } from "@/server/db";
import { getOptionalSession } from "@/server/session";
import { exportLeadSheets } from "@/server/leadsheet-export";
import { XLSX_TYPE } from "@/server/schedule-export";

export const dynamic = "force-dynamic";

/** Download the lead sheets as an Excel workbook. Requires a signed-in user of the engagement's firm; a signed-out request, another firm's engagement and an engagement with no trial balance are all simply not found. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getOptionalSession();
  if (!session) return new Response("Not found", { status: 404 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });

  const file = await withFirm(await getDb(), session.firmId, (tx) => exportLeadSheets(tx, session, id));
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(file.buffer), {
    headers: { "Content-Type": XLSX_TYPE, "Content-Disposition": `attachment; filename="${file.fileName}"`, "Cache-Control": "no-store" },
  });
}
