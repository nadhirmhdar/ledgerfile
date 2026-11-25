import { notFound } from "next/navigation";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import { getRetention, partnerLevel } from "@/server/retention";
import { Fact, PageHeader } from "@/ui/layout";
import { RetentionBody } from "@/ui/retention-view";

export const dynamic = "force-dynamic";

/** Retention: archived files, which are past the firm's own period, and the two-person deletion. Partner-level only (the rule for locking and archiving), read from the database. */
export default async function RetentionPage() {
  const session = await getSession();
  const view = await withFirm(await getDb(), session.firmId, async (tx) => ((await partnerLevel(tx, session)) ? getRetention(tx) : null));
  if (!view) notFound();
  return (
    <div className="py-8 text-ink">
      <PageHeader
        breadcrumb={[{ label: "Firm", href: "/firm" }]}
        title="Retention"
        meta={<Fact label="Firm">{session.firmName}</Fact>}
        subtitle="Archived files that are past the firm's own retention period, and the two-person deletion of them."
      />
      <div className="mt-6">
        <RetentionBody view={view} me={session.userId} />
      </div>
    </div>
  );
}
