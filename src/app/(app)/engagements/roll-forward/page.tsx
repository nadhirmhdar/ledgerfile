import { notFound } from "next/navigation";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import { listRollForward, mayRollForward } from "@/server/rollforward";
import { MAX_ROLL_FORWARD } from "@/domain/bulk-rollforward";
import { RollForwardForm } from "@/app/rollforward-form";
import { EmptyState } from "@/ui/feedback";
import { PageHeader } from "@/ui/layout";

export const dynamic = "force-dynamic";

/** Next year's engagements for many clients at once. Only someone who may create an engagement (read again from the database) sees it. */
export default async function RollForwardPage() {
  const session = await getSession();
  const rows = await withFirm(await getDb(), session.firmId, async (tx) => ((await mayRollForward(tx, session)) ? listRollForward(tx, session.firmId) : null));
  if (!rows) notFound();
  const available = rows.filter((r) => !r.rolledForward).length;

  return (
    <div className="py-8 text-ink">
      <PageHeader
        breadcrumb={[{ label: "All engagements", href: "/" }]}
        title="Roll forward to next year"
        subtitle={
          rows.length === 0
            ? "No client has an engagement to roll forward yet."
            : `${available} of ${rows.length} clients can be rolled forward. Each new engagement links to last year's file and keeps its audit setting; nothing else is copied. At most ${MAX_ROLL_FORWARD} at a time.`
        }
      />
      <div className="mt-6">
        {rows.length === 0 ? <EmptyState title="Nothing to roll forward" description="Create an engagement for a client first." /> : <RollForwardForm rows={rows} />}
      </div>
    </div>
  );
}
