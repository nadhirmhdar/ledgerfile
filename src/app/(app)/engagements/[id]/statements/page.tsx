import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import * as repo from "@/server/repo";
import { isEnabled } from "@/server/audit";
import { currentOf, loadHistory } from "@/server/note-texts";
import { NotePassage, type PassageData } from "@/app/note-passage";
import { canEditNotes } from "@/domain/permissions";
import { describeKey, keptButNotShown, overridesFrom } from "@/domain/note-texts";
import { buildStatementPack } from "@/domain/statement-pack";
import type { StatementLine } from "@/domain/statements";
import { formatAmount, formatPresentation } from "@/domain/money";
import { ActionForm } from "@/app/action-form";
import { setBorrowingsCurrentAction } from "@/app/actions";
import { Badge, StatusBadge } from "@/ui/badge";
import { Button, buttonClass, LinkButton } from "@/ui/button";
import { ctl, Disclosure, fieldLabel } from "@/ui/controls";
import { Callout, EmptyState } from "@/ui/feedback";
import { CheckIcon } from "@/ui/icons";
import { PageHeader, EngagementFacts } from "@/ui/layout";
import { OpenOnHash } from "@/ui/open-on-hash";
import { BORROWINGS_ANCHOR, checkDetail, checkFix, checksSentence, draftNoteSentence, orderChecks, placeholderCount } from "@/ui/statements-view";
import { SummaryChevron, summaryRow } from "@/ui/summary-cue";
import { Table, THead } from "@/ui/table";
import { count } from "@/ui/text";
import { EngagementNav } from "../nav";

export const dynamic = "force-dynamic";

const num = "px-2 py-1.5 sm:px-4 text-right tabular-nums whitespace-nowrap";
const th = "px-2 py-2 font-medium sm:px-4";
const ruleFor = (kind: string) => (kind === "total" ? "border-t border-b-2 border-ink" : kind === "subtotal" ? "border-t border-border-input" : "");
const chip = "inline-flex min-h-10 items-center rounded-full border px-4 text-sm font-medium";

/** One statement: a native <details> with a chevron, so it opens and closes with the keyboard and reads as expanded or collapsed. */
function Statement({ id, title, sub, open, children }: { id: string; title: string; sub: string; open: boolean; children: ReactNode }) {
  return (
    <details id={id} open={open} className="group scroll-mt-4 rounded-lg border border-border bg-surface shadow-card">
      <summary className={`${summaryRow} font-semibold`}>
        <SummaryChevron />
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5">
          <h2 className="text-lg font-semibold">{title}</h2>
          <span className="text-sm font-normal text-ink-muted">{sub}</span>
        </span>
      </summary>
      <div className="border-t border-border">{children}</div>
    </details>
  );
}

export default async function StatementsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ units?: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const whole = (await searchParams).units === "whole";

  const session = await getSession();
  const { engagement, accounts, auditOn, history } = await withFirm(await getDb(), session.firmId, async (tx) => ({
    engagement: await repo.getEngagement(tx, id),
    accounts: await repo.listAccounts(tx, id),
    auditOn: await isEnabled(tx, id),
    history: await loadHistory(tx, id),
  }));
  if (!engagement) notFound();

  // A person's wording for the notes, so this page, the Word file and the PDF all read the same.
  const current = currentOf(history);
  const noteTexts = overridesFrom(current);
  const canEdit = canEditNotes(session.role) && engagement.status === "open";
  const passageOf = (key: string, name: string, paragraphs: string[], generated: string[], overridden: boolean): PassageData => ({
    engagementId: id,
    noteKey: key,
    name,
    paragraphs,
    generated,
    overridden,
    current: overridden && current.get(key) ? { version: current.get(key)!.version, by: current.get(key)!.by, at: current.get(key)!.at } : null,
    history: history.get(key) ?? [],
    canEdit,
  });
  const pack = buildStatementPack(
    accounts.map((a) => ({ ...a, closingMinor: a.closingMinor + a.adjustmentMinor })),
    { unitMinor: whole ? 100 : 1, borrowingsCurrent: { current: engagement.borrowingsCurrentMinor, prior: engagement.borrowingsCurrentPriorMinor }, noteTexts },
  );
  const s = pack.base;
  const fmt = (n: number) => formatPresentation(n, pack.rounding.unitMinor);
  const year = engagement.periodEnd.slice(0, 4);
  const priorYear = String(Number(year) - 1);
  const base = `/engagements/${id}`;
  const query = whole ? "?units=whole" : "";
  const hasBorrowings = accounts.some((a) => a.groupCode === "BORROW");
  const open = engagement.status === "open";
  const checks = orderChecks(pack.checks);
  // The policies note is draft while its introduction or any applicable policy is still on generated wording.
  const draftNumbers = pack.notes.filter((n) => n.key === "policies" && (!n.overridden || (n.subsections ?? []).some((x) => !x.overridden))).map((n) => n.number);
  const shownKeys = new Set(pack.notes.flatMap((n) => [...(n.key ? [n.key] : []), ...(n.subsections ?? []).map((x) => x.key)]));
  const kept = keptButNotShown(noteTexts, shownKeys);
  const toCompleteTotal = placeholderCount(pack.notes.flatMap((n) => [...n.paragraphs, ...(n.subsections ?? []).flatMap((x) => x.paragraphs)]));
  const draftLine = draftNoteSentence(draftNumbers);
  const borrowingsFailed = pack.checks.some((c) => !c.passed && c.label === "Current portion of borrowings is within total borrowings");

  const meta = <EngagementFacts client={engagement.clientName} periodStart={engagement.periodStart} periodEnd={engagement.periodEnd} />;

  if (accounts.length === 0) {
    return (
      <div className="py-8 text-ink">
        <PageHeader breadcrumb={[{ label: "All engagements", href: "/" }]} title="Financial statements" meta={meta} />
        <EngagementNav id={id} current="statements" status={engagement.status} archived={engagement.archivedAt !== null} />
        <div className="mt-6">
          <EmptyState
            title="No trial balance yet"
            description="The statements are built from the trial balance. Import one, and map its accounts, to see them here."
            action={<LinkButton href={`${base}/trial-balance`} variant="primary">Open trial balance and mapping</LinkButton>}
          />
        </div>
      </div>
    );
  }

  const Row = ({ line }: { line: StatementLine }) => {
    const note = line.groupCode ? pack.noteByGroup[line.groupCode] : undefined;
    return (
      <tr className={line.kind === "line" ? "" : "font-semibold"}>
        <td className="px-2 py-1.5 sm:min-w-44 sm:px-4">
          {line.groupCode ? (
            <Link href={`${base}/lead-sheets#ls-${line.groupCode}`} className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent">
              {line.label}
            </Link>
          ) : (
            line.label
          )}
        </td>
        <td className="px-1 py-1.5 text-center font-normal sm:px-2">
          {note ? (
            <a href={`#note-${note}`} aria-label={`Note ${note}`} className="inline-flex min-w-6 justify-center rounded-full bg-accent-soft px-1.5 py-0.5 text-sm font-medium text-accent hover:bg-border">
              {note}
            </a>
          ) : (
            ""
          )}
        </td>
        <td className={`${num} ${ruleFor(line.kind)}`}>{fmt(line.current)}</td>
        {s.hasComparatives && <td className={`${num} ${ruleFor(line.kind)}`}>{fmt(line.prior)}</td>}
      </tr>
    );
  };

  const head = (
    <THead>
      <tr>
        <th scope="col" className={th}>
          <span className="sr-only">Line</span>
        </th>
        <th scope="col" className="px-1 py-2 text-center font-medium sm:px-2">
          Note
        </th>
        <th scope="col" className={`${num} font-medium`}>
          {year}
        </th>
        {s.hasComparatives && (
          <th scope="col" className={`${num} font-medium`}>
            {priorYear}
          </th>
        )}
      </tr>
    </THead>
  );

  const jumps = [
    { href: "#sfp", label: "Financial position" },
    { href: "#sci", label: "Comprehensive income" },
    ...(pack.equity ? [{ href: "#sce", label: "Changes in equity" }] : []),
    ...(pack.cashFlow ? [{ href: "#scf", label: "Cash flows" }] : []),
    { href: "#notes", label: "Notes" },
  ];
  const noteAmountCols = s.hasComparatives ? 4 : 3;

  return (
    <div className="py-8 text-ink">
      <OpenOnHash />
      <PageHeader
        breadcrumb={[{ label: "All engagements", href: "/" }]}
        title="Financial statements"
        meta={meta}
        subtitle={checksSentence(pack.checks)}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {auditOn && (
              <a href={`${base}/audit/report`} className={buttonClass("secondary")}>
                Auditor&apos;s report
              </a>
            )}
            <a href={`${base}/statements/pdf${query}`} className={buttonClass("secondary")}>
              Download as PDF
            </a>
            <a href={`${base}/statements/export${query}`} className={buttonClass("primary")}>
              Download as Word
            </a>
          </div>
        }
      />
      <EngagementNav id={id} current="statements" status={engagement.status} archived={engagement.archivedAt !== null} />

      <div className="mt-6 space-y-8">
        {pack.clean ? (
          <div className="flex flex-wrap items-start gap-3">
            <span className="mt-4 shrink-0 text-success-strong">
              <CheckIcon aria-label="All checks pass" role="img" />
            </span>
            <Disclosure summary={`Show the ${count(pack.checks.length, "check")}`} className="min-w-0 flex-1">
              <ul className="divide-y divide-border">
                {checks.map((c) => (
                  <li key={c.label} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0">
                    <StatusBadge status="done" label="Passed" />
                    <span className="text-sm">{c.label}.</span>
                  </li>
                ))}
              </ul>
            </Disclosure>
          </div>
        ) : (
          <Callout variant="warning" title="Checks to put right">
            <ul className="mt-2 divide-y divide-warning/30">
              {checks.map((c) => {
                const fix = c.passed ? null : checkFix(c.label, id);
                const detail = checkDetail(c.detail);
                return (
                  <li key={c.label} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0">
                    <StatusBadge status={c.passed ? "done" : "problem"} label={c.passed ? "Passed" : "Failed"} />
                    <div className="min-w-0 flex-1 basis-60 text-ink">
                      <p className={c.passed ? "" : "font-semibold"}>{c.label}.</p>
                      {detail && <p className="text-ink-muted">{detail}</p>}
                      {fix && (
                        <Link href={fix.href} className="mt-0.5 inline-block font-medium text-accent underline underline-offset-2">
                          {fix.text}
                        </Link>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Callout>
        )}

        <div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <p className="text-sm font-medium">Figures</p>
            <nav aria-label="Rounding">
              <ul className="flex flex-wrap gap-2">
                <li>
                  <Link
                    href={`${base}/statements`}
                    aria-current={whole ? undefined : "true"}
                    className={`${chip} ${whole ? "border-border-input bg-surface text-ink hover:bg-surface-muted" : "border-accent bg-accent text-surface"}`}
                  >
                    Exact
                  </Link>
                </li>
                <li>
                  <Link
                    href={`${base}/statements?units=whole`}
                    aria-current={whole ? "true" : undefined}
                    className={`${chip} ${whole ? "border-accent bg-accent text-surface" : "border-border-input bg-surface text-ink hover:bg-surface-muted"}`}
                  >
                    Whole units
                  </Link>
                </li>
              </ul>
            </nav>
            <span className="text-sm text-ink-muted">{whole ? "Rounded to whole units." : "Shown to two decimal places."}</span>
          </div>
          {(pack.rounding.current || pack.rounding.prior) && (
            <p className="mt-2 text-sm text-ink-muted">
              Rounding each account separately left a small difference, which was put through:
              {pack.rounding.current && ` ${pack.rounding.current.account} (${year}: ${fmt(pack.rounding.current.amountMinor)})`}
              {pack.rounding.prior && ` ${pack.rounding.prior.account} (${priorYear}: ${fmt(pack.rounding.prior.amountMinor)})`}.
            </p>
          )}
        </div>

        {hasBorrowings && open && (
          <div id={BORROWINGS_ANCHOR} className="scroll-mt-4">
            <Disclosure summary="Borrowings due within twelve months" open={borrowingsFailed}>
              <p className="text-sm text-ink-muted">
                Enter how much of total borrowings is repayable within twelve months of the period end. It is shown under current liabilities and the rest stays non-current.
              </p>
              <ActionForm action={setBorrowingsCurrentAction} fields={{ engagementId: id }} className="mt-3">
                <div className="flex flex-wrap items-end gap-3">
                  <label className={fieldLabel}>
                    {year}
                    <input name="current" inputMode="decimal" defaultValue={formatAmount(engagement.borrowingsCurrentMinor)} className={`${ctl} w-40 text-right`} />
                  </label>
                  {s.hasComparatives && (
                    <label className={fieldLabel}>
                      {priorYear}
                      <input name="prior" inputMode="decimal" defaultValue={formatAmount(engagement.borrowingsCurrentPriorMinor)} className={`${ctl} w-40 text-right`} />
                    </label>
                  )}
                  <Button variant="secondary">Save</Button>
                </div>
              </ActionForm>
            </Disclosure>
          </div>
        )}
        {hasBorrowings && !open && (
          <p className="text-sm text-ink-muted">
            Borrowings due within twelve months: {year} {formatAmount(engagement.borrowingsCurrentMinor)}
            {s.hasComparatives && `, ${priorYear} ${formatAmount(engagement.borrowingsCurrentPriorMinor)}`}.
          </p>
        )}

        <nav aria-label="Jump to a statement">
          <ul className="flex flex-wrap items-center gap-2 text-sm">
            <li className="font-medium text-ink-muted">Jump to</li>
            {jumps.map((j) => (
              <li key={j.href}>
                <a href={j.href} className="inline-flex min-h-8 items-center rounded-full border border-border-input bg-surface px-3 font-medium text-accent hover:bg-accent-soft">
                  {j.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="space-y-4">
          <Statement id="sfp" title="Statement of financial position" sub={`At ${engagement.periodEnd}`} open>
            <Table caption="Statement of financial position" className="rounded-none border-0">
              {head}
              <tbody>
                {s.financialPosition.flatMap((section, i) => [
                  ...(section.title
                    ? [
                        <tr key={`t${i}`}>
                          <th colSpan={noteAmountCols} scope="row" className="px-2 pt-4 pb-1 text-left font-semibold sm:px-4">
                            {section.title}
                          </th>
                        </tr>,
                      ]
                    : []),
                  ...section.lines.map((l) => <Row key={l.key} line={l} />),
                ])}
              </tbody>
            </Table>
          </Statement>

          <Statement id="sci" title="Statement of comprehensive income" sub={`For the period ended ${engagement.periodEnd}`} open>
            <Table caption="Statement of comprehensive income" className="rounded-none border-0">
              {head}
              <tbody>
                {s.comprehensiveIncome.map((l) => (
                  <Row key={l.key} line={l} />
                ))}
              </tbody>
            </Table>
          </Statement>

          {!s.hasComparatives && (
            <Callout variant="info">The statement of changes in equity and the statement of cash flows need prior-year balances. Import a trial balance with a Prior Year column to produce them.</Callout>
          )}

          {pack.equity && (
            <Statement id="sce" title="Statement of changes in equity" sub={`For the period ended ${engagement.periodEnd}`} open={false}>
              <Table caption="Statement of changes in equity" className="rounded-none border-0">
                <THead>
                  <tr>
                    <th scope="col" className={`${th} sticky left-0 bg-surface-muted`}>
                      <span className="sr-only">Line</span>
                    </th>
                    {pack.equity.columns.map((c) => (
                      <th key={c.key} scope="col" className={`${num} min-w-28 font-medium whitespace-normal`}>
                        {c.label}
                      </th>
                    ))}
                    <th scope="col" className={`${num} font-medium`}>
                      Total
                    </th>
                  </tr>
                </THead>
                <tbody>
                  {pack.equity.rows.map((r) => (
                    <tr key={r.key} className={r.kind === "total" ? "font-semibold" : ""}>
                      <th scope="row" className="sticky left-0 min-w-40 bg-surface px-4 py-1.5 text-left font-[inherit]">
                        {r.label}
                      </th>
                      {r.values.map((v, i) => (
                        <td key={i} className={`${num} ${ruleFor(r.kind)}`}>
                          {fmt(v)}
                        </td>
                      ))}
                      <td className={`${num} ${ruleFor(r.kind)}`}>{fmt(r.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Statement>
          )}

          {pack.cashFlow && (
            <Statement id="scf" title="Statement of cash flows" sub={`For the period ended ${engagement.periodEnd}`} open={false}>
              <div className="p-3 sm:p-4">
                <Callout variant="info">Derived from the movements between the two years (indirect method): review it for non-cash transactions and disposals.</Callout>
              </div>
              <Table caption="Statement of cash flows" className="rounded-none border-0 border-t">
                <THead>
                  <tr>
                    <th scope="col" className={th}>
                      <span className="sr-only">Line</span>
                    </th>
                    <th scope="col" className={`${num} font-medium`}>
                      {year}
                    </th>
                  </tr>
                </THead>
                <tbody>
                  {pack.cashFlow.sections.flatMap((section) => [
                    <tr key={section.title}>
                      <th colSpan={2} scope="row" className="px-2 pt-4 pb-1 text-left font-semibold sm:px-4">
                        {section.title}
                      </th>
                    </tr>,
                    ...section.lines.map((l) => (
                      <tr key={l.key} className={l.kind === "line" ? "" : "font-semibold"}>
                        <td className="px-2 py-1.5 sm:min-w-44 sm:px-4">{l.label}</td>
                        <td className={`${num} ${ruleFor(l.kind)}`}>{fmt(l.current)}</td>
                      </tr>
                    )),
                  ])}
                  <tr className="font-semibold">
                    <td className="px-2 pt-4 pb-1.5 sm:px-4">Net increase/(decrease) in cash and cash equivalents</td>
                    <td className={`${num} pt-4 ${ruleFor("subtotal")}`}>{fmt(pack.cashFlow.netChange)}</td>
                  </tr>
                  <tr>
                    <td className="px-2 py-1.5 sm:px-4">Cash and cash equivalents at the start of the year</td>
                    <td className={num}>{fmt(pack.cashFlow.opening)}</td>
                  </tr>
                  <tr className="font-semibold">
                    <td className="px-2 py-1.5 sm:px-4">Cash and cash equivalents at the end of the year</td>
                    <td className={`${num} ${ruleFor("total")}`}>{fmt(pack.cashFlow.closing)}</td>
                  </tr>
                </tbody>
              </Table>
            </Statement>
          )}
        </div>

        <section id="notes" aria-labelledby="notes-heading" className="scroll-mt-4">
          <h2 id="notes-heading" className="text-lg font-semibold">
            Notes to the financial statements
          </h2>
          <Callout variant="draft" className="mt-2">
            <p>
              {canEdit ? "Text in [square brackets] is for you to complete: use Edit on a passage, or complete it in the Word document." : "Text in [square brackets] is for you to complete in the Word document."}{" "}
              {toCompleteTotal > 0 ? `${toCompleteTotal} still to complete.` : "Nothing is left to complete."}
            </p>
            {draftLine && <p className="mt-1 font-semibold">{draftLine}</p>}
          </Callout>
          <div className="mt-3 space-y-3">
            {pack.notes.map((note) => {
              const toComplete = placeholderCount([...note.paragraphs, ...(note.subsections ?? []).map((x) => x.text)]);
              return (
                <details key={note.number} id={`note-${note.number}`} className="group scroll-mt-4 rounded-lg border border-border bg-surface shadow-card">
                  <summary className={`${summaryRow} font-semibold`}>
                    <SummaryChevron />
                    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                      <h3 className="font-semibold">
                        {note.number}. {note.title}
                      </h3>
                      {draftNumbers.includes(note.number) && <Badge tone="warning">Draft, needs review</Badge>}
                      {toComplete > 0 && <Badge tone="warning">{toComplete} to complete</Badge>}
                      {note.table && <span className="ml-auto text-sm font-normal text-ink-muted tabular-nums">Total {fmt(note.table.totalCurrent)}</span>}
                    </span>
                  </summary>
                  <div className="space-y-3 border-t border-border px-4 py-4 text-sm">
                    {note.key && (note.groupCode === undefined || note.overridden || canEdit) && (
                      <NotePassage {...passageOf(note.key, note.groupCode ? `the narrative above the table in note ${note.number}` : `note ${note.number}`, note.paragraphs, note.generated ?? [], !!note.overridden)} />
                    )}
                    {note.subsections && note.subsections.length > 0 && (
                      <div className="space-y-2">
                        {note.subsections.map((sub) => (
                          <details key={sub.title} className="group/sub rounded-md border border-border">
                            <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-md px-3 py-1.5 font-medium [&::-webkit-details-marker]:hidden">
                              <SummaryChevron nested />
                              {sub.title}
                            </summary>
                            <div className="border-t border-border px-3 py-3">
                              <NotePassage {...passageOf(sub.key, `the ${sub.title} policy`, sub.paragraphs, sub.generated, sub.overridden)} />
                            </div>
                          </details>
                        ))}
                      </div>
                    )}
                    {note.table && (
                      <Table caption={`Note ${note.number}: ${note.title}`}>
                        <THead>
                          <tr>
                            <th scope="col" className={th}>
                              <span className="sr-only">Item</span>
                            </th>
                            <th scope="col" className={`${num} font-medium`}>
                              {year}
                            </th>
                            {s.hasComparatives && (
                              <th scope="col" className={`${num} font-medium`}>
                                {priorYear}
                              </th>
                            )}
                          </tr>
                        </THead>
                        <tbody>
                          {note.table.rows.map((r, i) => (
                            <tr key={i}>
                              <td className="px-2 py-1.5 sm:min-w-44 sm:px-4">{r.label}</td>
                              <td className={num}>{fmt(r.current)}</td>
                              {s.hasComparatives && <td className={num}>{r.prior === null ? "" : fmt(r.prior)}</td>}
                            </tr>
                          ))}
                          <tr className="font-semibold">
                            <td className="px-2 py-1.5 sm:px-4">Total</td>
                            <td className={`${num} ${ruleFor("total")}`}>{fmt(note.table.totalCurrent)}</td>
                            {s.hasComparatives && <td className={`${num} ${ruleFor("total")}`}>{fmt(note.table.totalPrior)}</td>}
                          </tr>
                        </tbody>
                      </Table>
                    )}
                  </div>
                </details>
              );
            })}
          </div>
          {kept.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-semibold">Kept but not shown</h3>
              <p className="mt-1 text-sm text-ink-muted">
                This wording was edited, but the passage does not apply to this engagement now (its balances are nil). It is kept, and comes back if the passage applies again.
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                {kept.map((k) => (
                  <li key={k}>{describeKey(k)}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
