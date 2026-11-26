import { notFound } from "next/navigation";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import { canSeeAuditLog, checkFilters, countLog, filterChoices, getLogPage } from "@/server/audit-log";
import { parseFilters } from "@/domain/audit-log";
import { Fact, PageHeader } from "@/ui/layout";
import { AuditLogView } from "@/ui/audit-log-view";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;

/** The firm's audit log, for partners and administrators: the role is read again from the database, and anyone else is told the page does not exist. */
export default async function AuditLogPage({ searchParams }: { searchParams: Promise<Params> }) {
  const session = await getSession();
  const raw = await searchParams;
  const parsed = parseFilters(raw);
  const data = await withFirm(await getDb(), session.firmId, async (tx) => {
    if (!(await canSeeAuditLog(tx, session))) return null;
    const checked = await checkFilters(tx, parsed.filters);
    const cursor = raw.older ? { value: raw.older, dir: "older" as const } : raw.newer ? { value: raw.newer, dir: "newer" as const } : null;
    return {
      ...checked,
      page: await getLogPage(tx, session, checked.filters, cursor),
      total: await countLog(tx, session, checked.filters),
      choices: await filterChoices(tx, session),
    };
  });
  if (!data) notFound();

  return (
    <div className="py-8 text-ink">
      <PageHeader
        breadcrumb={[{ label: "Firm", href: "/firm" }]}
        title="Audit log"
        meta={<Fact label="Firm">{session.firmName}</Fact>}
        subtitle="Every change made in the firm, who made it and when. Entries cannot be edited or deleted."
      />
      <div className="mt-6">
        <AuditLogView page={data.page} filters={data.filters} problems={[...parsed.problems, ...data.problems]} choices={data.choices} total={data.total} />
      </div>
    </div>
  );
}
