import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import * as repo from "@/server/repo";
import * as audit from "@/server/audit";
import { AREA_BY_CODE, CHECKLIST_BY_CODE, LIBRARY_STATUS } from "@/domain/audit";
import { ADDED_LABEL, ADDED_NOTE, DRAFT_REST_NOTE, FIRM_WORDING_LABEL, FIRM_WORDING_NOTE } from "@/ui/methodology-view";
import { ActionForm } from "@/app/action-form";
import { reviewAreaAction, reviewProcedureAction, updateProcedureAction } from "@/app/audit-actions";
import { removeWorkingPaperAction } from "@/app/papers-actions";
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
import { UploadForm } from "@/app/upload-form";
import { workingPaperLimit } from "@/server/direct-upload";
import { Badge } from "@/ui/badge";
import { Button, LinkButton } from "@/ui/button";
import { ctl, Disclosure, fieldLabel } from "@/ui/controls";
import { Callout, EmptyState, ProgressBar } from "@/ui/feedback";
import { Card, ListRow, ListRows, PageHeader, Section } from "@/ui/layout";
import { count } from "@/ui/text";
import { coveredInQuestionnaire } from "@/domain/planning-questions";
import { filterProcedures, parseProcedureShow, procedureControls, procedureResults, reviewPill, workPill, type ProcedureShow } from "@/ui/procedure-view";
import { areaCrumbs } from "@/ui/engagement-nav";
import { EngagementNav } from "../../nav";

export const dynamic = "force-dynamic";

const TIER_LABEL: Record<string, string> = { core: "Core", extended: "Extended", significant: "Significant risk" };

export default async function ProgrammePage({ params, searchParams }: { params: Promise<{ id: string; area: string }>; searchParams: Promise<{ show?: string | string[] }> }) {
  const { id, area: areaCode } = await params;
  const show = parseProcedureShow((await searchParams).show);
  // The same page serves a fieldwork programme (C areas) and a checklist (A, B, D and E sections).
  const checklist = CHECKLIST_BY_CODE.get(areaCode);
  const area = AREA_BY_CODE.get(areaCode) ?? (checklist ? { code: checklist.code, title: checklist.title, objective: "" } : undefined);
  if (!/^[0-9a-f-]{36}$/i.test(id) || !area) notFound();

  const session = await getSession();
  const { engagement, procedures, files, overview, scheduleList, requestSummary, confirmationCounts, selfReviewAllowed } = await withFirm(await getDb(), session.firmId, async (tx) => ({
    engagement: await repo.getEngagement(tx, id),
    procedures: await audit.listProcedures(tx, id, area.code, session.userId),
    // Whether the firm may let a reviewer review work they did themselves (the server's own rule).
    selfReviewAllowed: await repo.canSelfReviewAudit(tx),
    files: await papers.listWorkingPapers(tx, id),
    overview: await audit.getAuditOverview(tx, id),
    scheduleList: checklist ? [] : await listSchedules(tx, id, area.code),
    requestSummary: checklist ? null : ((await requestCounts(tx, id)).byArea.get(area.code) ?? null),
    confirmationCounts: checklist ? null : ((await confirmationSummary(tx, id)).byArea.get(area.code) ?? null),
  }));
  if (!engagement) notFound();

  const open = engagement.status === "open";
  const limit = workingPaperLimit();
  const auditOn = overview?.enabled ?? false;
  const reviewer = canReview(session.role);
  const base = `/engagements/${id}`;
  const noun = checklist ? "steps" : "procedures";
  const view = filterProcedures(procedures, show);
  const completed = procedures.filter((p) => p.status !== "open").length;
  const waiting = view.counts.waiting;
  const reviewedCount = procedures.filter((p) => p.reviewedAt).length;
  const here = (s: ProcedureShow) => `${base}/audit/${area.code}${s === "all" ? "" : `?show=${s}`}`;
  const ctx = { open, auditOn, role: session.role, userId: session.userId, selfReviewAllowed };

  const sentence =
    procedures.length === 0
      ? checklist
        ? "This checklist is loaded when the audit is turned on."
        : "No programme is loaded for this area yet."
      : `${completed} of ${procedures.length} ${procedures.length === 1 && checklist ? "step" : procedures.length === 1 ? "procedure" : noun} completed${waiting > 0 ? `, ${waiting} waiting for review` : ""}.`;

  const chips: { key: ProcedureShow; label: string; n: number }[] = [
    { key: "all", label: "All", n: view.counts.all },
    { key: "open", label: "Open", n: view.counts.open },
    { key: "waiting", label: "Waiting for review", n: view.counts.waiting },
    { key: "done", label: "Done", n: view.counts.done },
  ];
  const areaDef = AREA_BY_CODE.get(area.code);

  return (
    <div className="py-8 text-ink">
      <PageHeader
        breadcrumb={areaCrumbs(id, area)}
        title={`${area.code} ${area.title}`}
        meta={
          <>
            <span>{engagement.clientName}</span>
            <span aria-hidden="true">·</span>
            <span>
              {engagement.periodStart} to {engagement.periodEnd}
            </span>
          </>
        }
        subtitle={sentence}
      />
      <EngagementNav id={id} current="audit" status={engagement.status} archived={engagement.archivedAt !== null} />

      <div className="mt-6 space-y-8">
        {procedures.length > 0 && (
          <div className="max-w-xl">
            <ProgressBar value={completed} max={procedures.length} label={`${completed} of ${procedures.length} ${noun} completed`} />
          </div>
        )}
        <Callout variant="draft" title={`Methodology content: ${LIBRARY_STATUS}`}>
          {procedures.some((p) => p.firmWording || p.firmAdded) ? DRAFT_REST_NOTE : undefined}
        </Callout>
        {!auditOn && (
          <Callout variant="info" title="The audit is off for this engagement">
            The programme is shown as a record only. Turn the audit on, on the audit planning page, to change it.
          </Callout>
        )}
        {checklist?.optional && <p className="text-sm text-ink-muted">This checklist applies only in some circumstances. Mark its steps not applicable, with the reason, if it does not apply.</p>}
        {area.objective && (
          <details className="rounded-lg border border-border bg-surface px-4 py-3 shadow-card">
            <summary className="cursor-pointer text-sm font-semibold">What this area covers</summary>
            <p className="mt-2 text-sm text-ink-muted">{area.objective}</p>
          </details>
        )}

        {!checklist && ((requestSummary && requestSummary.total > 0) || (confirmationCounts && confirmationCounts.count > 0) || area.code === "C16") && (
          <Section title="Related work">
            <ListRows>
              {requestSummary && requestSummary.total > 0 && (
                <ListRow
                  title="Client requests for this area"
                  href={`${base}/requests?area=${area.code}`}
                  subtitle={`${requestSummary.open} open${requestSummary.overdue > 0 ? `, ${requestSummary.overdue} overdue` : ""}, ${requestSummary.received} received${requestSummary.notApplicable > 0 ? `, ${requestSummary.notApplicable} not applicable` : ""}`}
                />
              )}
              {confirmationCounts && confirmationCounts.count > 0 && (
                <ListRow
                  title="Confirmations"
                  href={`${base}/audit/confirmations`}
                  subtitle={`${confirmationCounts.count}${confirmationCounts.awaitingReply > 0 ? `, ${confirmationCounts.awaitingReply} awaiting reply` : ""}`}
                />
              )}
              {area.code === "C16" && <ListRow title="Journal entry testing" href={`${base}/audit/journals`} subtitle="Import the listing and select entries" />}
            </ListRows>
          </Section>
        )}

        {!checklist && (
          <Section title="Test schedules" description="The detailed testing for this area: a listing from the client, tickmarks and evidence against each line, the work done and a conclusion.">
            {scheduleList.length > 0 ? (
              <ListRows>
                {scheduleList.map((s) => {
                  const unexplained = s.hasConclusion && s.differenceMinor !== null && s.differenceMinor !== 0 && s.toFinish && s.reviewed;
                  return (
                    <ListRow
                      key={s.id}
                      title={`${s.reference} ${s.title}`}
                      href={`${base}/audit/${area.code}/schedules/${s.id}`}
                      subtitle={formatAmount(s.totalMinor)}
                      meta={
                        <span className="flex flex-wrap items-center justify-end gap-2">
                          {s.differenceMinor !== null && s.differenceMinor !== 0 && <Badge tone="danger">Difference {formatAmount(s.differenceMinor)}</Badge>}
                          {s.untestedKeyItems > 0 && <Badge tone="warning">{count(s.untestedKeyItems, "key item")} not tested</Badge>}
                          {!s.hasConclusion ? <Badge tone="warning">No conclusion</Badge> : !s.reviewed ? <Badge tone="warning">Not reviewed</Badge> : s.selfReviewed ? <Badge tone="warning">Self-reviewed</Badge> : <Badge tone="success">Reviewed</Badge>}
                          {unexplained && <Badge tone="danger">Difference not explained</Badge>}
                        </span>
                      }
                    />
                  );
                })}
              </ListRows>
            ) : (
              <p className="text-sm text-ink-muted">No schedules yet.</p>
            )}
            {open && auditOn && (
              <div className="mt-4 space-y-3">
                <Disclosure summary="Start a schedule">
                  <ActionForm action={createScheduleAction} fields={{ engagementId: id, areaCode: area.code }}>
                    <div className="flex flex-wrap items-end gap-3">
                      <label className={fieldLabel}>
                        Title
                        <input name="title" required maxLength={200} placeholder="For example: Receivables listing" className={`${ctl} w-72`} />
                      </label>
                      {(areaDef?.groups.length ?? 0) > 0 && (
                        <label className={fieldLabel}>
                          Agrees to the balance of
                          <select name="groupCode" className={ctl} defaultValue={areaDef?.groups[0]}>
                            <option value="">No balance to agree to</option>
                            {areaDef?.groups.map((g) => (
                              <option key={g} value={g}>
                                {GROUP_BY_CODE.get(g)?.name ?? g}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      <label className="flex min-h-10 items-center gap-2 text-sm text-ink">
                        <input type="checkbox" name="fromTrialBalance" className="size-4" /> Start from the trial balance accounts
                      </label>
                      <Button variant="primary">Start a schedule</Button>
                    </div>
                  </ActionForm>
                </Disclosure>
                {engagement.priorEngagementId && (
                  <ActionForm action={bringForwardAction} fields={{ engagementId: id }}>
                    <Button variant="secondary">Bring forward last year&apos;s schedules</Button>
                    <p className="mt-1 text-sm text-ink-muted">Copies every schedule from the prior-year engagement that has not been brought forward yet: lines with last year&apos;s amounts as comparatives, no tickmarks, conclusions or reviews.</p>
                  </ActionForm>
                )}
              </div>
            )}
          </Section>
        )}

        {procedures.length === 0 ? (
          <EmptyState
            title={checklist ? "This checklist is not loaded" : "No programme is loaded for this area"}
            description={checklist ? "This checklist is loaded when the audit is turned on." : "Assess this area's risks to load its programme."}
            action={
              !checklist && (
                <LinkButton href={`${base}/audit`} variant="primary">
                  Go to audit planning
                </LinkButton>
              )
            }
          />
        ) : (
          <>
            {!checklist && overview?.materiality && <SamplingCalculator performanceMaterialityMinor={overview.materiality.performanceMinor} />}

            <Section title={checklist ? "Steps" : "Procedures"} description={`${completed} of ${procedures.length} ${noun} completed, ${reviewedCount} reviewed.`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <nav aria-label={`Filter ${noun}`}>
                  <ul className="flex flex-wrap gap-2">
                    {chips.map((c) => {
                      const active = show === c.key;
                      return (
                        <li key={c.key}>
                          <Link
                            href={here(c.key)}
                            aria-current={active ? "true" : undefined}
                            className={`inline-flex min-h-10 items-center rounded-full border px-4 text-sm font-medium ${active ? "border-accent bg-accent text-surface" : "border-border-strong bg-surface text-ink hover:bg-surface-muted"}`}
                          >
                            {c.label} {c.n}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </nav>
                {open && auditOn && reviewer && waiting > 0 && (
                  <ActionForm action={reviewAreaAction} fields={{ engagementId: id, areaCode: area.code }}>
                    <Button variant="secondary">Review all {waiting} outstanding</Button>
                    <p className="mt-1 text-sm text-ink-muted">Your own work is skipped unless the firm has no other reviewer.</p>
                  </ActionForm>
                )}
              </div>
              <p role="status" className="mt-3 text-sm text-ink-muted">
                {procedureResults(view.shown, view.total, noun)}
              </p>

              {view.rows.length === 0 ? (
                <div className="mt-3">
                  <EmptyState
                    title={`No ${noun} match`}
                    description="Nothing fits this filter."
                    action={
                      <LinkButton href={here("all")} variant="secondary">
                        Show all
                      </LinkButton>
                    }
                  />
                </div>
              ) : (
                <ul className="mt-3 space-y-4">
                  {view.rows.map((p) => {
                    const c = procedureControls(p, ctx);
                    const work = workPill(p);
                    const rev = reviewPill(p);
                    const attached = files.filter((w) => w.targetKind === "procedure" && w.target === p.id);
                    return (
                      <li key={p.id}>
                        <Card>
                          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                            <div>
                              <h3 className="font-semibold">
                                {p.templateId}
                                {p.firmAdded && (
                                  <Badge tone="info" className="ml-2 align-middle">
                                    {ADDED_LABEL}
                                  </Badge>
                                )}
                                {p.firmWording && (
                                  <Badge tone="info" className="ml-2 align-middle">
                                    {FIRM_WORDING_LABEL}
                                  </Badge>
                                )}
                              </h3>
                              {p.assertions && (
                                <p className="text-sm text-ink-muted">
                                  <Badge tone="neutral" className="mr-2">
                                    {TIER_LABEL[p.tier]}
                                  </Badge>
                                  Assertions: {p.assertions}
                                </p>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge tone={work.tone}>{work.label}</Badge>
                              {rev && <Badge tone={rev.tone}>{rev.label}</Badge>}
                            </div>
                          </div>
                          {p.performedByName && (
                            <p className="mt-1 text-sm text-ink-muted">
                              Done by {p.performedByName} on {p.performedAt}
                            </p>
                          )}
                          {(p.firmWording || p.firmAdded) && <p className="mt-3 text-sm font-medium text-ink-muted">{p.firmAdded ? ADDED_NOTE : FIRM_WORDING_NOTE}</p>}
                          <p className={p.firmWording || p.firmAdded ? "mt-1 text-base" : "mt-3 text-base"}>{p.body}</p>
                          {checklist && coveredInQuestionnaire(p.templateId) && (
                            <p className="mt-1 text-sm">
                              <Link href={`/engagements/${id}/audit/questionnaire#${coveredInQuestionnaire(p.templateId)!.anchor}`} className="font-medium text-accent underline-offset-2 hover:underline">
                                Covered in {coveredInQuestionnaire(p.templateId)!.label}
                              </Link>{" "}
                              <span className="text-ink-muted">(an unreviewed draft). The questionnaire does not complete this step: record the work and complete it here.</span>
                            </p>
                          )}
                          <p className="mt-1 text-sm text-ink-muted">
                            Evidence expected: {p.evidence} · Reference: {p.reference}
                          </p>

                          <div className="mt-3">
                            {attached.length > 0 && (
                              <ul className="space-y-2">
                                {attached.map((w) => (
                                  <li key={w.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                                    <span className="text-ink-muted">Evidence:</span>
                                    <a href={`${base}/files/${w.id}`} className="font-medium text-accent hover:underline">
                                      {w.fileName}
                                    </a>
                                    <span className="text-ink-muted">
                                      {w.uploadedByName} {w.uploadedAt}
                                    </span>
                                    {c.canRemove(w.uploadedBy) && (
                                      <ActionForm action={removeWorkingPaperAction} fields={{ paperId: w.id }}>
                                        <Button variant="danger" size="sm">
                                          Remove
                                        </Button>
                                      </ActionForm>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            )}
                            {c.attach && (
                              <UploadForm engagementId={id} fields={{ supports: `procedure:${p.id}`, description: "" }} className="mt-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <FileInput
                                    maxBytes={limit.bytes}
                                    label={`Evidence file for ${p.templateId}`}
                                    accept={papers.ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(",")}
                                    className="text-sm text-ink file:mr-3 file:min-h-8 file:cursor-pointer file:rounded-md file:border file:border-border-strong file:bg-surface file:px-3 file:text-sm file:font-medium file:text-ink hover:file:bg-surface-muted"
                                  />
                                  <Button variant="secondary" size="sm">
                                    Attach evidence
                                  </Button>
                                </div>
                              </UploadForm>
                            )}
                          </div>

                          {c.edit && p.status === "open" ? (
                            <ActionForm action={updateProcedureAction} fields={{ procedureId: p.id }} className="mt-4">
                              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <label className={fieldLabel}>
                                  Work done
                                  <textarea name="workDone" rows={3} maxLength={5000} defaultValue={p.workDone ?? ""} className={`${ctl} min-h-24`} />
                                </label>
                                <label className={fieldLabel}>
                                  Conclusion
                                  <textarea name="conclusion" rows={3} maxLength={5000} defaultValue={p.conclusion ?? ""} className={`${ctl} min-h-24`} />
                                </label>
                              </div>
                              <div className="mt-3 flex flex-wrap items-center gap-2">
                                <Button name="status" value="done" variant="primary">
                                  Mark completed
                                </Button>
                                <Button name="status" value="open" variant="secondary">
                                  Save without completing
                                </Button>
                                <span className="sm:ml-6">
                                  <Button name="status" value="na" variant="secondary">
                                    Not applicable
                                  </Button>
                                </span>
                              </div>
                            </ActionForm>
                          ) : (
                            <div className="mt-4 text-sm">
                              <p>
                                <span className="font-medium">Work done:</span> {p.workDone ?? "None recorded"}
                              </p>
                              <p className="mt-1">
                                <span className="font-medium">Conclusion:</span> {p.conclusion ?? "None recorded"}
                              </p>
                              {c.edit && (
                                // The same form as before: the fields carry the recorded text, so reopening changes only the status.
                                <ActionForm action={updateProcedureAction} fields={{ procedureId: p.id, workDone: p.workDone ?? "", conclusion: p.conclusion ?? "" }} className="mt-3">
                                  <Button name="status" value="open" variant="secondary" size="sm">
                                    Reopen
                                  </Button>
                                </ActionForm>
                              )}
                              {c.lockedByReview && <p className="mt-2 text-ink-muted">Reviewed work cannot be changed. A reviewer withdraws the review first.</p>}
                            </div>
                          )}

                          {c.workedOnIt === "waiting" && (
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              <Badge tone="neutral">Waiting for another reviewer</Badge>
                              <span className="text-sm text-ink-muted">You did this work, so another reviewer signs it off.</span>
                            </div>
                          )}
                          {c.review && (
                            <ActionForm action={reviewProcedureAction} fields={{ procedureId: p.id, withdraw: p.reviewedAt ? "true" : "false" }} className="mt-3">
                              <Button variant={c.review === "review" ? "primary" : "secondary"} size="sm">
                                {c.review === "review" ? "Review" : "Withdraw review"}
                              </Button>
                            </ActionForm>
                          )}
                          {c.workedOnIt === "self" && <p className="mt-2 text-sm text-ink-muted">You did this work, so the review will be recorded as self-reviewed.</p>}
                        </Card>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Section>
          </>
        )}
      </div>
    </div>
  );
}
