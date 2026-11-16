import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import { exportConfirmations } from "@/server/confirmation-export";
import { XLSX_TYPE } from "@/server/schedule-export";

export const dynamic = "force-dynamic";

/** Download the confirmations as an Excel workbook. Requires a signed-in user of the engagement's firm, and an engagement being audited. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });

  const file = await withFirm(await getDb(), session.firmId, (tx) => exportConfirmations(tx, session, id));
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(file.buffer), {
    headers: { "Content-Type": XLSX_TYPE, "Content-Disposition": `attachment; filename="${file.fileName}"`, "Cache-Control": "no-store" },
  });
}
