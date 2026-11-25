import Link from "next/link";
import { dueWords, groupTotal, LINE_KIND_LABEL, type LineKind, type WorkGroup } from "@/domain/my-work";
import { Badge } from "./badge";
import { LinkButton } from "./button";
import { EmptyState } from "./feedback";
import { ListRow, ListRows } from "./layout";
import { count } from "./text";

const KIND_TONE: Record<LineKind, "info" | "neutral" | "warning" | "danger"> = { prepare: "info", review: "neutral", yours: "neutral", due: "warning" };

/** The sentence under the title. */
export const myWorkSubtitle = (groups: WorkGroup[]): string =>
  groups.length === 0 ? "Nothing waits for you." : `${count(groups.reduce((n, g) => n + groupTotal(g), 0), "thing")} waiting on ${count(groups.length, "engagement")}.`;

/**
 * The groups of work, one block per engagement, or the empty state. Every state is in words: a late report says "Overdue by 3 days" and an item's
 * kind is a label, so the colour only adds to what is written.
 */
export function MyWorkBody({ groups, mayAssign }: { groups: WorkGroup[]; mayAssign: boolean }) {
  if (groups.length === 0) {
    return (
      <EmptyState
        title="Nothing waits for you"
        description="Engagements you are assigned to will show their open work here."
        action={
          mayAssign ? (
            <LinkButton href="/" variant="secondary">
              Go to the engagements to assign people
            </LinkButton>
          ) : undefined
        }
      />
    );
  }
  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <section key={g.engagementId} aria-labelledby={`g-${g.engagementId}`}>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <div className="min-w-0">
              <h2 id={`g-${g.engagementId}`} className="text-lg font-semibold text-ink">
                <Link href={`/engagements/${g.engagementId}`} className="rounded-sm hover:text-accent hover:underline">
                  {g.clientName}
                </Link>
              </h2>
              <p className="text-sm text-ink-muted">
                Period ending {g.periodEnd}
                {g.roles.length > 0 && <> · You are {g.roles.join(" and ").toLowerCase()}</>}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
              {g.reportDueOn && <Badge tone={g.due.kind === "overdue" ? "danger" : g.due.kind === "soon" ? "warning" : "neutral"}>{dueWords(g.due)}</Badge>}
              <span>{count(groupTotal(g), "thing")}</span>
            </div>
          </div>
          <ListRows>
            {g.lines.map((l) => (
              <ListRow key={l.key} title={l.label} href={l.href} meta={<Badge tone={l.kind === "due" && g.due.kind === "overdue" ? "danger" : KIND_TONE[l.kind]}>{LINE_KIND_LABEL[l.kind]}</Badge>} inlineMeta />
            ))}
          </ListRows>
        </section>
      ))}
    </div>
  );
}
