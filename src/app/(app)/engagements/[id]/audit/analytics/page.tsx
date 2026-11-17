import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import * as repo from "@/server/repo";
import { getAnalytics, type AnalyticsRow } from "@/server/analytics";
import { DAYS_IN_YEAR, FLAG_RULE_TEXT, type RatioRow } from "@/domain/analytics";
import { formatAmount } from "@/domain/money";
import { ActionForm } from "@/app/action-form";
import { reconfirmExplanationAction, saveExplanationAction } from "@/app/analytics-actions";
import { analyticsSentence, chips, filterRows, groupBySection, parseShow, reviewCounts, rowState, showHref, statePill } from "@/ui/analytics-view";
import { Badge } from "@/ui/badge";
import { Button, LinkButton } from "@/ui/button";
import { Disclosure } from "@/ui/controls";
import { Callout, EmptyState } from "@/ui/feedback";
import { Field, Textarea } from "@/ui/form";
import { PageHeader, Section } from "@/ui/layout";
import { Table, TCell, THead, TRow } from "@/ui/table";
import { count } from "@/ui/text";
import { EngagementNav } from "../../nav";

export const dynamic = "force-dynamic";

function percent(r: AnalyticsRow): string {
  if (r.pct !== null) return `${r.pct.toFixed(1)}%`;
  return r.pctNote === "no prior balance" ? "new" : "n/m";
}

function ratioText(value: number | null, unit: RatioRow["unit"]): string {
  if (value === null) return "n/a";
  if (unit === "amount") return formatAmount(Math.round(value));
  if (unit === "percent") return `${value.toFixed(1)}%`;
  if (unit === "days") return `${value.toFixed(0)} ${Math.round(value) === 1 ? "day" : "days"}`;
  return `${value.toFixed(2)}x`;
}

function changeText(value: number | null, unit: RatioRow["unit"]): string {
  if (value === null) return "n/a";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return sign + ratioText(Math.abs(value), unit).replace(/^\(|\)$/g, "");
}

export default async function AnalyticsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const show = parseShow((await searchParams).show);

  const session = await getSession();
  const { engagement, data } = await withFirm(await getDb(), session.firmId, async (tx) => ({
    engagement: await repo.getEngagement(tx, id),
    data: await getAnalytics(tx, id),
  }));
  if (!engagement || !data) notFound();
  const base = `/engagements/${id}/audit`;
  const page = `${base}/analytics`;
  const counts = reviewCounts(data.rows);
  const shown = filterRows(data.rows, show);
  const sections = groupBySection(shown);
  const chipList = chips(data.rows);
  const flagging = data.hasComparatives && !!data.thresholds;

  return (
    <div className="py-8 text-ink">
      <PageHeader
        breadcrumb={[{ label: "All engagements", href: "/" }]}
        title="Analytical review and ratios"
        meta={
          <>
            <span>{engagement.clientName}</span>
            <span aria-hidden="true">·</span>
            <span>
              {engagement.periodStart} to {engagement.periodEnd}
            </span>
            <span aria-hidden="true">·</span>
            <Link href={base} className="text-accent hover:underline">
              Back to audit planning
            </Link>
          </>
        }
        subtitle={analyticsSentence({ hasComparatives: data.hasComparatives, hasThresholds: !!data.thresholds, ...counts })}
      />
      <EngagementNav id={id} current="audit" status={engagement.status} />

      <div className="mt-6 min-w-0 space-y-6">
        <p className="max-w-3xl text-sm text-ink-muted">
          Year-on-year movement of every line in the statements, from the adjusted trial balance. Borrowings are shown as one line here, so each row matches its lead sheet. Use it at planning to decide where to look, and again at
          completion to check the finished statements still make sense.
        </p>

        {!data.auditOn && <Callout variant="info">The audit is off for this engagement, so explanations cannot be written. Turn it on from the audit planning page.</Callout>}
        {data.auditOn && engagement.status !== "open" && <Callout variant="info">This engagement is locked. The review is shown as it stands.</Callout>}
        {!data.hasComparatives ? (
          <Callout variant="warning">There is no prior year on this engagement, so there is nothing to compare with: no movement is flagged and the prior-year ratios are n/a. Link or import the prior year to use this page fully.</Callout>
        ) : !data.thresholds ? (
          <Callout variant="warning">
            Materiality has not been set, so no movement can be flagged yet.{" "}
            <Link href={base} className="font-medium underline">
              Set materiality on the audit planning page
            </Link>{" "}
            first.
          </Callout>
        ) : (
          <>
            <p className="max-w-3xl text-sm text-ink-muted">
              {FLAG_RULE_TEXT} Performance materiality is {formatAmount(data.thresholds.performanceMinor)}; clearly trivial is {formatAmount(data.thresholds.trivialMinor)}.
            </p>
            {data.unexplained > 0 ? (
              <Callout variant="warning">{count(data.unexplained, "flagged movement")} {data.unexplained === 1 ? "has" : "have"} no explanation that still stands, which holds up the lock.</Callout>
            ) : (
              <Callout variant="success">Every flagged movement is explained.</Callout>
            )}
          </>
        )}

        {data.rows.length === 0 ? (
          <EmptyState
            title="No trial balance yet"
            description="Import a trial balance and map its accounts to see the comparison."
            action={
              <LinkButton href={`/engagements/${id}/trial-balance`} variant="secondary">
                Trial balance and mapping
              </LinkButton>
            }
          />
        ) : (
          <Section title="Year-on-year comparison">
            {flagging && (
              <nav aria-label="Filter lines" className="mb-3">
                <ul className="flex flex-wrap gap-2">
                  {chipList.map((c) => {
                    const active = show === c.show;
                    return (
                      <li key={c.show}>
                        <Link
                          href={showHref(page, c.show)}
                          aria-current={active ? "true" : undefined}
                          className={`inline-flex min-h-10 items-center rounded-full border px-4 text-sm font-medium ${active ? "border-accent bg-accent text-surface" : "border-border-strong bg-surface text-ink hover:bg-surface-muted"}`}
                        >
                          {c.label} {c.count}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </nav>
            )}
            {shown.length === 0 ? (
              <EmptyState title="Nothing to show" description="No line matches this filter." action={<LinkButton href={page}>Show all lines</LinkButton>} />
            ) : (
              <Table caption="Year-on-year comparison">
                <THead>
                  <TRow>
                    <TCell header="col" className="sticky left-0 z-10 min-w-40 bg-surface-muted">
                      Line
                    </TCell>
                    <TCell header="col" numeric>Current year</TCell>
                    <TCell header="col" numeric>Prior year</TCell>
                    <TCell header="col" numeric>Change</TCell>
                    <TCell header="col" numeric>Change %</TCell>
                  </TRow>
                </THead>
                {sections.map((g) => (
                  <tbody key={g.section}>
                    <TRow>
                      <TCell header="row" colSpan={5} className="bg-surface-muted text-sm font-semibold tracking-wide text-ink-muted uppercase">
                        {g.section}
                      </TCell>
                    </TRow>
                    {g.rows.map((r) => (
                      <RowView key={`${g.section}:${r.key}`} r={r} id={id} editable={data.editable} />
                    ))}
                  </tbody>
                ))}
              </Table>
            )}
          </Section>
        )}

        <Section
          title="Ratios"
          description={`Worked out from the period-end balances in the statements as issued (current portion of borrowings split out), not from averages. Days use a ${DAYS_IN_YEAR}-day year whatever the length of the period. A ratio is n/a when what it divides by is zero or negative, or when the year has no figures.`}
        >
          <Table caption="Ratios">
            <THead>
              <TRow>
                <TCell header="col" className="sticky left-0 z-10 min-w-40 bg-surface-muted">
                  Ratio
                </TCell>
                <TCell header="col" className="hidden md:table-cell">
                  Formula
                </TCell>
                <TCell header="col" numeric>Current year</TCell>
                <TCell header="col" numeric>Prior year</TCell>
                <TCell header="col" numeric>Change</TCell>
              </TRow>
            </THead>
            <tbody>
              {data.ratios.map((r) => (
                <TRow key={r.key}>
                  <TCell header="row" className="sticky left-0 z-[1] min-w-40 bg-surface">
                    {r.label}
                    <span className="mt-0.5 block text-sm font-normal text-ink-muted md:hidden">{r.formula}</span>
                  </TCell>
                  <TCell className="hidden text-ink-muted md:table-cell">{r.formula}</TCell>
                  <TCell numeric>{ratioText(r.current, r.unit)}</TCell>
                  <TCell numeric>{ratioText(r.prior, r.unit)}</TCell>
                  <TCell numeric>{changeText(r.change, r.unit)}</TCell>
                </TRow>
              ))}
            </tbody>
          </Table>
        </Section>
      </div>
    </div>
  );
}

function RowView({ r, id, editable }: { r: AnalyticsRow; id: string; editable: boolean }) {
  const strong = r.kind !== "line";
  const e = r.explanation;
  const state = rowState(r);
  const pill = statePill(state);
  const bg = r.flag ? "bg-warning-soft" : "bg-surface";
  return (
    <>
      <TRow className={`${bg} ${strong ? "font-semibold" : ""}`}>
        <TCell className={`sticky left-0 z-[1] min-w-40 ${bg}`}>
          {r.label}
          {pill && (
            <span className="ml-2 align-middle">
              <Badge tone={pill.tone}>{pill.label}</Badge>
            </span>
          )}
        </TCell>
        <TCell numeric>{formatAmount(r.current)}</TCell>
        <TCell numeric>{formatAmount(r.prior)}</TCell>
        <TCell numeric>{formatAmount(r.change)}</TCell>
        <TCell numeric>{percent(r)}</TCell>
      </TRow>
      {r.flag && (
        <TRow className={bg}>
          <TCell colSpan={5} className="pt-0 text-sm">
            <p className="text-ink-muted">{r.flag.reason}</p>
            {e && (
              <p className="mt-1.5">
                <span className="font-semibold">Explanation:</span> {e.text}{" "}
                <span className="text-ink-muted">
                  Written by {e.writtenByName} on {e.writtenAt}
                  {e.confirmedByName && `; re-confirmed by ${e.confirmedByName} on ${e.confirmedAt}`}
                </span>
              </p>
            )}
            {e?.stale && <p className="mt-1.5 font-semibold text-warning-strong">The figures have changed since this was written. Re-confirm it still holds, or rewrite it. Until then it does not count towards the lock.</p>}
            {editable && (
              <div className="mt-2 space-y-2">
                {e?.stale && (
                  <ActionForm action={reconfirmExplanationAction} fields={{ engagementId: id, lineKey: r.key }}>
                    <Button variant="secondary" size="sm">
                      Re-confirm as written
                    </Button>
                  </ActionForm>
                )}
                {e ? (
                  <Disclosure summary="Rewrite the explanation">
                    <ExplanationForm id={id} r={r} label="Rewrite the explanation" />
                  </Disclosure>
                ) : (
                  <ExplanationForm id={id} r={r} label="Explanation: the cause, and what you did to confirm it" />
                )}
              </div>
            )}
            {!editable && !e && <p className="mt-1.5 text-ink-muted">No explanation recorded.</p>}
          </TCell>
        </TRow>
      )}
    </>
  );
}

function ExplanationForm({ id, r, label }: { id: string; r: AnalyticsRow; label: string }) {
  return (
    <ActionForm action={saveExplanationAction} fields={{ engagementId: id, lineKey: r.key }}>
      <Field label={label}>
        <Textarea name="explanation" rows={2} maxLength={3000} required defaultValue={r.explanation?.text ?? ""} aria-label={`${label}, ${r.label}`} />
      </Field>
      <div className="mt-2">
        <Button variant="primary" size="sm">
          Save explanation
        </Button>
      </div>
    </ActionForm>
  );
}
