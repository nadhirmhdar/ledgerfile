import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import { exportSchedules, XLSX_TYPE } from "@/server/schedule-export";

export const dynamic = "force-dynamic";

/** Download one test schedule as an Excel workbook. Requires a signed-in user of the engagement's firm. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; area: string; scheduleId: string }> }) {
  const session = await getSession();
  const { id, scheduleId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(scheduleId)) return new Response("Not found", { status: 404 });

  const file = await withFirm(await getDb(), session.firmId, (tx) => exportSchedules(tx, session, id, scheduleId));
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(file.buffer), {
    headers: { "Content-Type": XLSX_TYPE, "Content-Disposition": `attachment; filename="${file.fileName}"`, "Cache-Control": "no-store" },
  });
}
