import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import * as repo from "@/server/repo";
import * as audit from "@/server/audit";
import { ASSERTIONS, BENCHMARKS, computeMateriality, STAGES, LIBRARY_STATUS, PERFORMANCE_RANGE, RISK_LEVELS, TRIVIAL_MAX, type Benchmark } from "@/domain/audit";
import { canLock, canReview } from "@/domain/signoff";
import { formatAmount } from "@/domain/money";
import { ActionForm } from "@/app/action-form";
import { bringForwardAction } from "@/app/schedule-actions";
import { addMisstatementAction, approveRiskAssessmentAction, setAreaRisksAction, setAuditEnabledAction, setMaterialityAction, setMisstatementCorrectedAction } from "@/app/audit-actions";
import { EngagementNav } from "../nav";

export const dynamic = "force-dynamic";

const input = "rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900";
const label = "flex flex-col gap-1 text-sm text-slate-700";
const primary = "rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700";
const small = "rounded border border-slate-400 px-2 py-1 text-xs hover:bg-slate-100";

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
  const reviewer = canReview(session.role);
  const partner = canLock(session.role);
  const approval = overview.approval;
  const m = overview.materiality;
  const guideWarnings = m ? computeMateriality(m).warnings : [];
  const assertionLabel = new Map(ASSERTIONS.map((a) => [a.code, a.label]));
  const levelLabel = new Map(RISK_LEVELS.map((l) => [l.code, l.label]));

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 text-slate-900">
      <Link href="/" className="text-sm text-blue-700 underline">All engagements</Link>
      <h1 className="mt-2 text-2xl font-semibold">{engagement.clientName}</h1>
      <p className="mt-1 text-sm text-slate-600">{engagement.periodStart} to {engagement.periodEnd}</p>
      <EngagementNav id={id} current="audit" status={engagement.status} />

      <p role="note" className="mt-6 rounded border border-amber-400 bg-amber-50 px-3 py-2 text-sm">
        <span className="font-semibold">Methodology content: {LIBRARY_STATUS}.</span> The procedures loaded here come from the draft library in the
        repository&apos;s docs folder. Do not rely on them for a real audit until a qualified person has reviewed and approved that library.
      </p>

      {overview.areas.length === 0 ? (
        <p className="mt-6 text-sm text-slate-600">Import a trial balance and map its accounts before planning the audit.</p>
      ) : (
        <>
          <section className="mt-6 rounded border border-slate-200 bg-slate-50 p-4">
            <h2 className="text-base font-semibold">{overview.enabled ? "This engagement is being audited" : "This engagement is not being audited"}</h2>
            <p className="mt-1 text-sm text-slate-600">
              {overview.enabled
                ? "Unfinished audit work holds up the lock. The audit can be turned off only while no work has been recorded on any procedure."
                : "Turn the audit on to set materiality, assess risk and load audit programmes. Accounts-preparation engagements can leave it off."}
            </p>
            {overview.enabled && overview.selfReviewed > 0 && (
              <p role="note" className="mt-2 rounded border border-amber-600 bg-amber-100 px-3 py-2 text-sm text-amber-950">
                {overview.selfReviewed} procedure(s) and checklist step(s) were reviewed by the person who did the work, because the firm has no other reviewer. They had no second person. This is shown for the partner&apos;s attention and does not hold up the lock.
              </p>
            )}
            {open && reviewer ? (
              <ActionForm action={setAuditEnabledAction} fields={{ engagementId: id, on: String(!overview.enabled) }} className="mt-3">
                <button className={overview.enabled ? small : primary}>{overview.enabled ? "Turn audit off" : "Turn audit on"}</button>
              </ActionForm>
            ) : (
              open && <p className="mt-2 text-sm text-slate-600">A reviewer or partner turns the audit on or off.</p>
            )}
          </section>

          {overview.enabled && (
          <>
          <p className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <Link href={`/engagements/${id}/audit/letters`} className="text-blue-700 underline">Engagement letter and representation letter</Link>
            <Link href={`/engagements/${id}/audit/analytics`} className="text-blue-700 underline">Analytical review and ratios</Link>
            <a href={`/engagements/${id}/audit/schedules-export`} className="text-blue-700 underline">Export all test schedules (Excel)</a>
          </p>
          {open && engagement.priorEngagementId && (
            <ActionForm action={bringForwardAction} fields={{ engagementId: id }} className="mt-3">
              <button className={small}>Bring forward last year&apos;s schedules</button>
              <span className="ml-2 text-xs text-slate-600">Copies the prior-year engagement&apos;s test schedules that have not been brought forward yet, as a starting point.</span>
            </ActionForm>
          )}
          <section className="mt-8">
            <h2 className="text-lg font-semibold">Materiality</h2>
            {m ? (
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                {[
                  ["Overall materiality", m.overallMinor, `${m.percentageBp / 100}% of ${BENCHMARKS[m.benchmark].label.toLowerCase()} (${formatAmount(m.benchmarkAmountMinor)})`],
                  ["Performance materiality", m.performanceMinor, `${m.performancePct}% of overall`],
                  ["Clearly trivial below", m.trivialMinor, `${m.trivialPct}% of overall`],
                ].map(([title, amount, basis]) => (
                  <div key={title as string} className="rounded border border-slate-200 p-3">
                    <div className="text-xs text-slate-600">{title}</div>
                    <div className="mt-1 text-xl font-semibold tabular-nums">{formatAmount(amount as number)}</div>
                    <div className="mt-1 text-xs text-slate-600">{basis}</div>
                  </div>
                ))}
                {overview.materialityStale && (
                  <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm sm:col-span-3">
                    The benchmark figure is now {formatAmount(overview.benchmarks[m.benchmark])}, not the {formatAmount(m.benchmarkAmountMinor)} materiality was based on.
                    Revise materiality, or save it again to confirm it still stands.
                  </p>
                )}
                {guideWarnings.length > 0 && (
                  <p className="rounded border border-amber-400 bg-amber-50 px-3 py-2 text-sm sm:col-span-3">
                    Outside the guide ranges: {guideWarnings.join(" ")} Make sure the rationale explains why.
                  </p>
                )}
                <p className="text-sm sm:col-span-3">
                  <span className="font-medium">Rationale:</span> {m.rationale}{" "}
                  <span className="text-xs text-slate-600">
                    Set by {m.setBy} on {m.setAt}
                    {overview.revisions > 1 ? `; revision ${overview.revisions} (earlier figures are kept in the audit log)` : ""}.
                  </span>
                </p>
              </div>
            ) : (
              <p className="mt-2 text-sm text-slate-600">Materiality has not been set.</p>
            )}

            {open && reviewer && (
              <ActionForm action={setMaterialityAction} fields={{ engagementId: id }} className="mt-4 rounded border border-slate-200 bg-slate-50 p-4">
                <h3 className="text-base font-semibold">{m ? "Revise materiality" : "Set materiality"}</h3>
                <div className="mt-3 flex flex-wrap items-end gap-3">
                  <label className={label}>
                    Benchmark
                    <select name="benchmark" defaultValue={m?.benchmark ?? "revenue"} className={input}>
                      {(Object.keys(BENCHMARKS) as Benchmark[]).map((b) => (
                        <option key={b} value={b} disabled={overview.benchmarks[b] <= 0}>
                          {BENCHMARKS[b].label}: {formatAmount(overview.benchmarks[b])} (guide {BENCHMARKS[b].minBp / 100}% to {BENCHMARKS[b].maxBp / 100}%)
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={label}>
                    % of benchmark
                    <input name="percentage" inputMode="decimal" required defaultValue={m ? m.percentageBp / 100 : 1} className={`${input} w-24 text-right`} />
                  </label>
                  <label className={label}>
                    Performance % (guide {PERFORMANCE_RANGE.min} to {PERFORMANCE_RANGE.max})
                    <input name="performancePct" inputMode="numeric" required defaultValue={m?.performancePct ?? 75} className={`${input} w-24 text-right`} />
                  </label>
                  <label className={label}>
                    Trivial % (guide up to {TRIVIAL_MAX})
                    <input name="trivialPct" inputMode="numeric" required defaultValue={m?.trivialPct ?? 5} className={`${input} w-24 text-right`} />
                  </label>
                </div>
                <label className={`${label} mt-3`}>
                  Rationale: why this benchmark and these percentages
                  <textarea name="rationale" required minLength={10} maxLength={2000} rows={2} defaultValue={m?.rationale ?? ""} className={input} />
                </label>
                <p className="mt-2 text-xs text-slate-600">
                  The guide ranges are common practice, not a requirement of any standard. A choice outside them is allowed; explain it in the rationale.
                </p>
                <button className={`${primary} mt-3`}>{m ? "Save revision" : "Set materiality"}</button>
              </ActionForm>
            )}
            {open && !reviewer && <p className="mt-2 text-sm text-slate-600">A reviewer or partner sets materiality and assesses risk.</p>}
          </section>

          <section className="mt-10">
            <h2 className="text-lg font-semibold">Risk assessment and programmes</h2>
            <p className="mt-1 text-sm text-slate-600">
              Rate each assertion for each area. Saving loads the area&apos;s programme: core procedures always, extended procedures for assertions rated moderate or
              above, and significant-risk procedures for assertions flagged significant. Procedures with work recorded are never removed.
            </p>

            {overview.areas.map((area) => (
              <div key={area.code} className="mt-4 rounded border border-slate-200 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-semibold">
                    {area.code} {area.title}
                  </h3>
                  <span className="text-sm">
                    {area.procedures > 0 ? (
                      <Link href={`/engagements/${id}/audit/${area.code}`} className="text-blue-700 underline">
                        Programme: {area.completed} of {area.procedures} completed
                        {area.unreviewed > 0 && `, ${area.unreviewed} to review`}
                      </Link>
                    ) : (
                      <span className="text-slate-600">{area.assessed ? "Programme not loaded" : "Not assessed"}</span>
                    )}
                  </span>
                </div>
                {area.schedules > 0 && (
                  <p className={`mt-1 text-sm ${area.schedulesToFinish > 0 ? "text-amber-800" : "text-emerald-800"}`}>
                    {area.schedules} schedule(s), {area.schedulesToFinish} to finish
                  </p>
                )}
                <p className="mt-1 text-sm text-slate-600">{area.objective}</p>

                {area.fixedRisk ? (
                  <div className="mt-3 text-sm">
                    <p>
                      Treated as a significant risk on every audit, so there is nothing to rate.{" "}
                      <Link href={`/engagements/${id}/audit/journals`} className="text-blue-700 underline">Import the journal listing and select entries to test</Link>.
                    </p>
                    {open && reviewer && area.procedures === 0 && (
                      <ActionForm action={setAreaRisksAction} fields={{ engagementId: id, areaCode: area.code }} className="mt-2">
                        <button className={small}>Load programme</button>
                      </ActionForm>
                    )}
                  </div>
                ) : open && reviewer ? (
                  <ActionForm action={setAreaRisksAction} fields={{ engagementId: id, areaCode: area.code }} className="mt-3">
                    <div className="flex flex-wrap items-end gap-3">
                      {area.assertions.map((a) => (
                        <label key={a} className="flex flex-col gap-1 text-xs text-slate-700">
                          {assertionLabel.get(a)}
                          <select name={`risk-${a}`} required defaultValue={area.risks[a] ?? ""} className={`${input} ${area.risks[a] ? "" : "border-amber-500 bg-amber-50"}`}>
                            <option value="" disabled>Not assessed</option>
                            {RISK_LEVELS.map((l) => (
                              <option key={l.code} value={l.code}>{l.label}</option>
                            ))}
                          </select>
                        </label>
                      ))}
                      <button className={small}>Save and load programme</button>
                    </div>
                  </ActionForm>
                ) : (
                  <p className="mt-3 text-sm">
                    {area.assessed
                      ? area.assertions.map((a) => `${assertionLabel.get(a)}: ${levelLabel.get(area.risks[a]!)}`).join(" · ")
                      : "Not yet assessed."}
                  </p>
                )}
              </div>
            ))}

            <div className={`mt-6 rounded border p-4 ${approval.state === "current" ? "border-green-600 bg-green-50" : "border-amber-400 bg-amber-50"}`}>
              <h3 className="text-base font-semibold">Partner approval of the risk assessment</h3>
              <p className="mt-1 text-sm">
                {approval.state === "current" && `Approved by ${approval.approvedBy} on ${approval.approvedAt}.`}
                {approval.state === "lapsed" &&
                  `Approved by ${approval.approvedBy} on ${approval.approvedAt}, but materiality, a risk rating or the areas in scope have changed since. It needs approving again.`}
                {approval.state === "none" &&
                  (open
                    ? "Not yet approved. The methodology expects approval before fieldwork starts; the engagement cannot be locked without it."
                    : "No approval was recorded before this engagement was locked.")}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                The approval covers materiality and the risk ratings above, as recorded here. It lapses by itself if any of them changes.
              </p>
              {open && approval.state !== "current" &&
                (approval.notReady ? (
                  <p className="mt-2 text-sm text-slate-700">{approval.notReady}</p>
                ) : partner ? (
                  <ActionForm action={approveRiskAssessmentAction} fields={{ engagementId: id }} className="mt-3">
                    <button className={primary}>{approval.state === "lapsed" ? "Approve again" : "Approve risk assessment"}</button>
                  </ActionForm>
                ) : (
                  <p className="mt-2 text-sm text-slate-700">Ready for the partner to approve.</p>
                ))}
            </div>
          </section>

          <section className="mt-10">
            <h2 className="text-lg font-semibold">Checklists</h2>
            <p className="mt-1 text-sm text-slate-600">
              Every step applies to every audit, except in the checklists marked optional. Only a reviewer or partner can mark a required step not applicable, and a step that is the partner&apos;s sign-off can be completed only by a partner. File assembly and archiving, which follow the report, are not included yet.
            </p>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {STAGES.map((stage) => (
                <div key={stage.code} className="rounded border border-slate-200 p-4">
                  <h3 className="font-semibold">{stage.label}</h3>
                  <ul className="mt-2 space-y-1 text-sm">
                    {overview.checklists
                      .filter((c) => c.stage === stage.code)
                      .map((c) => (
                        <li key={c.code} className="flex justify-between gap-3">
                          <Link href={`/engagements/${id}/audit/${c.code}`} className="text-blue-700 underline">
                            {c.code} {c.title}
                          </Link>
                          <span className={`whitespace-nowrap tabular-nums ${c.steps > 0 && c.completed === c.steps ? "text-emerald-800" : "text-slate-600"}`}>
                            {c.completed} / {c.steps}
                            {c.unreviewed > 0 && <span className="ml-2 text-amber-800">{c.unreviewed} to review</span>}
                          </span>
                        </li>
                      ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-10">
            <h2 className="text-lg font-semibold">Summary of misstatements</h2>
            <p className="mt-1 text-sm text-slate-600">
              Record every misstatement found, other than those clearly trivial{m ? ` (below ${formatAmount(m.trivialMinor)})` : ""}. Amounts are the effect on profit before tax.
            </p>
            {overview.misstatements.items.length > 0 && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-300 text-slate-600">
                    <tr>
                      <th className="py-2 font-medium">Misstatement</th>
                      <th className="py-2 pl-4 font-medium">Type</th>
                      <th className="py-2 pl-4 text-right font-medium">Profit overstated / (understated)</th>
                      <th className="py-2 pl-4 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.misstatements.items.map((x) => (
                      <tr key={x.id} className="border-b border-slate-200 align-top">
                        <td className="py-2">
                          {x.description}
                          <div className="text-xs text-slate-600">{x.recordedBy} on {x.recordedAt}</div>
                        </td>
                        <td className="py-2 pl-4 capitalize">{x.kind}</td>
                        <td className="py-2 pl-4 text-right tabular-nums whitespace-nowrap">{formatAmount(x.amountMinor)}</td>
                        <td className="py-2 pl-4">
                          {x.corrected ? "Corrected" : "Uncorrected"}
                          {open && reviewer && (
                            <ActionForm action={setMisstatementCorrectedAction} fields={{ misstatementId: x.id, corrected: String(!x.corrected) }} className="mt-1">
                              <button className={small}>{x.corrected ? "Mark uncorrected" : "Mark corrected"}</button>
                            </ActionForm>
                          )}
                        </td>
                      </tr>
                    ))}
                    <tr className="font-semibold">
                      <td className="py-2" colSpan={2}>Uncorrected, net</td>
                      <td className="py-2 pl-4 text-right tabular-nums whitespace-nowrap">{formatAmount(overview.misstatements.uncorrectedNetMinor)}</td>
                      <td className="py-2 pl-4 font-normal text-slate-600">ignoring direction: {formatAmount(overview.misstatements.uncorrectedGrossMinor)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            {m ? (
              <p className={`mt-3 rounded border px-3 py-2 text-sm ${overview.misstatements.exceedsMateriality ? "border-red-300 bg-red-50" : "border-slate-200 bg-slate-50"}`}>
                {overview.misstatements.exceedsMateriality
                  ? `The net uncorrected misstatements reach overall materiality of ${formatAmount(m.overallMinor)}. The engagement cannot be locked until they are corrected; modified opinions are not yet supported.`
                  : `The net uncorrected misstatements are below overall materiality of ${formatAmount(m.overallMinor)}. Consider also their nature, any offsetting, and items from prior periods.`}
              </p>
            ) : (
              <p className="mt-3 text-sm text-slate-600">Set materiality to compare the uncorrected misstatements against it.</p>
            )}
            {open && (
              <ActionForm action={addMisstatementAction} fields={{ engagementId: id }} className="mt-4 rounded border border-slate-200 bg-slate-50 p-4">
                <h3 className="text-base font-semibold">Record a misstatement</h3>
                <div className="mt-3 flex flex-wrap items-end gap-3">
                  <label className={`${label} min-w-64 flex-1`}>
                    Description
                    <input name="description" required minLength={5} maxLength={1000} className={input} />
                  </label>
                  <label className={label}>
                    Type
                    <select name="kind" defaultValue="factual" className={input}>
                      <option value="factual">Factual</option>
                      <option value="judgemental">Judgemental</option>
                      <option value="projected">Projected</option>
                    </select>
                  </label>
                  <label className={label}>
                    Amount
                    <input name="amount" inputMode="decimal" required className={`${input} w-36 text-right`} />
                  </label>
                  <label className={label}>
                    Effect on profit
                    <select name="direction" defaultValue="overstated" className={input}>
                      <option value="overstated">Profit overstated</option>
                      <option value="understated">Profit understated</option>
                    </select>
                  </label>
                  <button className={primary}>Record</button>
                </div>
              </ActionForm>
            )}
          </section>
          </>
          )}

          <p className="mt-8 text-xs text-slate-600">
            Not yet in the product: the sampling calculator, modified audit opinions, the auditor&apos;s report, and partner approval of the risk assessment.
          </p>
        </>
      )}
    </main>
  );
}
