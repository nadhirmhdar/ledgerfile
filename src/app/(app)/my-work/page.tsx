import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import { getMyWork } from "@/server/my-work";
import { todayIso } from "@/domain/client-requests";
import { canLock } from "@/domain/signoff";
import { Fact, PageHeader } from "@/ui/layout";
import { MyWorkBody, myWorkSubtitle } from "@/ui/my-work-view";

export const dynamic = "force-dynamic";

/** What waits for the signed-in person across the firm's open engagements, grouped by engagement. Each line goes to the page where the work is done. */
export default async function MyWorkPage() {
  const session = await getSession();
  const groups = await withFirm(await getDb(), session.firmId, (tx) => getMyWork(tx, session, todayIso()));

  return (
    <div className="py-8 text-ink">
      <PageHeader
        title="My work"
        meta={
          <>
            <Fact label="Signed in as">{session.name}</Fact>
            <Fact label="Showing">Open engagements you are assigned to</Fact>
          </>
        }
        subtitle={myWorkSubtitle(groups)}
      />
      <div className="mt-6">
        <MyWorkBody groups={groups} mayAssign={canLock(session.role)} />
      </div>
    </div>
  );
}
