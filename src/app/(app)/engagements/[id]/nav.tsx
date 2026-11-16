import Link from "next/link";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import * as repo from "@/server/repo";
import { StatusBadge } from "@/ui/badge";
import { Callout } from "@/ui/feedback";

/** The sections in work order. Keys are what pages pass as `current`. */
const GROUPS = [
  { title: "Overview", items: [{ key: "home", label: "Home", path: "" }] },
  {
    title: "Set up",
    items: [
      { key: "tb", label: "Trial balance and mapping", path: "/trial-balance" },
      { key: "journals", label: "Journal entries", path: "/journals" },
    ],
  },
  {
    title: "Audit",
    items: [
      { key: "audit", label: "Planning", path: "/audit" },
      { key: "confirmations", label: "Confirmations", path: "/audit/confirmations" },
      { key: "requests", label: "Client requests", path: "/requests" },
    ],
  },
  {
    title: "File",
    items: [
      { key: "papers", label: "Working papers", path: "/papers" },
      { key: "index", label: "Index", path: "/index" },
      { key: "statements", label: "Financial statements", path: "/statements" },
    ],
  },
  { title: "Finish", items: [{ key: "review", label: "Review and sign-off", path: "/review" }] },
] as const;

export type EngagementTab = (typeof GROUPS)[number]["items"][number]["key"];

/**
 * The engagement's navigation: a sidebar in work order on wide screens and a scrolling bar on narrow ones, with the client, the
 * period and whether the engagement is open or locked. A locked engagement also gets a banner.
 */
export async function EngagementNav({ id, current, status }: { id: string; current: EngagementTab; status: string }) {
  const session = await getSession();
  const engagement = await withFirm(await getDb(), session.firmId, (tx) => repo.getEngagement(tx, id));
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
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
            {engagement && (
              <div className="hidden min-w-0 lg:block">
                <p className="truncate text-sm font-semibold text-ink">{engagement.clientName}</p>
                <p className="text-xs text-ink-muted">
                  {engagement.periodStart} to {engagement.periodEnd}
                </p>
              </div>
            )}
            <StatusBadge status={locked ? "locked" : "in_progress"} label={locked ? "Locked" : "Open"} />
          </div>
          <nav aria-label="Engagement sections" className="-mx-4 flex gap-4 overflow-x-auto border-b border-border px-4 lg:mx-0 lg:flex-col lg:gap-5 lg:overflow-visible lg:border-b-0 lg:px-0">
            {GROUPS.map((g) => (
              <div key={g.title} className="flex shrink-0 items-center gap-1 lg:flex-col lg:items-stretch lg:gap-0.5">
                <p className="hidden px-3 pb-1 text-sm font-semibold text-ink-muted lg:block">{g.title}</p>
                {g.items.map((t) => {
                  const active = t.key === current;
                  return (
                    <Link
                      key={t.key}
                      href={`/engagements/${id}${t.path}`}
                      aria-current={active ? "page" : undefined}
                      className={`inline-flex min-h-10 items-center border-b-2 px-3 text-sm whitespace-nowrap lg:rounded-md lg:border-b-0 lg:border-l-2 ${
                        active
                          ? "border-accent font-semibold text-ink lg:bg-accent-soft"
                          : "border-transparent font-medium text-ink-muted hover:text-ink lg:hover:bg-surface-muted"
                      }`}
                    >
                      {t.label}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
        </div>
      </div>
    </>
  );
}
