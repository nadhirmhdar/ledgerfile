import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import * as repo from "@/server/repo";
import { getPlanningOnFile, getQuestionnaire } from "@/server/planning-answers";
import { BENCHMARKS } from "@/domain/audit";
import { formatAmount } from "@/domain/money";
import { answerText, QUESTIONNAIRE_DRAFT, QUESTIONNAIRE_DRAFT_TITLE, STATE_LABEL, type QuestionView } from "@/domain/planning-questions";
import { ActionForm } from "@/app/action-form";
import { confirmPlanningMaterialityAction, rebutRevenuePresumptionAction, reinstateRevenuePresumptionAction, savePlanningAnswerAction } from "@/app/planning-answers-actions";
import { mayDo, waitingFor } from "@/ui/audit-view";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Disclosure } from "@/ui/controls";
import { Callout } from "@/ui/feedback";
import { Field, Select, Textarea } from "@/ui/form";
import { PageHeader, Section, Stat } from "@/ui/layout";
import { count } from "@/ui/text";
import { EngagementNav } from "../../nav";

export const dynamic = "force-dynamic";

/** The control for an answer: a yes or no, one of a list, or free text. */
function valueControl(q: QuestionView, value: string | null, label: string) {
  if (q.type === "text") return <Textarea name="value" required maxLength={2000} rows={3} defaultValue={value ?? ""} />;
  const options = q.type === "yesno" ? [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] : (q.choices ?? []);
  return (
    <Select name="value" required defaultValue={value ?? ""} aria-label={label}>
      <option value="" disabled>
        Choose an answer
      </option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}

function Question({ q, id, canAnswer }: { q: QuestionView; id: string; canAnswer: boolean }) {
  const fields = { engagementId: id, key: q.key };
  const tone = q.state === "overridden" ? "warning" : q.state === "unanswered" || q.state === "suggested" ? (q.mandatory ? "warning" : "neutral") : "success";
  return (
    <li className="px-4 py-4" id={`q-${q.key}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="font-medium">{q.label}</h4>
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-2">
        <Badge tone={tone}>{STATE_LABEL[q.state]}</Badge>
        {q.mandatory && <Badge tone="warning">Mandatory</Badge>}
      </p>
      {q.help && <p className="mt-1 text-sm text-ink-muted">{q.help}</p>}
      {q.stored ? (
        <p className="mt-2 text-sm">
          <span className="font-medium">Answer:</span> {answerText(q, q.stored.value)}{" "}
          <span className="text-ink-muted">
            {q.stored.source === "auto" ? "Suggested by the app and confirmed by" : "Answered by"} {q.stored.by} on {q.stored.at}.
          </span>
          {q.stored.reason && (
            <>
              {" "}
              <span className="font-medium">Reason for the override:</span> {q.stored.reason}
            </>
          )}
        </p>
      ) : null}
      {q.auto && (
        <p className="mt-2 text-sm">
          <span className="font-medium">Suggested by the app:</span> {answerText(q, q.auto.value)} <span className="text-ink-muted">Source: {q.auto.source}</span>
        </p>
      )}

      {canAnswer && q.auto && !q.stored && (
        <ActionForm action={savePlanningAnswerAction} fields={{ ...fields, value: q.auto.value }} className="mt-2">
          <Button variant="secondary">Confirm the suggested answer</Button>
        </ActionForm>
      )}
      {canAnswer && q.auto ? (
        <Disclosure summary={q.stored ? "Change the answer" : "Override the suggestion"} className="mt-3">
          <ActionForm action={savePlanningAnswerAction} fields={fields}>
            <div className="space-y-3">
              <Field label="Answer">{valueControl(q, q.value, q.label)}</Field>
              <Field label="Reason for not using the suggestion" hint="Required when the answer differs from what the app suggested.">
                <Textarea name="reason" maxLength={2000} rows={2} />
              </Field>
              <Button variant="primary">Save the answer</Button>
            </div>
          </ActionForm>
        </Disclosure>
      ) : (
        canAnswer && (
          <ActionForm action={savePlanningAnswerAction} fields={fields} className="mt-3">
            <div className="max-w-2xl space-y-3">
              <Field label={q.stored ? "Change the answer" : "Answer"}>{valueControl(q, q.value, q.label)}</Field>
              <Button variant="primary">{q.stored ? "Save the change" : "Save the answer"}</Button>
            </div>
          </ActionForm>
        )
      )}
      {q.history.length > 1 && (
        <Disclosure summary={`Earlier answers (${q.history.length - 1})`} className="mt-3">
          <ul className="space-y-2 text-sm">
            {q.history.map((h, n) => (
              <li key={`${h.at}-${n}`}>
                {answerText(q, h.value)} <span className="text-ink-muted">{h.source === "auto" ? "Suggested, confirmed" : "Answered"} by {h.by} on {h.at}.</span>
                {h.reason ? <> Reason: {h.reason}</> : null}
                {n === 0 ? <span className="text-ink-muted"> (now in force)</span> : null}
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </li>
  );
}

export default async function QuestionnairePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const session = await getSession();
  const { engagement, q, onFile } = await withFirm(await getDb(), session.firmId, async (tx) => ({
    engagement: await repo.getEngagement(tx, id),
    q: await getQuestionnaire(tx, id),
    onFile: await getPlanningOnFile(tx, id),
  }));
  if (!engagement || !q || !onFile) notFound();

  const open = engagement.status === "open";
  const auditOn = onFile.enabled;
  const canAnswer = open && auditOn;
  const reviewer = mayDo(session.role, "reviewer");
  const partner = mayDo(session.role, "partner");
  const base = `/engagements/${id}/audit`;
  const d = q.derivation;
  const m = onFile.materiality;

  return (
    <div className="py-8 text-ink">
      <PageHeader
        breadcrumb={[{ label: "All engagements", href: "/" }]}
        title="Planning questionnaire"
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
        subtitle={q.mandatoryOpen > 0 ? `${count(q.mandatoryOpen, "mandatory question")} still to answer. This does not hold up the lock.` : "No mandatory question is waiting. This questionnaire does not hold up the lock."}
      />
      <EngagementNav id={id} current="questionnaire" status={engagement.status} archived={engagement.archivedAt !== null} />

      <div className="mt-6 min-w-0 space-y-8">
        <Callout variant="draft" title={QUESTIONNAIRE_DRAFT_TITLE}>
          {QUESTIONNAIRE_DRAFT}
        </Callout>
        {!auditOn && (
          <Callout variant="info">
            The audit is off for this engagement, so answers cannot be saved.{" "}
            <Link href={base} className="font-medium underline">
              Turn it on from the audit planning page
            </Link>
            .
          </Callout>
        )}
        {auditOn && !open && <Callout variant="info">This engagement is locked. The answers are shown as they stand.</Callout>}
        {d.empty && <Callout variant="warning">There is no mapped trial balance yet, so nothing can be filled in or suggested from the figures. Import a trial balance and map its accounts first.</Callout>}

        {q.sections.map((s) => (
          <Section key={s.n} title={`${s.n}. ${s.title} (${s.standards})`} description={s.blurb} id={`section-${s.n}`}>
            {s.n === 8 && s.questions.length === 0 ? (
              <p className="text-sm text-ink-muted">
                No indicator on the firm&apos;s going-concern list is found on the trial balance, so these questions are not mandatory. The list is in the firm&apos;s planning settings: {d.goingConcern.triggers.join(", ").toLowerCase()}.
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border bg-surface shadow-card">
                {s.n === 9 && (
                  <li className="px-4 py-4" id="revenue-presumption">
                    <h4 className="font-medium">Revenue recognition on C13 (occurrence and cut-off)</h4>
                    <p className="mt-1 flex flex-wrap items-center gap-2">
                      <Badge tone={q.revenue.rebutted ? "warning" : "danger"}>{q.revenue.rebutted ? "Rebutted by a partner" : "Significant risk (presumed)"}</Badge>
                    </p>
                    <p className="mt-1 text-sm text-ink-muted">Source: the presumption in ISA 240. It stands unless a partner rebuts it with a recorded reason, and the rebuttal is shown on the review page.</p>
                    {q.revenue.rebutted ? (
                      <p className="mt-2 text-sm">
                        <span className="font-medium">Reason:</span> {q.revenue.reason} <span className="text-ink-muted">Rebutted by {q.revenue.by} on {q.revenue.at}.</span>
                      </p>
                    ) : (
                      <p className="mt-2 text-sm">If a rating for C13 occurrence or cut-off is below significant, the planning page flags it. It is a flag, not a block.</p>
                    )}
                    {canAnswer &&
                      (partner ? (
                        q.revenue.rebutted ? (
                          <ActionForm action={reinstateRevenuePresumptionAction} fields={{ engagementId: id }} className="mt-3">
                            <Button variant="secondary">Put the presumption back</Button>
                          </ActionForm>
                        ) : (
                          <Disclosure summary="Rebut the presumption" className="mt-3">
                            <ActionForm action={rebutRevenuePresumptionAction} fields={{ engagementId: id }}>
                              <div className="max-w-2xl space-y-3">
                                <Field label="Reason the presumption does not apply" hint="Required. It is kept with your name and the date, and shown on the review page.">
                                  <Textarea name="reason" required minLength={10} maxLength={2000} rows={3} />
                                </Field>
                                <Button variant="primary">Rebut the presumption</Button>
                              </div>
                            </ActionForm>
                          </Disclosure>
                        )
                      ) : (
                        <p className="mt-3">
                          <Badge tone="neutral">{waitingFor("partner")}</Badge>
                        </p>
                      ))}
                  </li>
                )}
                {s.n === 9 && (
                  <li className="px-4 py-4">
                    <h4 className="font-medium">Management override of controls on C16</h4>
                    <p className="mt-1">
                      <Badge tone="danger">Significant risk (always)</Badge>
                    </p>
                    <p className="mt-1 text-sm text-ink-muted">Fixed in the methodology (ISA 240): it cannot be rebutted or rated lower.</p>
                  </li>
                )}
                {s.questions.map((qv) => (
                  <Question key={qv.key} q={qv} id={id} canAnswer={canAnswer} />
                ))}
              </ul>
            )}
          </Section>
        ))}

        <Section title="Confirm materiality" description="Writes the suggested materiality as a new revision, with a rationale you can edit first." id="confirm-materiality">
          {m && (
            <p className="mb-3 text-sm">
              <span className="font-medium">On file now:</span> overall {formatAmount(m.overallMinor)}, performance {formatAmount(m.performanceMinor)}, clearly trivial {formatAmount(m.trivialMinor)} ({m.percentageBp / 100}% of {BENCHMARKS[m.benchmark].label.toLowerCase()}), set by {m.setBy} on {m.setAt}.
            </p>
          )}
          {d.benchmark && d.percentage && d.suggested ? (
            <div className="space-y-3">
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <li>
                  <Stat label="Overall materiality" value={formatAmount(d.suggested.overallMinor)} hint={`${d.percentage.bp / 100}% of ${BENCHMARKS[d.benchmark.benchmark].label.toLowerCase()} (${formatAmount(d.benchmark.amountMinor)})`} />
                </li>
                <li>
                  <Stat label="Performance materiality" value={formatAmount(d.suggested.performanceMinor)} hint={`${d.performance.pct}% of overall`} />
                </li>
                <li>
                  <Stat label="Clearly trivial below" value={formatAmount(d.suggested.trivialMinor)} hint={`${d.suggested.trivialPct}% of overall`} />
                </li>
              </ul>
              <p className="text-sm text-ink-muted">Source: the benchmark rules, your answers above and the firm&apos;s planning settings. Confirming does not need the mandatory questions answered, and it changes nothing else.</p>
              {canAnswer && reviewer ? (
                <ActionForm action={confirmPlanningMaterialityAction} fields={{ engagementId: id }}>
                  <div className="max-w-3xl space-y-3">
                    <Field label="Rationale: why this benchmark and these percentages" hint="Proposed from the answers. Edit it so it says what you actually concluded.">
                      <Textarea name="rationale" required minLength={10} maxLength={2000} rows={6} defaultValue={q.rationale} />
                    </Field>
                    <p className="text-sm text-ink-muted">The partner&apos;s approval of the risk assessment lapses when materiality changes, as it does with the form on the planning page.</p>
                    <Button variant="primary">Confirm materiality</Button>
                  </div>
                </ActionForm>
              ) : (
                canAnswer && (
                  <p>
                    <Badge tone="neutral">{waitingFor("reviewer")}</Badge>
                  </p>
                )
              )}
            </div>
          ) : (
            <p className="text-sm text-ink-muted">Nothing can be suggested yet. The form on the planning page still sets materiality.</p>
          )}
        </Section>
      </div>
    </div>
  );
}
