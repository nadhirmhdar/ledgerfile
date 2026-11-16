import Link from "next/link";
import { Callout } from "../../../../ui/feedback";

/** The sections in work order. Keys are what pages pass as `current`. */
const GROUPS = [
  { id: "overview", title: "Overview", items: [{ key: "home", label: "Home", path: "" }] },
  {
    id: "setup",
    title: "Set up",
    items: [
      { key: "tb", label: "Trial balance and mapping", path: "/trial-balance" },
      { key: "journals", label: "Journal entries", path: "/journals" },
    ],
  },
  {
    id: "audit",
    title: "Audit",
    items: [
      { key: "audit", label: "Planning", path: "/audit" },
      { key: "confirmations", label: "Confirmations", path: "/audit/confirmations" },
      { key: "requests", label: "Client requests", path: "/requests" },
    ],
  },
  {
    id: "file",
    title: "File",
    items: [
      { key: "papers", label: "Working papers", path: "/papers" },
      { key: "index", label: "Index", path: "/index" },
      { key: "statements", label: "Financial statements", path: "/statements" },
    ],
  },
  { id: "finish", title: "Finish", items: [{ key: "review", label: "Review and sign-off", path: "/review" }] },
] as const;

export type EngagementTab = (typeof GROUPS)[number]["items"][number]["key"];

/**
 * The engagement's navigation: a sidebar in work order on wide screens and a scrolling bar on narrow ones. Each group is a list
 * labelled by its heading. The client and period are in each page's own header, so they are not repeated here; a locked
 * engagement also gets a banner.
 */
export function EngagementNav({ id, current, status }: { id: string; current: EngagementTab; status: string }) {
  const locked = status !== "open";
  return (
    <>
      {locked && (
        <Callout variant="locked" title="This engagement is locked" className="mt-4">
          Changes are refused until a partner unlocks it on the Review and sign-off page.
        </Callout>
      )}
      <div className="mt-4 lg:absolute lg:inset-y-0 lg:left-0 lg:mt-0 lg:w-52 lg:pt-8">
        <div className="lg:sticky lg:top-4">
          <nav aria-label="Engagement sections" className="-mx-4 flex gap-4 overflow-x-auto border-b border-border px-4 lg:mx-0 lg:flex-col lg:gap-5 lg:overflow-visible lg:border-b-0 lg:px-0">
            {GROUPS.map((g) => {
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
                            href={`/engagements/${id}${t.path}`}
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
        </div>
      </div>
    </>
  );
}
