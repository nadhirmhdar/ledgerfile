import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import { pastRetentionSince } from "@/server/retention";
import { pastRetentionLine } from "@/domain/retention";

/**
 * Room on the left for the engagement sidebar on wide screens. Each page draws EngagementNav itself, and the nav takes its place
 * in this column; on small screens it flows with the page as a scrolling bar.
 *
 * An archived file that is past the firm's own retention period says so, calmly, on every page of the engagement. There is no action here:
 * deleting is done from the Retention page, by two partner-level people.
 */
export default async function EngagementLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  let since: string | null = null;
  if (/^[0-9a-f-]{36}$/i.test(id)) {
    const session = await getSession();
    since = await withFirm(await getDb(), session.firmId, (tx) => pastRetentionSince(tx, id));
  }
  return (
    <div className="relative lg:pl-60">
      {since && <p className="pt-4 text-sm text-ink-muted">{pastRetentionLine(since)}</p>}
      {children}
    </div>
  );
}
