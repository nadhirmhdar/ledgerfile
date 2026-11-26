import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import { buildWorkingPaperIndex } from "@/server/wp-index";
import { canLock } from "@/domain/signoff";
import * as repo from "@/server/repo";
import { isIndexFilter, KIND_LABEL, notApplicableNote, STATUS_LABEL, type IndexEntry, type IndexFilter, type Status } from "@/domain/wp-index";
import { Badge, StatusBadge } from "@/ui/badge";
import { buttonClass, Button } from "@/ui/button";
import { ctl, fieldLabel } from "@/ui/controls";
import { Callout, EmptyState } from "@/ui/feedback";
import { chipCounts, indexResults, indexSentence, parseIndexSearch, sectionOpen, sectionSummary, viewIndex } from "@/ui/index-view";
import { PageHeader, Stat, EngagementFacts } from "@/ui/layout";
import type { Status as UiStatus } from "@/ui/status";
import { SummaryChevron, summaryRow } from "@/ui/summary-cue";
import { Table, TCell, THead, TRow } from "@/ui/table";
import { plainCount } from "@/ui/text";
import { EngagementNav } from "../nav";

export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** The index's own statuses in the app's vocabulary. A prepared paper that has a review step is waiting for review. */
function uiStatus(e: IndexEntry): { status: UiStatus; label: string } {
  const label = STATUS_LABEL[e.status as Status];
  switch (e.status) {
    case "prepared":
      return { status: e.reviewable ? "needs_review" : "done", label };
    case "reviewed":
      return { status: "reviewed", label };
    case "in_progress":
      return { status: "in_progress", label };
    case "not_applicable":
      return { status: "not_applicable", label };
    default:
      return { status: "not_started", label };
  }
}

function Who({ name, on }: { name: string | null; on: string | null }) {
  if (!name && !on) return <span className="text-ink-muted">None recorded</span>;
  return (
    <>
      {name ?? <span className="text-ink-muted">Not recorded</span>}
      {on && <div className="text-sm text-ink-muted">{on}</div>}
    </>
  );
}

function Paper({ e }: { e: IndexEntry }) {
  return (
    <>
      {e.kind === "file" ? (
        // A plain link: the route streams the file and logs a download, so it must not be prefetched.
        <a href={e.href} className="font-medium text-accent hover:underline">
          {e.title}
        </a>
      ) : (
        <Link href={e.href} className="font-medium text-accent hover:underline">
          {e.title}
        </Link>
      )}
      <div className="text-sm text-ink-muted">
        {KIND_LABEL[e.kind]}
        {e.note ? `. ${plainCount(e.note)}` : ""}
      </div>
    </>
  );
}

export default async function IndexPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const query = await searchParams;
  const requested = one(query.show);
  const filter: IndexFilter = isIndexFilter(requested) ? requested : "all";
  const q = parseIndexSearch(query.q);

  const session = await getSession();
  const { engagement, index } = await withFirm(await getDb(), session.firmId, async (tx) => ({
    engagement: await repo.getEngagement(tx, id),
    index: await buildWorkingPaperIndex(tx, id),
  }));
  if (!engagement || !index) notFound();

  const view = viewIndex(index, filter, q);
  const chips = chipCounts(index, q);
  const o = index.overall;
  const base = `/engagements/${id}/index`;
  const link = (show: IndexFilter) => {
    const p = new URLSearchParams();
    if (show !== "all") p.set("show", show);
    if (q) p.set("q", q);
    const s = p.toString();
    return `${base}${s ? `?${s}` : ""}`;
  };
  const narrowed = filter !== "all" || q !== "";
  const chipList: { key: IndexFilter; label: string }[] = [
    { key: "all", label: "All papers" },
    { key: "unreviewed", label: "Not yet reviewed" },
    { key: "not_started", label: "Not started" },
  ];

  return (
    <div className="py-8 text-ink">
      <PageHeader
        breadcrumb={[{ label: "All engagements", href: "/" }]}
        title="Working paper index"
        meta={<EngagementFacts client={engagement.clientName} periodStart={engagement.periodStart} periodEnd={engagement.periodEnd} />}
        subtitle={indexSentence(o)}
        actions={
          <div className="flex flex-wrap gap-2">
            <a href={`${base}/export`} className={buttonClass("secondary")}>
              Download index (Excel)
            </a>
            {canLock(session.role) && (
              // A plain link: the route streams the zip and logs the download, so it must not be prefetched. It re-reads the role itself.
              <a href={`${base}/download-all`} className={buttonClass("secondary")}>
                Download the whole file
              </a>
            )}
          </div>
        }
      />
      <EngagementNav id={id} current="index" status={engagement.status} archived={engagement.archivedAt !== null} />

      <div className="mt-6 space-y-8">
        {!index.auditOn && (
          <Callout variant="info" title="The audit is off for this engagement">
            Only the papers that do not depend on it are listed.
          </Callout>
        )}
        <p className="text-sm text-ink-muted">Every paper on the file in file order, with who prepared and reviewed it and where it stands. It is read from the papers themselves, so it is always current.</p>

        <section aria-label="Summary, whole file">
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {(
              [
                ["Papers", o.total],
                ["Reviewed", o.reviewed],
                ["Prepared", o.prepared],
                ["In progress", o.inProgress],
                ["Not started", o.notStarted],
                ["Still to review", o.toReview],
              ] as const
            ).map(([label, value]) => (
              <li key={label}>
                <Stat label={label} value={value} />
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-ink-muted">
            Totals for the whole file, whatever filter is chosen below.
            {notApplicableNote(o.notApplicable) && ` ${notApplicableNote(o.notApplicable)} “Still to review” counts only papers that have a review step.`}
          </p>
        </section>

        {o.total === 0 ? (
          <EmptyState title="No papers yet" description="There are no papers on this file yet. They appear here as the work is recorded." />
        ) : (
          <section>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <nav aria-label="Filter papers">
                <ul className="flex flex-wrap gap-2">
                  {chipList.map((c) => {
                    const active = filter === c.key;
                    return (
                      <li key={c.key}>
                        <Link
                          href={link(c.key)}
                          aria-current={active ? "true" : undefined}
                          className={`inline-flex min-h-10 items-center rounded-full border px-4 text-sm font-medium ${active ? "border-accent bg-accent text-surface" : "border-border-input bg-surface text-ink hover:bg-surface-muted"}`}
                        >
                          {c.label} {chips[c.key]}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </nav>
              <form action={base} method="get" role="search" className="flex w-full flex-wrap items-end gap-2 sm:w-auto">
                {filter !== "all" && <input type="hidden" name="show" value={filter} />}
                <label className={fieldLabel}>
                  Search
                  <input name="q" type="search" defaultValue={q} placeholder="Reference or title" className={`${ctl} w-full sm:w-64`} />
                </label>
                <Button variant="secondary">Search</Button>
              </form>
            </div>
            <p role="status" className="mt-3 text-sm text-ink-muted">
              {indexResults(view.shown, view.total)}
            </p>

            {view.sections.length === 0 ? (
              <div className="mt-3">
                <EmptyState
                  title="No papers match"
                  description="Nothing fits this filter and search."
                  action={
                    <Link href={base} className={buttonClass("secondary")}>
                      Show all
                    </Link>
                  }
                />
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                {view.sections.map((s) => (
                  <details key={s.code} id={`sec-${s.code}`} open={sectionOpen(s.counts, { filter, q })} className="group scroll-mt-4 rounded-lg border border-border bg-surface shadow-card">
                    <summary className={`${summaryRow} font-semibold`}>
                      <SummaryChevron />
                      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1">
                        <span>{s.title}</span>
                        <span className="text-sm font-normal text-ink-muted">{sectionSummary(s.counts, narrowed)}</span>
                        {s.counts.toReview > 0 && <Badge tone="warning">{s.counts.toReview} to review</Badge>}
                      </span>
                    </summary>
                    <div className="border-t border-border">
                      <div className="hidden sm:block">
                        <Table className="rounded-none border-0">
                          <THead>
                            <TRow>
                              <TCell header="col">Reference</TCell>
                              <TCell header="col">Paper</TCell>
                              <TCell header="col">Prepared by</TCell>
                              <TCell header="col">Reviewed by</TCell>
                              <TCell header="col">Status</TCell>
                            </TRow>
                          </THead>
                          <tbody>
                            {s.entries.map((e) => {
                              const st = uiStatus(e);
                              return (
                                <TRow key={`${e.reference ?? ""}|${e.title}|${e.href}`} className="align-top">
                                  <TCell className="whitespace-nowrap tabular-nums">{e.reference ?? <span className="text-ink-muted">None</span>}</TCell>
                                  <TCell>
                                    <Paper e={e} />
                                  </TCell>
                                  <TCell>
                                    <Who name={e.preparedBy} on={e.preparedOn} />
                                  </TCell>
                                  <TCell>{e.reviewable ? <Who name={e.reviewedBy} on={e.reviewedOn} /> : <span className="text-ink-muted">No review step</span>}</TCell>
                                  <TCell className="whitespace-nowrap">
                                    <StatusBadge status={st.status} label={st.label} />
                                  </TCell>
                                </TRow>
                              );
                            })}
                          </tbody>
                        </Table>
                      </div>
                      <ul className="divide-y divide-border sm:hidden">
                        {s.entries.map((e) => {
                          const st = uiStatus(e);
                          return (
                            <li key={`${e.reference ?? ""}|${e.title}|${e.href}`} className="space-y-1 px-4 py-3">
                              <p className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-semibold tabular-nums">{e.reference ?? <span className="font-normal text-ink-muted">No reference</span>}</span>
                                <StatusBadge status={st.status} label={st.label} />
                              </p>
                              <div>
                                <Paper e={e} />
                              </div>
                              <p className="text-sm text-ink-muted">
                                Prepared by {e.preparedBy ?? "none recorded"}
                                {e.preparedOn ? `, ${e.preparedOn}` : ""}. {e.reviewable ? `Reviewed by ${e.reviewedBy ?? "none recorded"}${e.reviewedOn ? `, ${e.reviewedOn}` : ""}.` : "No review step."}
                              </p>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </details>
                ))}
              </div>
            )}
          </section>
        )}

        <p className="max-w-3xl text-sm text-ink-muted">
          References follow the numbers the file already uses (checklists A1 to E3, areas C1 to C16, schedules such as C5-1), with G1 to G5 for general papers, .L1 for a lead sheet and C5-F1 for an uploaded file.
          The scheme is a default for the firm to confirm, and where no preparer or reviewer is held for a paper, none is shown rather than a guess.
        </p>
      </div>
    </div>
  );
}
