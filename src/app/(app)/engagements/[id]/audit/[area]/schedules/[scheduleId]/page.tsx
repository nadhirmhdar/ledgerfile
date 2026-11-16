import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import * as repo from "@/server/repo";
import { getSchedule } from "@/server/test-schedules";
import { canReview } from "@/domain/signoff";
import { formatAmount } from "@/domain/money";
import { TICKMARKS } from "@/domain/tickmarks";
import { THRESHOLDS } from "@/domain/test-schedule";
import { ActionForm } from "@/app/action-form";
import { deleteScheduleAction, reviewScheduleAction, updateScheduleHeaderAction } from "@/app/schedule-actions";
import { EngagementNav } from "../../../../nav";
import { ImportListing } from "./import-listing";
import { LinesTable } from "./lines-table";

export const dynamic = "force-dynamic";

const input = "w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900";
const small = "rounded border border-slate-400 px-2 py-1 text-xs hover:bg-slate-100";

export default async function SchedulePage({ params }: { params: Promise<{ id: string; area: string; scheduleId: string }> }) {
  const { id, area, scheduleId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const session = await getSession();
  const { engagement, schedule } = await withFirm(await getDb(), session.firmId, async (tx) => ({
    engagement: await repo.getEngagement(tx, id),
    schedule: await getSchedule(tx, scheduleId),
  }));
  if (!engagement || !schedule || schedule.engagementId !== id || schedule.areaCode !== area) notFound();

  const open = engagement.status === "open";
  const reviewer = canReview(session.role);
  const auditOn = schedule.auditOn;
  const t = schedule.thresholds;
  const money = (n: number) => formatAmount(n);

  return (
    <div className="py-8 text-slate-900">
      <Link href="/" className="text-sm text-blue-700 underline">All engagements</Link>
      <h1 className="mt-2 text-2xl font-semibold">{engagement.clientName}</h1>
      <p className="mt-1 text-sm text-slate-600">{engagement.periodStart} to {engagement.periodEnd}</p>
      <EngagementNav id={id} current="audit" status={engagement.status} />

      <p className="mt-6 text-sm"><Link href={`/engagements/${id}/audit/${area}`} className="text-blue-700 underline">Back to {schedule.areaCode} {schedule.areaTitle}</Link></p>
      <h2 className="mt-2 text-xl font-semibold">{schedule.reference} {schedule.title}</h2>

      <p className="mt-1 flex flex-wrap gap-x-6 text-sm">
        <a href={`/engagements/${id}/audit/${area}/schedules/${schedule.id}/export`} className="text-blue-700 underline">Download as Excel</a>
        {schedule.rolledFrom && (
          <Link href={`/engagements/${schedule.rolledFrom.engagementId}/audit/${area}/schedules/${schedule.rolledFrom.id}`} className="text-blue-700 underline">
            Brought forward from {schedule.rolledFrom.reference} ({schedule.rolledFrom.periodEnd})
          </Link>
        )}
      </p>
      {!schedule.areaInScope && (
        <p role="note" className="mt-3 rounded border border-amber-600 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          This area is no longer in scope on this year&apos;s trial balance. The schedule was brought forward anyway; check whether it is still needed.
        </p>
      )}

      <dl className="mt-3 grid grid-cols-1 gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
        <div><dt className="inline font-medium">Client: </dt><dd className="inline">{engagement.clientName}</dd></div>
        <div><dt className="inline font-medium">Period: </dt><dd className="inline">{engagement.periodStart} to {engagement.periodEnd}</dd></div>
        <div><dt className="inline font-medium">Reference: </dt><dd className="inline">{schedule.reference}</dd></div>
        <div><dt className="inline font-medium">Area: </dt><dd className="inline">{schedule.areaCode} {schedule.areaTitle}{schedule.groupName ? `, ${schedule.groupName}` : ""}</dd></div>
        <div><dt className="inline font-medium">Prepared by: </dt><dd className="inline">{schedule.preparedByName ? `${schedule.preparedByName} on ${schedule.preparedAt}` : "Not yet (recorded with the conclusion)"}</dd></div>
        <div>
          <dt className="inline font-medium">Reviewed by: </dt>
          <dd className="inline">
            {schedule.reviewedByName ? (
              schedule.selfReviewed ? (
                <span className="rounded border border-amber-600 bg-amber-100 px-1.5 py-0.5 font-medium text-amber-950">Self-reviewed by {schedule.reviewedByName} on {schedule.reviewedAt}</span>
              ) : (
                <span className="font-medium text-emerald-800">{schedule.reviewedByName} on {schedule.reviewedAt}</span>
              )
            ) : (
              <span className="text-amber-800">Not yet reviewed</span>
            )}
          </dd>
        </div>
      </dl>

      {!auditOn && open && <p className="mt-3 rounded border border-slate-300 bg-slate-50 px-3 py-2 text-sm">The audit is off for this engagement, so this schedule is read-only.</p>}
      {!open && <p className="mt-3 rounded border border-slate-300 bg-slate-50 px-3 py-2 text-sm">This engagement is locked, so this schedule is read-only.</p>}
      {schedule.reviewed && open && auditOn && <p className="mt-3 rounded border border-slate-300 bg-slate-50 px-3 py-2 text-sm">This schedule has been reviewed, so it cannot be changed. A reviewer withdraws the review first.</p>}

      <section className="mt-4 text-sm">
        <h3 className="font-semibold">Thresholds</h3>
        {t ? (
          <p className="mt-1">
            Overall materiality {money(t.overall)} · performance {money(t.performance)} · half of performance {money(t.half_performance)} · a quarter of performance {money(t.quarter_performance)}.
            Key items are lines at or above <span className="font-semibold">{money(schedule.thresholdMinor)}</span> ({THRESHOLDS.find((x) => x.code === schedule.threshold)?.label.toLowerCase()}).
          </p>
        ) : (
          <p className="mt-1 text-amber-900">Materiality has not been set, so no line is a key item. <Link href={`/engagements/${id}/audit`} className="text-blue-700 underline">Set it on the audit planning page.</Link></p>
        )}
      </section>

      {schedule.differenceMinor !== null && schedule.differenceMinor !== 0 && (
        <p role="alert" className="mt-4 rounded border border-red-600 bg-red-50 px-3 py-2 text-sm font-semibold text-red-900">
          The listing totals {money(schedule.totalMinor)} but the {schedule.groupName} balance is {money(schedule.balanceMinor ?? 0)}: a difference of {money(schedule.differenceMinor)}.
          {schedule.explanation ? " An explanation is recorded below." : " Explain it below, or correct the listing."}
        </p>
      )}

      {schedule.coverage.keyItems > schedule.coverage.keyItemsTested && (
        <p role="alert" className="mt-4 rounded border border-amber-600 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-950">
          {schedule.coverage.keyItems - schedule.coverage.keyItemsTested} key item(s) not tested: lines at or above {money(schedule.thresholdMinor)} that are not marked tested. This does not stop the schedule being reviewed, so the reviewer should look at them.
        </p>
      )}

      <section className="mt-6">
        <h3 className="font-semibold">Lines</h3>
        {schedule.editable && <ImportListing scheduleId={schedule.id} balanceMinor={schedule.balanceMinor} existingLines={schedule.lines.map((l) => ({ id: l.id, docRef: l.docRef, description: l.description, amountMinor: l.amountMinor, ticked: l.tested || l.tickmarks.length > 0 }))} broughtForward={schedule.lines.some((l) => l.priorAmountMinor !== null)} />}
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
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer font-medium">Tickmark legend</summary>
          <ul className="mt-1 space-y-0.5">
            {TICKMARKS.map((m) => (
              <li key={m.code}><span className="mr-2 inline-block min-w-8 rounded border border-slate-400 px-1 text-center text-xs">{m.symbol}</span>{m.meaning}</li>
            ))}
          </ul>
        </details>
      </section>

      <section className="mt-8">
        <h3 className="font-semibold">Objective, work done and conclusion</h3>
        {schedule.priorWorkDone && (
          <div className="mt-2 rounded border border-slate-300 bg-slate-50 px-3 py-2 text-sm">
            <p className="text-xs font-medium text-slate-600">Last year&apos;s work done (read-only, a starting point: this year&apos;s work is recorded below)</p>
            <p className="mt-1 whitespace-pre-wrap">{schedule.priorWorkDone}</p>
          </div>
        )}
        {schedule.editable ? (
          <ActionForm action={updateScheduleHeaderAction} fields={{ scheduleId: schedule.id }} className="mt-2">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm text-slate-700">Title<input name="title" required maxLength={200} defaultValue={schedule.title} className={input} /></label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                Key items are lines at or above
                <select name="threshold" defaultValue={schedule.threshold} className={input}>
                  {THRESHOLDS.map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700 sm:col-span-2">Objective<textarea name="objective" rows={2} maxLength={2000} defaultValue={schedule.objective ?? ""} className={input} /></label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">Work done<textarea name="workDone" rows={4} maxLength={5000} defaultValue={schedule.workDone ?? ""} className={input} /></label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">Conclusion<textarea name="conclusion" rows={4} maxLength={5000} defaultValue={schedule.conclusion ?? ""} className={input} /></label>
              {schedule.groupCode && (
                <label className="flex flex-col gap-1 text-sm text-slate-700 sm:col-span-2">
                  Explanation of difference (required if the listing does not agree to the balance)
                  <textarea name="explanation" rows={2} maxLength={3000} defaultValue={schedule.explanation ?? ""} className={input} />
                </label>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-600">Recording a conclusion makes you the preparer a reviewer must differ from. Save line changes above separately.</p>
            <button className="mt-2 rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700">Save</button>
          </ActionForm>
        ) : (
          <div className="mt-2 space-y-1 text-sm">
            {schedule.objective && <p><span className="font-medium">Objective:</span> {schedule.objective}</p>}
            <p><span className="font-medium">Work done:</span> {schedule.workDone ?? "None recorded"}</p>
            <p><span className="font-medium">Conclusion:</span> {schedule.conclusion ?? "None recorded"}</p>
            {schedule.explanation && <p><span className="font-medium">Explanation of difference:</span> {schedule.explanation}</p>}
          </div>
        )}
      </section>

      {open && auditOn && (
        <section className="mt-8 flex flex-wrap items-start gap-6">
          {reviewer && (
            <ActionForm action={reviewScheduleAction} fields={{ scheduleId: schedule.id, withdraw: schedule.reviewed ? "true" : "false" }}>
              <button className={small}>{schedule.reviewed ? "Withdraw review" : "Review this schedule"}</button>
            </ActionForm>
          )}
          {!schedule.reviewed && (reviewer || !schedule.conclusion?.trim()) && (
            <ActionForm action={deleteScheduleAction} fields={{ scheduleId: schedule.id }}>
              <button className={small}>Delete this schedule</button>
            </ActionForm>
          )}
        </section>
      )}
    </div>
  );
}
