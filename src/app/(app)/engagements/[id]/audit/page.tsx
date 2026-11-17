import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import * as repo from "@/server/repo";
import * as audit from "@/server/audit";
import { ASSERTIONS, BENCHMARKS, computeMateriality, STAGES, LIBRARY_STATUS, PERFORMANCE_RANGE, RISK_LEVELS, TRIVIAL_MAX, type Benchmark } from "@/domain/audit";
import { formatAmount } from "@/domain/money";
import { ActionForm } from "@/app/action-form";
import { bringForwardAction } from "@/app/schedule-actions";
import { addMisstatementAction, approveRiskAssessmentAction, setAreaRisksAction, setAuditEnabledAction, setMaterialityAction, setMisstatementCorrectedAction } from "@/app/audit-actions";
import { Badge } from "@/ui/badge";
import { Button, LinkButton, buttonClass } from "@/ui/button";
import { ctl, ctlWarn, Disclosure, fieldLabel } from "@/ui/controls";
import { Callout, EmptyState, ProgressBar } from "@/ui/feedback";
import { Card, ListRow, ListRows, PageHeader, Section, Stat } from "@/ui/layout";
import { Table, TCell, THead, TRow } from "@/ui/table";
import { approvalView, checklistPill, mayDo, planningSentence, planningSteps, programmeProgress, riskSummary, stepTone, waitingFor } from "@/ui/audit-view";
import { ExpandRow } from "@/ui/area-row";
import { count, plainCount } from "@/ui/text";
import { EngagementNav } from "../nav";

export const dynamic = "force-dynamic";

export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const session = await getSession();
  const { engagement, overview } = await withFirm(await getDb(), session.firmId, async (tx) => ({
    engagement: await repo.getEngagement(tx, id),
    overview: await audit.getAuditOverview(tx, id),
  }));
  if (!engagement || !overview) notFound();

  const open = engagement.status === "open";
  const reviewer = mayDo(session.role, "reviewer");
  const approval = overview.approval;
  const m = overview.materiality;
  const guideWarnings = m ? computeMateriality(m).warnings : [];
  const assertionLabel = new Map(ASSERTIONS.map((a) => [a.code, a.label]));
  const levelLabel = new Map(RISK_LEVELS.map((l) => [l.code, l.label]));
  const base = `/engagements/${id}`;
  const areasAssessed = overview.areas.filter((a) => a.assessed).length;
  const planning = {
    role: session.role,
    open,
    materialitySet: m !== null,
    materialityStale: overview.materialityStale,
    areasAssessed,
    areasTotal: overview.areas.length,
    approval: approval.state,
    approvalNotReady: approval.notReady,
  };
  const approvalShown = approvalView({ state: approval.state, notReady: approval.notReady, open, role: session.role });
  const inputCls = `${ctl}`;

  return (
    <div className="py-8 text-ink">
      <PageHeader
        breadcrumb={[{ label: "All engagements", href: "/" }]}
        title="Audit planning"
        meta={
          <>
            <span>{engagement.clientName}</span>
            <span aria-hidden="true">·</span>
            <span>
              {engagement.periodStart} to {engagement.periodEnd}
            </span>
          </>
        }
        subtitle={planningSentence({ enabled: overview.enabled, materialitySet: m !== null, materialityStale: overview.materialityStale, areasAssessed, areasTotal: overview.areas.length, approval: approval.state })}
      />
      <EngagementNav id={id} current="audit" status={engagement.status} />

      <div className="mt-6 space-y-8">
        <Callout variant="draft" title={`Methodology content: ${LIBRARY_STATUS}`}>
          The procedures loaded here come from the draft library in the repository&apos;s docs folder. Do not rely on them for a real audit until a qualified person has reviewed and approved that library.
        </Callout>

        {overview.areas.length === 0 ? (
          <EmptyState
            title="Nothing to plan yet"
            description="Import a trial balance and map its accounts before planning the audit."
            action={
              <LinkButton href={`${base}/trial-balance`} variant="primary">
                Go to the trial balance
              </LinkButton>
            }
          />
        ) : !overview.enabled ? (
          <Card
            title="This engagement is not being audited"
            description={open ? "Turning the audit on lets you set materiality, assess risk and load audit programmes. Accounts-preparation engagements can leave it off." : "The audit was not turned on for this engagement before it was locked."}
          >
            {open ? (
              reviewer ? (
                <ActionForm action={setAuditEnabledAction} fields={{ engagementId: id, on: "true" }}>
                  <Button variant="primary">Turn the audit on</Button>
                </ActionForm>
              ) : (
                <Badge tone="neutral">Waiting for a reviewer or partner to turn the audit on</Badge>
              )
            ) : undefined}
          </Card>
        ) : (
          <>
            {overview.selfReviewed > 0 && (
              <Callout variant="warning" title="Reviewed by the person who did the work">
                {count(overview.selfReviewed, "procedure or checklist step", "procedures and checklist steps")} {overview.selfReviewed === 1 ? "was" : "were"} reviewed by the person who did the work, because the firm has no other reviewer. They had no second person. This is shown for the partner&apos;s attention and does not hold up the lock.
              </Callout>
            )}

            <Section title="Planning steps" description="Unfinished audit work holds up the lock.">
              <ListRows>
                {planningSteps(planning).map((s) => (
                  <ListRow
                    key={s.key}
                    title={s.title}
                    href={s.anchor}
                    subtitle={s.waiting ?? (s.detail ? plainCount(s.detail) : undefined)}
                    meta={<Badge tone={stepTone(s)}>{s.label}</Badge>}
                  />
                ))}
              </ListRows>
            </Section>

            <Section title="Materiality" id="materiality">
              {m ? (
                <div className="space-y-3">
                  <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <li>
                      <Stat label="Overall materiality" value={formatAmount(m.overallMinor)} hint={`${m.percentageBp / 100}% of ${BENCHMARKS[m.benchmark].label.toLowerCase()} (${formatAmount(m.benchmarkAmountMinor)})`} />
                    </li>
                    <li>
                      <Stat label="Performance materiality" value={formatAmount(m.performanceMinor)} hint={`${m.performancePct}% of overall`} />
                    </li>
                    <li>
                      <Stat label="Clearly trivial below" value={formatAmount(m.trivialMinor)} hint={`${m.trivialPct}% of overall`} />
                    </li>
                  </ul>
                  {overview.materialityStale && (
                    <Callout variant="danger" title="Materiality may be out of date">
                      The benchmark figure is now {formatAmount(overview.benchmarks[m.benchmark])}, not the {formatAmount(m.benchmarkAmountMinor)} materiality was based on. Revise materiality, or save it again to confirm it still stands.
                    </Callout>
                  )}
                  {guideWarnings.length > 0 && <Callout variant="warning">Outside the guide ranges: {guideWarnings.join(" ")} Make sure the rationale explains why.</Callout>}
                  <p className="text-sm">
                    <span className="font-medium">Rationale:</span> {m.rationale}{" "}
                    <span className="text-ink-muted">
                      Set by {m.setBy} on {m.setAt}
                      {overview.revisions > 1 ? `; revision ${overview.revisions} (earlier figures are kept in the audit log)` : ""}.
                    </span>
                  </p>
                </div>
              ) : (
                <p className="text-sm text-ink-muted">Materiality has not been set.</p>
              )}
              {open && !reviewer && !m && <p className="mt-3"><Badge tone="neutral">{waitingFor("reviewer")}</Badge></p>}
              {open && reviewer && (
                <Disclosure summary={m ? "Revise materiality" : "Set materiality"} open={!m} className="mt-4">
                  <ActionForm action={setMaterialityAction} fields={{ engagementId: id }}>
                    <div className="flex flex-wrap items-end gap-3">
                      <label className={fieldLabel}>
                        Benchmark
                        <select name="benchmark" defaultValue={m?.benchmark ?? "revenue"} className={inputCls}>
                          {(Object.keys(BENCHMARKS) as Benchmark[]).map((b) => (
                            <option key={b} value={b} disabled={overview.benchmarks[b] <= 0}>
                              {BENCHMARKS[b].label}: {formatAmount(overview.benchmarks[b])} (guide {BENCHMARKS[b].minBp / 100}% to {BENCHMARKS[b].maxBp / 100}%)
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className={fieldLabel}>
                        % of benchmark
                        <input name="percentage" inputMode="decimal" required defaultValue={m ? m.percentageBp / 100 : 1} className={`${inputCls} w-24 text-right`} />
                      </label>
                      <label className={fieldLabel}>
                        Performance % (guide {PERFORMANCE_RANGE.min} to {PERFORMANCE_RANGE.max})
                        <input name="performancePct" inputMode="numeric" required defaultValue={m?.performancePct ?? 75} className={`${inputCls} w-24 text-right`} />
                      </label>
                      <label className={fieldLabel}>
                        Trivial % (guide up to {TRIVIAL_MAX})
                        <input name="trivialPct" inputMode="numeric" required defaultValue={m?.trivialPct ?? 5} className={`${inputCls} w-24 text-right`} />
                      </label>
                    </div>
                    <label className={`${fieldLabel} mt-3`}>
                      Rationale: why this benchmark and these percentages
                      <textarea name="rationale" required minLength={10} maxLength={2000} rows={2} defaultValue={m?.rationale ?? ""} className={`${inputCls} min-h-20`} />
                    </label>
                    <p className="mt-2 text-sm text-ink-muted">The guide ranges are common practice, not a requirement of any standard. A choice outside them is allowed; explain it in the rationale.</p>
                    <Button variant="primary" className="mt-3">
                      {m ? "Save revision" : "Set materiality"}
                    </Button>
                  </ActionForm>
                </Disclosure>
              )}
            </Section>

            <Section
              title="Risk assessment and programmes"
              id="areas"
              description="Rating an area's assertions loads its programme; ratings of moderate or above add procedures. Procedures with work recorded are never removed."
            >
              <ul className="divide-y divide-border rounded-lg border border-border bg-surface shadow-card">
                {overview.areas.map((area) => {
                  const risk = riskSummary({ assessed: area.assessed, fixedRisk: area.fixedRisk, risks: area.risks });
                  const prog = programmeProgress(area);
                  const label = area.fixedRisk ? (open && reviewer && area.procedures === 0 ? "Load programme" : "Details") : open && reviewer ? (area.assessed ? "Change ratings" : "Assess risk") : "View ratings";
                  const head = (
                    <>
                      <h3 className="min-w-0 basis-full font-semibold sm:basis-64">
                        <Link href={`${base}/audit/${area.code}`} className="rounded-sm text-accent hover:underline">
                          {area.code} {area.title}
                        </Link>
                      </h3>
                      <Badge tone={risk.tone}>{risk.label}</Badge>
                      {prog.loaded ? (
                        <span className="flex min-w-40 flex-1 items-center gap-2 sm:max-w-xs">
                          <span className="min-w-16 flex-1">
                            <ProgressBar value={prog.done} max={prog.total} label={`${area.code} programme: ${prog.label}`} showText={false} />
                          </span>
                          <span className="text-sm whitespace-nowrap text-ink-muted">
                            {prog.done} of {prog.total}
                          </span>
                        </span>
                      ) : (
                        <span className="text-sm text-ink-muted">{prog.label}</span>
                      )}
                      {prog.toReview && <Badge tone="warning">{prog.toReview}</Badge>}
                      {prog.toFinish && <Badge tone="warning">{prog.toFinish}</Badge>}
                    </>
                  );
                  return (
                    <ExpandRow key={area.code} head={head} label={label}>
                      {area.fixedRisk ? (
                        <div className="text-sm">
                          <p>
                            Treated as a significant risk on every audit, so there is nothing to rate.{" "}
                            <Link href={`${base}/audit/journals`} className="font-medium text-accent hover:underline">
                              Import the journal listing and select entries to test
                            </Link>
                            .
                          </p>
                          {open && reviewer && area.procedures === 0 && (
                            <ActionForm action={setAreaRisksAction} fields={{ engagementId: id, areaCode: area.code }} className="mt-2">
                              <Button variant="secondary">Load programme</Button>
                            </ActionForm>
                          )}
                        </div>
                      ) : open && reviewer ? (
                        <ActionForm action={setAreaRisksAction} fields={{ engagementId: id, areaCode: area.code }}>
                          <div className="flex flex-wrap items-end gap-3">
                            {area.assertions.map((a) => (
                              <label key={a} className={fieldLabel}>
                                {assertionLabel.get(a)}
                                <select name={`risk-${a}`} required defaultValue={area.risks[a] ?? ""} className={area.risks[a] ? ctl : ctlWarn}>
                                  <option value="" disabled>
                                    Not assessed
                                  </option>
                                  {RISK_LEVELS.map((l) => (
                                    <option key={l.code} value={l.code}>
                                      {l.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            ))}
                            <Button variant="primary">Save and load programme</Button>
                          </div>
                        </ActionForm>
                      ) : (
                        <div className="text-sm">
                          <p>{area.assessed ? area.assertions.map((a) => `${assertionLabel.get(a)}: ${levelLabel.get(area.risks[a]!)}`).join(" · ") : "Not yet assessed."}</p>
                          {open && !reviewer && !area.assessed && (
                            <p className="mt-1">
                              <Badge tone="neutral">{waitingFor("reviewer")}</Badge>
                            </p>
                          )}
                        </div>
                      )}
                    </ExpandRow>
                  );
                })}
              </ul>
            </Section>

            <Section title="Partner approval of the risk assessment" id="approval">
              <Card>
                <p className="flex flex-wrap items-center gap-2">
                  <Badge tone={approvalShown.tone}>{approvalShown.label}</Badge>
                  <span className="text-sm">
                    {approval.state === "current" && `Approved by ${approval.approvedBy} on ${approval.approvedAt}.`}
                    {approval.state === "lapsed" && `Approved by ${approval.approvedBy} on ${approval.approvedAt}, but materiality, a risk rating or the areas in scope have changed since.`}
                    {approval.state === "none" && (open ? "The methodology expects approval before fieldwork starts; the engagement cannot be locked without it." : "No approval was recorded before this engagement was locked.")}
                  </span>
                </p>
                <p className="mt-2 text-sm text-ink-muted">The approval covers materiality and the risk ratings above, as recorded here. It lapses by itself if any of them changes.</p>
                {approvalShown.note && <p className="mt-2 text-sm">{plainCount(approvalShown.note)}</p>}
                {approvalShown.action === "approve" && (
                  <ActionForm action={approveRiskAssessmentAction} fields={{ engagementId: id }} className="mt-3">
                    <Button variant="primary">{approval.state === "lapsed" ? "Approve again" : "Approve risk assessment"}</Button>
                  </ActionForm>
                )}
                {approvalShown.action === "waiting" && <p className="mt-3"><Badge tone="neutral">{waitingFor("partner")}</Badge></p>}
              </Card>
            </Section>

            <Section
              title="Checklists"
              description="Every step applies to every audit, except in the checklists marked optional. Only a reviewer or partner can mark a required step not applicable, and only a partner can complete a partner's sign-off step."
            >
              <div className="space-y-3">
                {STAGES.map((stage) => {
                  const items = overview.checklists.filter((c) => c.stage === stage.code);
                  const steps = items.reduce((n, c) => n + c.steps, 0);
                  const done = items.reduce((n, c) => n + c.completed, 0);
                  const toReview = items.reduce((n, c) => n + c.unreviewed, 0);
                  const stagePill = checklistPill({ steps, completed: done, unreviewed: toReview });
                  // Open when something here needs attention: work to review, or steps started and not finished.
                  const active = toReview > 0 || (done > 0 && done < steps);
                  // A stage with no checklist loaded (the audit has not been turned on) is one line, not an empty "0 of 0" row.
                  if (steps === 0) {
                    return (
                      <p key={stage.code} className="rounded-lg border border-dashed border-border-strong px-4 py-3 text-sm">
                        <span className="font-semibold text-ink">{stage.label}</span>{" "}
                        <span className="text-ink-muted">No checklist is loaded for this stage. Checklists load when the audit is turned on.</span>
                      </p>
                    );
                  }
                  return (
                    <details key={stage.code} open={active} className="rounded-lg border border-border bg-surface shadow-card">
                      <summary className="flex min-h-12 cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 font-semibold">
                        <span>{stage.label}</span>
                        <span className="text-sm font-normal text-ink-muted">
                          {done} of {steps}
                        </span>
                        {stagePill && <Badge tone={stagePill.tone}>{stagePill.label}</Badge>}
                      </summary>
                      <div className="border-t border-border">
                        <ListRows className="rounded-none border-0">
                          {items.map((c) => {
                            const pill = checklistPill(c);
                            return (
                              <ListRow
                                key={c.code}
                                title={`${c.code} ${c.title}`}
                                href={`${base}/audit/${c.code}`}
                                meta={
                                  <span className="flex flex-wrap items-center justify-end gap-2">
                                    <span className="whitespace-nowrap">
                                      {c.completed} of {c.steps}
                                    </span>
                                    {pill && <Badge tone={pill.tone}>{pill.label}</Badge>}
                                  </span>
                                }
                              />
                            );
                          })}
                        </ListRows>
                      </div>
                    </details>
                  );
                })}
              </div>
            </Section>

            <Section
              title="Summary of misstatements"
              id="misstatements"
              description={`Record every misstatement found, other than those clearly trivial${m ? ` (below ${formatAmount(m.trivialMinor)})` : ""}. Amounts are the effect on profit before tax.`}
            >
              <div className="space-y-4">
                {m ? (
                  overview.misstatements.exceedsMateriality ? (
                    <Callout variant="danger" title="Uncorrected misstatements reach materiality">
                      The net uncorrected misstatements reach overall materiality of {formatAmount(m.overallMinor)}. The engagement cannot be locked until they are corrected; modified opinions are not yet supported.
                    </Callout>
                  ) : (
                    <Callout variant="info" title="Below materiality">
                      The net uncorrected misstatements are below overall materiality of {formatAmount(m.overallMinor)}. Consider also their nature, any offsetting, and items from prior periods.
                    </Callout>
                  )
                ) : (
                  <p className="text-sm text-ink-muted">Set materiality to compare the uncorrected misstatements against it.</p>
                )}
                {overview.misstatements.items.length > 0 && (
                  <Table caption="Misstatements">
                    <THead>
                      <TRow>
                        <TCell header="col">Misstatement</TCell>
                        <TCell header="col">Type</TCell>
                        <TCell header="col" numeric>
                          Profit overstated / (understated)
                        </TCell>
                        <TCell header="col">Status</TCell>
                      </TRow>
                    </THead>
                    <tbody>
                      {overview.misstatements.items.map((x) => (
                        <TRow key={x.id} className="align-top">
                          <TCell>
                            {x.description}
                            <div className="text-sm text-ink-muted">
                              {x.recordedBy} on {x.recordedAt}
                            </div>
                          </TCell>
                          <TCell>
                            <Badge tone="neutral" className="capitalize">
                              {x.kind}
                            </Badge>
                          </TCell>
                          <TCell numeric>{formatAmount(x.amountMinor)}</TCell>
                          <TCell>
                            <Badge tone={x.corrected ? "success" : "warning"}>{x.corrected ? "Corrected" : "Uncorrected"}</Badge>
                            {open && reviewer && (
                              <ActionForm action={setMisstatementCorrectedAction} fields={{ misstatementId: x.id, corrected: String(!x.corrected) }} className="mt-2">
                                <Button variant="secondary" size="sm">
                                  {x.corrected ? "Mark uncorrected" : "Mark corrected"}
                                </Button>
                              </ActionForm>
                            )}
                          </TCell>
                        </TRow>
                      ))}
                      <TRow className="font-semibold">
                        <TCell colSpan={2}>Uncorrected, net</TCell>
                        <TCell numeric>{formatAmount(overview.misstatements.uncorrectedNetMinor)}</TCell>
                        <TCell className="font-normal text-ink-muted">ignoring direction: {formatAmount(overview.misstatements.uncorrectedGrossMinor)}</TCell>
                      </TRow>
                    </tbody>
                  </Table>
                )}
                {open && (
                  <Disclosure summary="Record a misstatement">
                    <ActionForm action={addMisstatementAction} fields={{ engagementId: id }}>
                      <div className="flex flex-wrap items-end gap-3">
                        <label className={`${fieldLabel} min-w-64 flex-1`}>
                          Description
                          <input name="description" required minLength={5} maxLength={1000} className={inputCls} />
                        </label>
                        <label className={fieldLabel}>
                          Type
                          <select name="kind" defaultValue="factual" className={inputCls}>
                            <option value="factual">Factual</option>
                            <option value="judgemental">Judgemental</option>
                            <option value="projected">Projected</option>
                          </select>
                        </label>
                        <label className={fieldLabel}>
                          Amount
                          <input name="amount" inputMode="decimal" required className={`${inputCls} w-36 text-right`} />
                        </label>
                        <label className={fieldLabel}>
                          Effect on profit
                          <select name="direction" defaultValue="overstated" className={inputCls}>
                            <option value="overstated">Profit overstated</option>
                            <option value="understated">Profit understated</option>
                          </select>
                        </label>
                        <Button variant="primary">Record</Button>
                      </div>
                    </ActionForm>
                  </Disclosure>
                )}
              </div>
            </Section>

            <Section title="Other audit work">
              <div className="flex flex-wrap gap-2">
                <LinkButton href={`${base}/audit/letters`}>Engagement and representation letters</LinkButton>
                <LinkButton href={`${base}/audit/analytics`}>Analytical review and ratios</LinkButton>
                <LinkButton href={`${base}/audit/confirmations`}>External confirmations</LinkButton>
                <a href={`${base}/audit/schedules-export`} className={buttonClass("secondary")}>
                  Export all test schedules (Excel)
                </a>
              </div>
              {open && engagement.priorEngagementId && (
                <ActionForm action={bringForwardAction} fields={{ engagementId: id }} className="mt-4">
                  <Button variant="secondary">Bring forward last year&apos;s schedules</Button>
                  <p className="mt-1 text-sm text-ink-muted">Copies the prior-year engagement&apos;s test schedules that have not been brought forward yet, as a starting point.</p>
                </ActionForm>
              )}
            </Section>

            {open && reviewer && (
              <Card title="Audit setting" description="The audit can be turned off only while no work has been recorded on any procedure.">
                <ActionForm action={setAuditEnabledAction} fields={{ engagementId: id, on: "false" }}>
                  <Button variant="danger">Turn the audit off</Button>
                </ActionForm>
              </Card>
            )}
          </>
        )}

        <p className="text-sm text-ink-muted">Not yet in the product: modified audit opinions and the auditor&apos;s report.</p>
      </div>
    </div>
  );
}
