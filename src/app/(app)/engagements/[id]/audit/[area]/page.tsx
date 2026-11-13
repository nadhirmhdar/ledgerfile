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
  const { engagement, procedures, files, overview } = await withFirm(await getDb(), session.firmId, async (tx) => ({
    engagement: await repo.getEngagement(tx, id),
    procedures: await audit.listProcedures(tx, id, area.code),
    files: await papers.listWorkingPapers(tx, id),
    overview: await audit.getAuditOverview(tx, id),
  }));
  if (!engagement) notFound();

  const open = engagement.status === "open";
  const completed = procedures.filter((p) => p.status !== "open").length;
  const unreviewed = procedures.filter((p) => p.status !== "open" && !p.reviewedAt && !p.partnerStep).length;
  const reviewer = canReview(session.role);
  const auditOn = overview?.enabled ?? false;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 text-slate-900">
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
              <span className="ml-2 text-xs text-slate-600">Work you did yourself is skipped.</span>
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
                    <span className="font-medium text-emerald-800">Reviewed by {p.reviewedByName} on {p.reviewedAt}</span>
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
    </main>
  );
}
