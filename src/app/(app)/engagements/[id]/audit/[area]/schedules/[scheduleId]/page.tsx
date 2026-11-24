import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import * as repo from "@/server/repo";
import { getSchedule } from "@/server/test-schedules";
import { formatAmount } from "@/domain/money";
import { TICKMARKS } from "@/domain/tickmarks";
import { THRESHOLDS } from "@/domain/test-schedule";
import { ActionForm } from "@/app/action-form";
import { deleteScheduleAction, reviewScheduleAction, updateScheduleHeaderAction } from "@/app/schedule-actions";
import { Badge } from "@/ui/badge";
import { Button, buttonClass } from "@/ui/button";
import { Callout } from "@/ui/feedback";
import { Field, Input, Select, Textarea } from "@/ui/form";
import { Card, PageHeader, Section } from "@/ui/layout";
import { keyItemsSentence, readOnlyReason, reviewBadge, SCHEDULE_SELF_NOTE, SCHEDULE_WAITING_REASON, scheduleSentence, signOffControls } from "@/ui/schedule-view";
import { SummaryChevron, summaryRow } from "@/ui/summary-cue";
import { scheduleCrumbs } from "@/ui/engagement-nav";
import { EngagementNav } from "../../../../nav";
import { ImportListing } from "./import-listing";
import { LinesTable } from "./lines-table";

export const dynamic = "force-dynamic";

function Item({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-x-6 gap-y-0.5 sm:grid-cols-[11rem_1fr]">
      <dt className="text-sm text-ink-muted">{term}</dt>
      <dd className="min-w-0 break-words whitespace-pre-wrap text-ink">{children}</dd>
    </div>
  );
}

export default async function SchedulePage({ params }: { params: Promise<{ id: string; area: string; scheduleId: string }> }) {
  const { id, area, scheduleId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const session = await getSession();
  const { engagement, schedule, selfReviewAllowed } = await withFirm(await getDb(), session.firmId, async (tx) => ({
    engagement: await repo.getEngagement(tx, id),
    schedule: await getSchedule(tx, scheduleId, undefined, session.userId),
    // Whether the firm may let a reviewer review work they did themselves (the server's own rule).
    selfReviewAllowed: await repo.canSelfReviewAudit(tx),
  }));
  if (!engagement || !schedule || schedule.engagementId !== id || schedule.areaCode !== area) notFound();

  const open = engagement.status === "open";
  const auditOn = schedule.auditOn;
  const t = schedule.thresholds;
  const money = (n: number) => formatAmount(n);
  const badge = reviewBadge(schedule);
  const readOnly = readOnlyReason({ open, auditOn, reviewed: schedule.reviewed });
  const signOff = signOffControls({ role: session.role, open, auditOn, reviewed: schedule.reviewed, hasConclusion: !!schedule.conclusion?.trim(), viewerWorkedOnIt: schedule.viewerWorkedOnIt, selfReviewAllowed });
  const untestedKeys = schedule.coverage.keyItems - schedule.coverage.keyItemsTested;
  const exportHref = `/engagements/${id}/audit/${area}/schedules/${schedule.id}/export`;

  return (
    <div className="py-8 text-ink">
      <PageHeader
        breadcrumb={scheduleCrumbs(id, { code: schedule.areaCode, title: schedule.areaTitle }, schedule)}
        title={`${schedule.reference} ${schedule.title}`}
        meta={
          <>
            <span>{engagement.clientName}</span>
            <span aria-hidden="true">·</span>
            <span>
              {engagement.periodStart} to {engagement.periodEnd}
            </span>
            {schedule.rolledFrom && (
              <>
                <span aria-hidden="true">·</span>
                <Link href={`/engagements/${schedule.rolledFrom.engagementId}/audit/${area}/schedules/${schedule.rolledFrom.id}`} className="text-accent hover:underline">
                  Brought forward from {schedule.rolledFrom.reference} ({schedule.rolledFrom.periodEnd})
                </Link>
              </>
            )}
          </>
        }
        subtitle={scheduleSentence({
          lineCount: schedule.lines.length,
          totalMinor: schedule.totalMinor,
          testedPct: schedule.coverage.pct,
          differenceMinor: schedule.differenceMinor,
          explained: !!schedule.explanation?.trim(),
          reviewedByName: schedule.reviewedByName,
          selfReviewed: schedule.selfReviewed,
        })}
        actions={
          // A plain link: the route streams the file, so it must not be prefetched.
          <a href={exportHref} className={buttonClass("secondary")}>
            Download (Excel)
          </a>
        }
      />
      <EngagementNav id={id} current="audit" status={engagement.status} archived={engagement.archivedAt !== null} />

      <div className="mt-6 min-w-0 space-y-8">
        {!schedule.areaInScope && (
          <Callout variant="warning">This area is no longer in scope on this year&apos;s trial balance. The schedule was brought forward anyway; check whether it is still needed.</Callout>
        )}
        {readOnly && <Callout variant="info">{readOnly}</Callout>}
        {schedule.differenceMinor !== null && schedule.differenceMinor !== 0 && (
          <Callout variant="danger">
            The listing totals {money(schedule.totalMinor)} but the {schedule.groupName} balance is {money(schedule.balanceMinor ?? 0)}: a difference of {money(schedule.differenceMinor)}.
            {schedule.explanation ? " An explanation is recorded below." : " Explain it below, or correct the listing."}
          </Callout>
        )}
        {untestedKeys > 0 && <Callout variant="warning">{keyItemsSentence(untestedKeys, schedule.thresholdMinor)}</Callout>}

        <Card title="Details">
          <dl className="space-y-3">
            <Item term="Reference">{schedule.reference}</Item>
            <Item term="Area">
              {schedule.areaCode} {schedule.areaTitle}
              {schedule.groupName ? `, ${schedule.groupName}` : ""}
            </Item>
            <Item term="Prepared by">{schedule.preparedByName ? `${schedule.preparedByName} on ${schedule.preparedAt}` : "Not yet (recorded with the conclusion)"}</Item>
            <Item term="Reviewed by">
              <Badge tone={badge.tone}>{badge.label}</Badge>
            </Item>
          </dl>
        </Card>

        <Section title="Thresholds">
          {t ? (
            <p className="text-sm text-ink">
              Overall materiality {money(t.overall)} · performance {money(t.performance)} · half of performance {money(t.half_performance)} · a quarter of performance {money(t.quarter_performance)}. Key items are lines at or above{" "}
              <span className="font-semibold">{money(schedule.thresholdMinor)}</span> ({THRESHOLDS.find((x) => x.code === schedule.threshold)?.label.toLowerCase()}).
            </p>
          ) : (
            <Callout variant="warning">
              Materiality has not been set, so no line is a key item.{" "}
              <Link href={`/engagements/${id}/audit`} className="font-medium underline">
                Set it on the audit planning page.
              </Link>
            </Callout>
          )}
        </Section>

        <Section title="Lines">
          {schedule.editable && (
            <ImportListing
              scheduleId={schedule.id}
              balanceMinor={schedule.balanceMinor}
              existingLines={schedule.lines.map((l) => ({ id: l.id, docRef: l.docRef, description: l.description, amountMinor: l.amountMinor, ticked: l.tested || l.tickmarks.length > 0 }))}
              broughtForward={schedule.lines.some((l) => l.priorAmountMinor !== null)}
            />
          )}
          <div className="mt-3">
            <LinesTable
              key={schedule.lines.map((l) => l.id).join(",")}
              scheduleId={schedule.id}
              initial={schedule.lines}
              files={schedule.files}
              editable={schedule.editable}
              thresholdMinor={schedule.thresholdMinor}
              balanceMinor={schedule.balanceMinor}
            />
          </div>
          <details className="group mt-4 rounded-lg border border-border bg-surface shadow-card">
            <summary className={`${summaryRow} font-semibold`}>
              <SummaryChevron />
              Tickmark legend
            </summary>
            <ul className="space-y-1.5 border-t border-border px-4 py-3 text-sm">
              {TICKMARKS.map((m) => (
                <li key={m.code} className="flex items-start gap-3">
                  <span className="inline-flex min-h-7 min-w-9 shrink-0 items-center justify-center rounded-md border border-border-input bg-surface px-1.5 text-sm font-medium">{m.symbol}</span>
                  <span className="text-ink-muted">{m.meaning}</span>
                </li>
              ))}
            </ul>
          </details>
        </Section>

        <Section title="Objective, work done and conclusion">
          {schedule.priorWorkDone && (
            <Card className="mb-4 bg-surface-muted" title="Last year's work done" description="Read-only. A starting point: this year's work is recorded below.">
              <p className="whitespace-pre-wrap text-sm text-ink-muted">{schedule.priorWorkDone}</p>
            </Card>
          )}
          {schedule.editable ? (
            <ActionForm action={updateScheduleHeaderAction} fields={{ scheduleId: schedule.id }}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Title">
                  <Input name="title" required maxLength={200} defaultValue={schedule.title} />
                </Field>
                <Field label="Key items are lines at or above">
                  <Select name="threshold" defaultValue={schedule.threshold}>
                    {THRESHOLDS.map((x) => (
                      <option key={x.code} value={x.code}>
                        {x.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Objective" className="sm:col-span-2">
                  <Textarea name="objective" rows={2} maxLength={2000} defaultValue={schedule.objective ?? ""} />
                </Field>
                <Field label="Work done">
                  <Textarea name="workDone" rows={4} maxLength={5000} defaultValue={schedule.workDone ?? ""} />
                </Field>
                <Field label="Conclusion">
                  <Textarea name="conclusion" rows={4} maxLength={5000} defaultValue={schedule.conclusion ?? ""} />
                </Field>
                {schedule.groupCode && (
                  <Field label="Explanation of difference (required if the listing does not agree to the balance)" className="sm:col-span-2">
                    <Textarea name="explanation" rows={2} maxLength={3000} defaultValue={schedule.explanation ?? ""} />
                  </Field>
                )}
              </div>
              <p className="mt-3 text-sm text-ink-muted">Recording a conclusion makes you the preparer a reviewer must differ from. Save line changes above separately.</p>
              <div className="mt-3">
                <Button variant="primary">Save</Button>
              </div>
            </ActionForm>
          ) : (
            <dl className="space-y-3">
              {schedule.objective && <Item term="Objective">{schedule.objective}</Item>}
              <Item term="Work done">{schedule.workDone ?? "None recorded"}</Item>
              <Item term="Conclusion">{schedule.conclusion ?? "None recorded"}</Item>
              {schedule.explanation && <Item term="Explanation of difference">{schedule.explanation}</Item>}
            </dl>
          )}
        </Section>

        {(signOff.review || signOff.delete || signOff.workedOnIt) && (
          <Section title="Sign-off">
            {signOff.review && (
              <ActionForm action={reviewScheduleAction} fields={{ scheduleId: schedule.id, withdraw: schedule.reviewed ? "true" : "false" }}>
                <Button variant={signOff.review === "review" ? "primary" : "secondary"}>{signOff.review === "withdraw" ? "Withdraw review" : "Review this schedule"}</Button>
              </ActionForm>
            )}
            {signOff.workedOnIt === "self" && <p className="mt-2 text-sm text-ink-muted">{SCHEDULE_SELF_NOTE}</p>}
            {signOff.workedOnIt === "waiting" && (
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="neutral">Waiting for another reviewer</Badge>
                <span className="text-sm text-ink-muted">{SCHEDULE_WAITING_REASON}</span>
              </div>
            )}
            {signOff.delete && (
              <div className={signOff.review ? "mt-6 border-t border-border pt-4" : ""}>
                <p className="text-sm text-ink-muted">Deleting removes this schedule and all of its lines. It cannot be undone.</p>
                <ActionForm action={deleteScheduleAction} fields={{ scheduleId: schedule.id }} className="mt-2">
                  <Button variant="danger" size="sm">
                    Delete this schedule
                  </Button>
                </ActionForm>
              </div>
            )}
          </Section>
        )}
      </div>
    </div>
  );
}
