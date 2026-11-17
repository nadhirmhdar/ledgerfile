import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import * as repo from "@/server/repo";
import * as audit from "@/server/audit";
import * as ledger from "@/server/ledger";
import { FLAGS, FLAG_LABEL } from "@/domain/journal-risk";
import { LIBRARY_STATUS } from "@/domain/audit";
import { formatAmount } from "@/domain/money";
import { ActionForm } from "@/app/action-form";
import { FileInput } from "@/app/file-input";
import { importLedgerAction, recordJournalTestAction, selectEntryAction } from "@/app/ledger-actions";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Disclosure } from "@/ui/controls";
import { Callout } from "@/ui/feedback";
import { Field, Textarea } from "@/ui/form";
import { PageHeader, Section, Stat } from "@/ui/layout";
import { completenessSentence, entryPill, journalHref, journalSentence, matchingSentence } from "@/ui/journal-view";
import { SummaryChevron } from "@/ui/summary-cue";
import { Table, TCell, THead, TRow } from "@/ui/table";
import { count } from "@/ui/text";
import { EngagementNav } from "../../nav";

export const dynamic = "force-dynamic";

const FLAG_EXPLANATION = new Map(FLAGS.map((f) => [f.code, f.explanation]));

export default async function JournalTestingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ flag?: string; user?: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const filter = await searchParams;

  const session = await getSession();
  const data = await withFirm(await getDb(), session.firmId, async (tx) => {
    const engagement = await repo.getEngagement(tx, id);
    if (!engagement) return null;
    const overview = (await ledger.getLedgerOverview(tx, id, filter))!;
    const lines = await ledger.getLinesForEntries(tx, id, overview.entries.map((e) => e.entryNo));
    return { engagement, overview, lines, auditOverview: await audit.getAuditOverview(tx, id) };
  });
  if (!data) notFound();
  const { engagement, overview, lines, auditOverview } = data;

  const open = engagement.status === "open";
  const enabled = auditOverview?.enabled ?? false;
  const base = `/engagements/${id}/audit/journals`;
  const href = (next: { flag?: string; user?: string }) => journalHref(base, next);
  const activeFlag = FLAGS.find((f) => f.code === filter.flag)?.code;
  const activeUser = overview.users.includes(filter.user ?? "") ? filter.user : undefined;
  const chip = (active: boolean) =>
    `inline-flex min-h-9 items-center rounded-full border px-3 text-sm font-medium ${active ? "border-accent bg-accent text-surface" : "border-border-strong bg-surface text-ink hover:bg-surface-muted"}`;
  const rec = overview.reconciliation;

  return (
    <div className="py-8 text-ink">
      <PageHeader
        breadcrumb={[{ label: "All engagements", href: "/" }]}
        title="Journal entry testing"
        meta={
          <>
            <span>{engagement.clientName}</span>
            <span aria-hidden="true">·</span>
            <span>
              {engagement.periodStart} to {engagement.periodEnd}
            </span>
            <span aria-hidden="true">·</span>
            <Link href={`/engagements/${id}/audit`} className="text-accent hover:underline">
              Audit planning
            </Link>
            <span aria-hidden="true">·</span>
            <Link href={`/engagements/${id}/audit/C16`} className="text-accent hover:underline">
              C16 programme
            </Link>
          </>
        }
        subtitle={journalSentence({ enabled, entryCount: overview.listing?.entryCount ?? null, selected: overview.selected, tested: overview.tested })}
      />
      <EngagementNav id={id} current="audit" status={engagement.status} />

      <div className="mt-6 min-w-0 space-y-6">
        <p className="max-w-3xl text-sm text-ink-muted">
          Import the client&apos;s journal listing for the period, check it is complete, and select entries to test for management override of controls. A flag is a reason to look at an entry, not a finding.
        </p>
        <Callout variant="draft" title="Draft methodology">
          The risk characteristics used here follow the draft methodology ({LIBRARY_STATUS}).
        </Callout>

        {!enabled ? (
          <Callout variant="info">
            Turn the audit on for this engagement on the{" "}
            <Link href={`/engagements/${id}/audit`} className="font-medium underline">
              Audit tab
            </Link>{" "}
            to import a journal listing.
          </Callout>
        ) : (
          <>
            {open && (
              <Disclosure summary={overview.listing ? "Replace the journal listing" : "Import the journal listing"} open={!overview.listing}>
                <ActionForm action={importLedgerAction} fields={{ engagementId: id }}>
                  <div className="flex flex-wrap items-end gap-3">
                    <FileInput
                      maxBytes={10 * 1024 * 1024}
                      accept=".xlsx,.csv"
                      label="Journal listing file"
                      className="block max-w-full text-sm text-ink file:mr-3 file:min-h-10 file:cursor-pointer file:rounded-md file:border file:border-border-strong file:bg-surface file:px-4 file:text-sm file:font-medium file:text-ink hover:file:bg-surface-muted"
                    />
                    <Button variant="primary">{overview.listing ? "Replace" : "Import"}</Button>
                  </div>
                  <p className="mt-3 text-sm text-ink-muted">
                    Excel (.xlsx) or CSV, up to 50,000 lines. Needs columns for date, journal number, account code, and Debit and Credit (or one Amount). Description and Posted by are used when present. Dates are read day first
                    (31/12/2025). Every entry must balance.
                    {overview.listing && " The listing cannot be replaced once an entry has been tested."}
                  </p>
                </ActionForm>
              </Disclosure>
            )}

            {overview.listing && rec && (
              <>
                <section aria-label="Listing summary">
                  <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                    <li>
                      <Stat label="Entries" value={overview.listing.entryCount.toLocaleString("en-US")} />
                    </li>
                    <li>
                      <Stat label="Lines" value={overview.listing.lineCount.toLocaleString("en-US")} />
                    </li>
                    <li>
                      <Stat
                        label="Dated"
                        value={
                          <span className="block text-base leading-6 font-semibold whitespace-nowrap">
                            {overview.listing.from}
                            <br />
                            to {overview.listing.to}
                          </span>
                        }
                      />
                    </li>
                    <li>
                      <Stat label="Selected" value={overview.selected} hint="includes those tested" />
                    </li>
                    <li>
                      <Stat label="Tested" value={overview.tested} />
                    </li>
                  </ul>
                  <p className="mt-2 text-sm break-words text-ink-muted">
                    {overview.listing.fileName}, imported by {overview.listing.importedBy} on {overview.listing.importedAt}.
                  </p>
                </section>

                <Section title="Completeness">
                  <Callout variant={rec.differences.length === 0 ? "success" : "warning"}>{completenessSentence({ agreed: rec.agreed, differences: rec.differences.length, unchecked: rec.unchecked })}</Callout>
                  {rec.differences.length > 0 && (
                    <div className="mt-3">
                      <Table caption="Accounts where the listing differs from the trial balance">
                        <THead>
                          <TRow>
                            <TCell header="col">Account</TCell>
                            <TCell header="col" numeric>
                              Movement per trial balance
                            </TCell>
                            <TCell header="col" numeric>
                              Movement per listing
                            </TCell>
                            <TCell header="col" numeric>
                              Difference
                            </TCell>
                          </TRow>
                        </THead>
                        <tbody>
                          {rec.differences.slice(0, 15).map((d) => (
                            <TRow key={d.code}>
                              <TCell>
                                <span className="font-mono text-sm">{d.code}</span> {d.name}
                              </TCell>
                              <TCell numeric>{formatAmount(d.expectedMinor)}</TCell>
                              <TCell numeric>{formatAmount(d.ledgerMinor)}</TCell>
                              <TCell numeric>{formatAmount(d.differenceMinor)}</TCell>
                            </TRow>
                          ))}
                        </tbody>
                      </Table>
                      {rec.differences.length > 15 && <p className="mt-1 text-sm text-ink-muted">Showing the 15 largest differences.</p>}
                    </div>
                  )}
                  <p className="mt-3 text-sm text-ink-muted">
                    Only entries dated within the period are counted. Balance sheet accounts are rolled forward from the prior-year balance; income and expense accounts from zero. Retained earnings usually differs by the prior
                    year&apos;s result, which is closed into it outside the period&apos;s journals. Investigate every other difference before relying on the listing.
                  </p>
                </Section>

                <Section title="Entries to consider">
                  <nav aria-label="Filter by flag">
                    <ul className="flex flex-wrap gap-2">
                      <li>
                        <Link href={href({ user: activeUser })} aria-current={!activeFlag ? "true" : undefined} className={chip(!activeFlag)}>
                          All flagged
                        </Link>
                      </li>
                      {FLAGS.filter((f) => (overview.flagCounts[f.code] ?? 0) > 0).map((f) => (
                        <li key={f.code}>
                          <Link href={href({ flag: f.code, user: activeUser })} aria-current={activeFlag === f.code ? "true" : undefined} className={chip(activeFlag === f.code)} title={f.explanation}>
                            {f.label} ({overview.flagCounts[f.code]})
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </nav>
                  {overview.users.length > 0 && (
                    <nav aria-label="Filter by who posted" className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="text-sm text-ink-muted">Posted by:</span>
                      <ul className="flex flex-wrap gap-2">
                        <li>
                          <Link href={href({ flag: activeFlag })} aria-current={!activeUser ? "true" : undefined} className={chip(!activeUser)}>
                            Anyone
                          </Link>
                        </li>
                        {overview.users.slice(0, 20).map((u) => (
                          <li key={u}>
                            <Link href={href({ flag: activeFlag, user: u })} aria-current={activeUser === u ? "true" : undefined} className={chip(activeUser === u)}>
                              {u}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </nav>
                  )}
                  <p role="status" className="mt-3 text-sm text-ink-muted">
                    {matchingSentence(overview.matching, overview.entries.length)}
                  </p>

                  <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface shadow-card">
                    {overview.entries.map((e) => {
                      const pill = entryPill(e.test);
                      const entryLines = lines.get(e.entryNo) ?? [];
                      return (
                        <li key={e.entryNo} className="px-4 py-3 sm:px-5">
                          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                            <h3 className="min-w-0 break-words">
                              <span className="font-semibold">{e.entryNo}</span>
                              <span className="ml-2 text-sm font-normal text-ink-muted">
                                {e.date}
                                {e.postedBy ? ` · posted by ${e.postedBy}` : ""}
                              </span>
                            </h3>
                            <span className="flex items-center gap-3">
                              {pill.label && <Badge tone={pill.tone}>{pill.label}</Badge>}
                              <span className="text-right tabular-nums">{formatAmount(e.totalMinor)}</span>
                            </span>
                          </div>
                          <p className="mt-0.5 text-sm break-words">{e.description ?? <span className="text-ink-muted">No description</span>}</p>
                          {e.flags.length > 0 && (
                            <ul className="mt-1.5 flex flex-wrap gap-1.5">
                              {e.flags.map((f) => (
                                <li key={f}>
                                  <span title={FLAG_EXPLANATION.get(f)} className="inline-flex items-center rounded-full bg-neutral-soft px-2.5 py-0.5 text-sm font-medium text-neutral-strong">
                                    {FLAG_LABEL.get(f)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}

                          <details className="group mt-2">
                            <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1.5 rounded-md text-sm font-medium text-accent hover:underline [&::-webkit-details-marker]:hidden">
                              <SummaryChevron />
                              Show the {count(entryLines.length, "line")}
                            </summary>
                            <div className="mt-2">
                              <Table caption={`Lines of ${e.entryNo}`}>
                                <THead>
                                  <TRow>
                                    <TCell header="col">Account</TCell>
                                    <TCell header="col">Name</TCell>
                                    <TCell header="col" numeric>
                                      Debit
                                    </TCell>
                                    <TCell header="col" numeric>
                                      Credit
                                    </TCell>
                                  </TRow>
                                </THead>
                                <tbody>
                                  {entryLines.map((l, i) => (
                                    <TRow key={i}>
                                      <TCell className="font-mono text-sm">{l.accountCode}</TCell>
                                      <TCell>
                                        {l.accountName ?? ""}
                                        {l.description && l.description !== e.description ? ` · ${l.description}` : ""}
                                      </TCell>
                                      <TCell numeric>{l.amountMinor > 0 ? formatAmount(l.amountMinor) : ""}</TCell>
                                      <TCell numeric>{l.amountMinor < 0 ? formatAmount(-l.amountMinor) : ""}</TCell>
                                    </TRow>
                                  ))}
                                </tbody>
                              </Table>
                            </div>
                          </details>

                          {e.test?.status === "tested" && (
                            <dl className="mt-3 space-y-1 text-sm">
                              <div>
                                <dt className="inline font-semibold">Work done: </dt>
                                <dd className="inline">{e.test.workDone}</dd>
                              </div>
                              <div>
                                <dt className="inline font-semibold">Conclusion: </dt>
                                <dd className="inline">{e.test.conclusion}</dd>
                                <span className="text-ink-muted"> — {e.test.testedBy}</span>
                              </div>
                            </dl>
                          )}
                          {open && !e.test && (
                            <ActionForm action={selectEntryAction} fields={{ engagementId: id, entryNo: e.entryNo, select: "true" }} className="mt-2">
                              <Button variant="secondary" size="sm">
                                Select for testing
                              </Button>
                            </ActionForm>
                          )}
                          {open && e.test?.status === "selected" && (
                            <div className="mt-3 rounded-lg border border-border bg-surface-muted/50 p-3">
                              <ActionForm action={recordJournalTestAction} fields={{ engagementId: id, entryNo: e.entryNo }}>
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                  <Field label="Support inspected">
                                    <Textarea name="workDone" rows={2} maxLength={5000} required aria-label={`Support inspected, ${e.entryNo}`} />
                                  </Field>
                                  <Field label="Conclusion">
                                    <Textarea name="conclusion" rows={2} maxLength={5000} required aria-label={`Conclusion, ${e.entryNo}`} />
                                  </Field>
                                </div>
                                <div className="mt-3">
                                  <Button variant="primary" size="sm">
                                    Record conclusion
                                  </Button>
                                </div>
                              </ActionForm>
                              <ActionForm action={selectEntryAction} fields={{ engagementId: id, entryNo: e.entryNo, select: "false" }} className="mt-2">
                                <Button variant="ghost" size="sm">
                                  Remove from selection
                                </Button>
                              </ActionForm>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </Section>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
