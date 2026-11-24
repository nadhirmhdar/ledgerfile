import { cookies } from "next/headers";
import { Callout } from "../../../../ui/feedback";
import { NAV_COOKIE, openGroups, type EngagementTab } from "../../../../ui/engagement-nav";
import { EngagementSections } from "./sections";

export type { EngagementTab };

/**
 * The engagement's navigation: a sidebar in work order on wide screens, whose groups open and close, and a scrolling bar on narrow ones. The open
 * groups are remembered in a cookie that is read here, so the first render already matches what the user chose (no flicker, no hydration mismatch).
 * The client and period are in each page's own header, so they are not repeated here; a locked engagement also gets a banner.
 */
export async function EngagementNav({ id, current, status, archived = false }: { id: string; current: EngagementTab; status: string; archived?: boolean }) {
  const locked = status !== "open";
  const initialOpen = openGroups(current, (await cookies()).get(NAV_COOKIE)?.value);
  return (
    <>
      {locked && (
        <Callout variant="locked" title={archived ? "This engagement is archived" : "This engagement is locked"} className="mt-4">
          {archived ? "Nothing on it can be changed or unlocked, ever. You can still open it, download and export from it." : "Changes are refused until a partner unlocks it on the Review and sign-off page."}
        </Callout>
      )}
      <div className="mt-4 lg:absolute lg:inset-y-0 lg:left-0 lg:mt-0 lg:w-52 lg:pt-8">
        <div className="lg:sticky lg:top-4">
          <EngagementSections key={current} id={id} current={current} initialOpen={initialOpen} />
        </div>
      </div>
    </>
  );
}
