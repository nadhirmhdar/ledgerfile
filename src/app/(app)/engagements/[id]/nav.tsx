import Link from "next/link";
import { Callout } from "../../../../ui/feedback";
import { NAV_GROUPS, sectionHref, type EngagementTab } from "../../../../ui/engagement-nav";
import { StripScroll } from "../../../../ui/strip-scroll";

export type { EngagementTab };

/**
 * The engagement's navigation: a sidebar in work order on wide screens and a scrolling bar on narrow ones. Each group is a list
 * labelled by its heading. The client and period are in each page's own header, so they are not repeated here; a locked
 * engagement also gets a banner.
 */
export function EngagementNav({ id, current, status, archived = false }: { id: string; current: EngagementTab; status: string; archived?: boolean }) {
  const locked = status !== "open";
  return (
    <>
      {locked && (
        <Callout variant="locked" title={archived ? "This engagement is archived" : "This engagement is locked"} className="mt-4">
          {archived ? "Nothing on it can be changed or unlocked, ever. You can still open it, download and export from it." : "Changes are refused until a partner unlocks it on the Review and sign-off page."}
        </Callout>
      )}
      <div className="mt-4 lg:absolute lg:inset-y-0 lg:left-0 lg:mt-0 lg:w-52 lg:pt-8">
        <div className="lg:sticky lg:top-4">
          <nav id="engagement-sections" aria-label="Engagement sections" className="-mx-4 flex gap-4 overflow-x-auto border-b border-border px-4 lg:mx-0 lg:flex-col lg:gap-5 lg:overflow-visible lg:border-b-0 lg:px-0">
            {NAV_GROUPS.map((g) => {
              const heading = `nav-group-${g.id}`;
              return (
                <div key={g.id} className="shrink-0">
                  <h2 id={heading} className="hidden px-3 pb-1 text-xs font-medium text-ink-subtle lg:block">
                    {g.title}
                  </h2>
                  <ul aria-labelledby={heading} className="flex items-center gap-1 lg:flex-col lg:items-stretch lg:gap-0.5">
                    {g.items.map((t) => {
                      const active = t.key === current;
                      return (
                        <li key={t.key}>
                          <Link
                            href={sectionHref(id, t.path)}
                            aria-current={active ? "page" : undefined}
                            className={`inline-flex min-h-10 w-full items-center border-b-2 px-3 text-sm whitespace-nowrap lg:rounded-md lg:border-b-0 lg:border-l-2 ${
                              active
                                ? "border-accent font-semibold text-ink lg:bg-accent-soft"
                                : "border-transparent font-medium text-ink-muted hover:text-ink lg:hover:bg-surface-muted"
                            }`}
                          >
                            {t.label}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </nav>
          <StripScroll navId="engagement-sections" />
        </div>
      </div>
    </>
  );
}
