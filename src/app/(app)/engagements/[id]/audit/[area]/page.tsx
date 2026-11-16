import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import * as repo from "@/server/repo";
import * as audit from "@/server/audit";
import { AREA_BY_CODE, CHECKLIST_BY_CODE, LIBRARY_STATUS } from "@/domain/audit";
import { ActionForm } from "@/app/action-form";
import { reviewAreaAction, reviewProcedureAction, updateProcedureAction } from "@/app/audit-actions";
import { removeWorkingPaperAction, uploadWorkingPaperAction } from "@/app/papers-actions";
import * as papers from "@/server/working-papers";
import { listSchedules } from "@/server/test-schedules";
import { confirmationSummary } from "@/server/confirmations";
import { requestCounts } from "@/server/client-requests";
import { bringForwardAction, createScheduleAction } from "@/app/schedule-actions";
import { GROUP_BY_CODE } from "@/domain/groups";
import { formatAmount } from "@/domain/money";
import { canReview } from "@/domain/signoff";
import { SamplingCalculator } from "./sampling";
import { FileInput } from "@/app/file-input";
import { EngagementNav } from "../../nav";

export const dynamic = "force-dynamic";

const TIER_LABEL: Record<string, string> = { core: "Core", extended: "Extended", significant: "Significant risk" };
const STATUS_LABEL: Record<string, string> = { open: "Open", done: "Completed", na: "Not applicable" };
const input = "w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900";
const small = "rounded border border-slate-400 px-2 py-1 text-xs hover:bg-slate-100";

export default async function ProgrammePage({ params }: { params: Promise<{ id: string; area: string }> }) {
  const { id, area: areaCode } = await params;
  // The same page serves a fieldwork programme (C areas) and a checklist (A, B, D and E sections).
  const checklist = CHECKLIST_BY_CODE.get(areaCode);
  const area = AREA_BY_CODE.get(areaCode) ?? (checklist ? { code: checklist.code, title: checklist.title, objective: "" } : undefined);
  if (!/^[0-9a-f-]{36}$/i.test(id) || !area) notFound();

  const session = await getSession();
  const { engagement, procedures, files, overview, scheduleList, requestSummary, confirmationCounts } = await withFirm(await getDb(), session.firmId, async (tx) => ({
    engagement: await repo.getEngagement(tx, id),
    procedures: await audit.listProcedures(tx, id, area.code),
    files: await papers.listWorkingPapers(tx, id),
    overview: await audit.getAuditOverview(tx, id),
    scheduleList: checklist ? [] : await listSchedules(tx, id, area.code),
    requestSummary: checklist ? null : (await requestCounts(tx, id)).byArea.get(area.code) ?? null,
    confirmationCounts: checklist ? null : ((await confirmationSummary(tx, id)).byArea.get(area.code) ?? null),
  }));
  if (!engagement) notFound();

  const open = engagement.status === "open";
  const completed = procedures.filter((p) => p.status !== "open").length;
  const unreviewed = procedures.filter((p) => p.status !== "open" && !p.reviewedAt && !p.partnerStep).length;
  const reviewer = canReview(session.role);
  const auditOn = overview?.enabled ?? false;

  return (
    <div className="py-8 text-slate-900">
      <Link href="/" className="text-sm text-blue-700 underline">All engagements</Link>
      <h1 className="mt-2 text-2xl font-semibold">{engagement.clientName}</h1>
      <p className="mt-1 text-sm text-slate-600">{engagement.periodStart} to {engagement.periodEnd}</p>
      <EngagementNav id={id} current="audit" status={engagement.status} />

      <p className="mt-6 text-sm">
        <Link href={`/engagements/${id}/audit`} className="text-blue-700 underline">Audit planning</Link>
      </p>
      <h2 className="mt-2 text-xl font-semibold">
        {area.code} {area.title}
      </h2>
      {area.objective && <p className="mt-1 text-sm text-slate-700">{area.objective}</p>}
      {area.code === "C16" && (
        <p className="mt-1 text-sm">
          <Link href={`/engagements/${id}/audit/journals`} className="text-blue-700 underline">Journal entry testing: import the listing and select entries</Link>
        </p>
      )}
      {checklist?.optional && <p className="mt-1 text-sm text-slate-700">This checklist applies only in some circumstances. Mark its steps not applicable, with the reason, if it does not apply.</p>}
      <p role="note" className="mt-3 rounded border border-amber-400 bg-amber-50 px-3 py-2 text-xs">
        Methodology content: {LIBRARY_STATUS}.
      </p>

      {requestSummary && requestSummary.total > 0 && (
        <p className="mt-3 text-sm">
          <Link href={`/engagements/${id}/requests?area=${area.code}`} className="text-blue-700 underline">Client requests for this area</Link>
          : {requestSummary.open} open{requestSummary.overdue > 0 ? `, ${requestSummary.overdue} overdue` : ""}, {requestSummary.received} received{requestSummary.notApplicable > 0 ? `, ${requestSummary.notApplicable} not applicable` : ""}.
        </p>
      )}

      {confirmationCounts && confirmationCounts.count > 0 && (
        <p className="mt-3 text-sm">
          <Link href={`/engagements/${id}/audit/confirmations`} className="text-blue-700 underline">Confirmations</Link>
          : {confirmationCounts.count}{confirmationCounts.awaitingReply > 0 ? `, ${confirmationCounts.awaitingReply} awaiting reply` : ""}.
        </p>
      )}

      {!checklist && (
        <section className="mt-6 rounded border border-slate-200 p-4">
          <h3 className="font-semibold">Test schedules</h3>
          <p className="mt-1 text-sm text-slate-600">The detailed testing for this area: a listing from the client, tickmarks and evidence against each line, the work done and a conclusion.</p>
          {scheduleList.length > 0 ? (
            <ul className="mt-2 space-y-1 text-sm">
              {scheduleList.map((s) => (
                <li key={s.id} className="flex flex-wrap items-baseline gap-x-3">
                  <Link href={`/engagements/${id}/audit/${area.code}/schedules/${s.id}`} className="text-blue-700 underline">{s.reference} {s.title}</Link>
                  <span className="tabular-nums text-slate-600">{formatAmount(s.totalMinor)}</span>
                  {s.differenceMinor !== null && s.differenceMinor !== 0 && <span className="rounded bg-red-100 px-1.5 text-xs font-semibold text-red-900">Difference {formatAmount(s.differenceMinor)}</span>}
                  {s.untestedKeyItems > 0 && <span className="rounded bg-amber-100 px-1.5 text-xs font-semibold text-amber-950">{s.untestedKeyItems} key item(s) not tested</span>}
                  <span className={s.toFinish ? "text-amber-800" : "text-emerald-800"}>
                    {!s.hasConclusion ? "No conclusion" : !s.reviewed ? "Not reviewed" : s.selfReviewed ? "Self-reviewed" : "Reviewed"}
                    {s.hasConclusion && s.differenceMinor !== null && s.differenceMinor !== 0 && s.toFinish && s.reviewed ? "; difference not explained" : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-slate-600">No schedules yet.</p>
          )}
          {open && (overview?.enabled ?? false) && engagement.priorEngagementId && (
            <ActionForm action={bringForwardAction} fields={{ engagementId: id }} className="mt-3">
              <button className={small}>Bring forward last year&apos;s schedules</button>
              <span className="ml-2 text-xs text-slate-600">Copies every schedule from the prior-year engagement that has not been brought forward yet: lines with last year&apos;s amounts as comparatives, no tickmarks, conclusions or reviews.</span>
            </ActionForm>
          )}
          {open && (overview?.enabled ?? false) && (
            <ActionForm action={createScheduleAction} fields={{ engagementId: id, areaCode: area.code }} className="mt-3">
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-xs text-slate-700">Title<input name="title" required maxLength={200} placeholder="For example: Receivables listing" className={input} /></label>
                {(AREA_BY_CODE.get(area.code)?.groups.length ?? 0) > 0 && (
                  <label className="flex flex-col gap-1 text-xs text-slate-700">
                    Agrees to the balance of
                    <select name="groupCode" className={input} defaultValue={AREA_BY_CODE.get(area.code)?.groups[0]}>
                      <option value="">No balance to agree to</option>
                      {AREA_BY_CODE.get(area.code)?.groups.map((g) => <option key={g} value={g}>{GROUP_BY_CODE.get(g)?.name ?? g}</option>)}
                    </select>
                  </label>
                )}
                <label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" name="fromTrialBalance" /> Start from the trial balance accounts</label>
                <button className={small}>Start a schedule</button>
              </div>
            </ActionForm>
          )}
        </section>
      )}

      {procedures.length === 0 ? (
        <p className="mt-6 text-sm text-slate-600">{checklist ? "This checklist is loaded when the audit is turned on." : "No programme is loaded for this area. Assess its risks on the audit planning page."}</p>
      ) : (
        <>
          {!checklist && overview?.materiality && <SamplingCalculator performanceMaterialityMinor={overview.materiality.performanceMinor} />}
          <p className="mt-4 text-sm font-medium">
            {completed} of {procedures.length} {checklist ? "steps" : "procedures"} completed, {procedures.filter((p) => p.reviewedAt).length} reviewed
          </p>
          {open && auditOn && reviewer && unreviewed > 0 && (
            <ActionForm action={reviewAreaAction} fields={{ engagementId: id, areaCode: area.code }} className="mt-2">
              <button className={small}>Review all {unreviewed} outstanding</button>
              <span className="ml-2 text-xs text-slate-600">Your own work is skipped unless the firm has no other reviewer.</span>
            </ActionForm>
          )}
          {procedures.map((p) => (
            <section key={p.id} className={`mt-4 rounded border p-4 ${p.status === "open" ? "border-slate-300" : "border-emerald-300 bg-emerald-50"}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-semibold">
                  {p.templateId} {p.assertions && <span className="ml-1 text-xs font-normal text-slate-600">{TIER_LABEL[p.tier]} · Assertions: {p.assertions}</span>}
                </h3>
                <span className="text-sm">
                  {STATUS_LABEL[p.status]}
                  {p.performedByName && <span className="ml-1 text-xs text-slate-600">by {p.performedByName} on {p.performedAt}</span>}
                </span>
              </div>
              <p className="mt-2 text-sm">{p.body}</p>
              <p className="mt-1 text-xs text-slate-600">
                Evidence expected: {p.evidence} · Reference: {p.reference}
              </p>

              {(() => {
                const attached = files.filter((w) => w.targetKind === "procedure" && w.target === p.id);
                return (
                  <div className="mt-2 text-sm">
                    {attached.length > 0 && (
                      <ul className="space-y-1">
                        {attached.map((w) => (
                          <li key={w.id} className="flex flex-wrap items-center gap-2">
                            <span className="text-xs text-slate-600">Evidence:</span>
                            <a href={`/engagements/${id}/files/${w.id}`} className="text-blue-700 underline">{w.fileName}</a>
                            <span className="text-xs text-slate-600">{w.uploadedByName} {w.uploadedAt}</span>
                            {open && (w.uploadedBy === session.userId || canReview(session.role)) && (
                              <ActionForm action={removeWorkingPaperAction} fields={{ paperId: w.id }}>
                                <button className={small}>Remove</button>
                              </ActionForm>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {open && (
                      <ActionForm action={uploadWorkingPaperAction} fields={{ engagementId: id, supports: `procedure:${p.id}`, description: "" }} className="mt-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <FileInput maxBytes={papers.MAX_FILE_BYTES} label={`Evidence file for ${p.templateId}`} accept={papers.ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(",")} className="text-xs text-slate-900" />
                          <button className={small}>Attach evidence</button>
                        </div>
                      </ActionForm>
                    )}
                  </div>
                );
              })()}

              {p.status !== "open" && (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                  {p.partnerStep ? (
                    <span className="text-slate-700">Partner sign-off: no further review</span>
                  ) : p.reviewedAt ? (
                    p.selfReviewed ? (
                      <span className="rounded border border-amber-600 bg-amber-100 px-1.5 py-0.5 font-medium text-amber-950">Self-reviewed by {p.reviewedByName} on {p.reviewedAt}</span>
                    ) : (
                      <span className="font-medium text-emerald-800">Reviewed by {p.reviewedByName} on {p.reviewedAt}</span>
                    )
                  ) : (
                    <span className="text-amber-800">Not yet reviewed</span>
                  )}
                  {open && auditOn && reviewer && !p.partnerStep && (
                    <ActionForm action={reviewProcedureAction} fields={{ procedureId: p.id, withdraw: p.reviewedAt ? "true" : "false" }}>
                      <button className={small}>{p.reviewedAt ? "Withdraw review" : "Review"}</button>
                    </ActionForm>
                  )}
                </div>
              )}

              {open && !p.reviewedAt ? (
                <ActionForm action={updateProcedureAction} fields={{ procedureId: p.id }} className="mt-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="flex flex-col gap-1 text-sm text-slate-700">
                      Work done
                      <textarea name="workDone" rows={3} maxLength={5000} defaultValue={p.workDone ?? ""} className={input} />
                    </label>
                    <label className="flex flex-col gap-1 text-sm text-slate-700">
                      Conclusion
                      <textarea name="conclusion" rows={3} maxLength={5000} defaultValue={p.conclusion ?? ""} className={input} />
                    </label>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {p.status === "open" ? (
                      <>
                        <button name="status" value="done" className={small}>Mark completed</button>
                        <button name="status" value="na" className={small}>Not applicable</button>
                        <button name="status" value="open" className={small}>Save without completing</button>
                      </>
                    ) : (
                      <button name="status" value="open" className={small}>Reopen</button>
                    )}
                  </div>
                </ActionForm>
              ) : (
                <div className="mt-3 text-sm">
                  {open && p.reviewedAt && <p className="mb-1 text-xs text-slate-600">Reviewed work cannot be changed. A reviewer withdraws the review first.</p>}
                  <p><span className="font-medium">Work done:</span> {p.workDone ?? "None recorded"}</p>
                  <p className="mt-1"><span className="font-medium">Conclusion:</span> {p.conclusion ?? "None recorded"}</p>
                </div>
              )}
            </section>
          ))}
        </>
      )}
    </div>
  );
}
