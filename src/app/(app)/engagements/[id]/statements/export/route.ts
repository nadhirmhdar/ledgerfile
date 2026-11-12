import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import * as repo from "@/server/repo";
import { buildStatementPack } from "@/domain/statement-pack";
import { buildStatementsDocx } from "@/server/statements-docx";

export const dynamic = "force-dynamic";

/** Download the financial statements as a Word document. Requires a signed-in user of the engagement's firm. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });

  const { engagement, accounts } = await withFirm(await getDb(), session.firmId, async (tx) => {
    const engagement = await repo.getEngagement(tx, id);
    const accounts = engagement ? await repo.listAccounts(tx, id) : [];
    if (engagement) await repo.audit(tx, session, "export", "financial_statements", id);
    return { engagement, accounts };
  });
  if (!engagement || accounts.length === 0) return new Response("Not found", { status: 404 });

  const whole = new URL(request.url).searchParams.get("units") === "whole";
  const pack = buildStatementPack(
    accounts.map((a) => ({ ...a, closingMinor: a.closingMinor + a.adjustmentMinor })),
    { unitMinor: whole ? 100 : 1 },
  );
  const buffer = await buildStatementsDocx({
    clientName: engagement.clientName,
    periodStart: engagement.periodStart,
    periodEnd: engagement.periodEnd,
    pack,
    draft: !pack.clean || engagement.status !== "locked",
  });

  // Only plain characters in the file name, so the header cannot be broken by a client's name.
  const safeName = engagement.clientName.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "client";
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${safeName}-financial-statements-${engagement.periodEnd}.docx"`,
      "Cache-Control": "no-store",
    },
  });
}
