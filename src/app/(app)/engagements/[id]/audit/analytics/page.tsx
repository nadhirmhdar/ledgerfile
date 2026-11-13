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
import { EngagementNav } from "../../nav";

export const dynamic = "force-dynamic";

const input = "w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900";
const small = "rounded border border-slate-400 px-2 py-1 text-xs hover:bg-slate-100";
const th = "py-2 pl-4 text-right font-medium";
const td = "py-1.5 pl-4 text-right tabular-nums";

function percent(r: AnalyticsRow): string {
  if (r.pct !== null) return `${r.pct.toFixed(1)}%`;
  return r.pctNote === "no prior balance" ? "new" : "n/m";
}

function ratioText(value: number | null, unit: RatioRow["unit"]): string {
  if (value === null) return "n/a";
  if (unit === "amount") return formatAmount(Math.round(value));
  if (unit === "percent") return `${value.toFixed(1)}%`;
  if (unit === "days") return `${value.toFixed(0)} days`;
  return `${value.toFixed(2)}x`;
}

function changeText(value: number | null, unit: RatioRow["unit"]): string {
  if (value === null) return "n/a";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return sign + ratioText(Math.abs(value), unit).replace(/^\(|\)$/g, "");
}

export default async function AnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const session = await getSession();
  const { engagement, data } = await withFirm(await getDb(), session.firmId, async (tx) => ({
    engagement: await repo.getEngagement(tx, id),
    data: await getAnalytics(tx, id),
  }));
  if (!engagement || !data) notFound();
  const base = `/engagements/${id}/audit`;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 text-slate-900">
      <Link href="/" className="text-sm text-blue-700 underline">All engagements</Link>
      <h1 className="mt-2 text-2xl font-semibold">{engagement.clientName}</h1>
      <p className="mt-1 text-sm text-slate-600">{engagement.periodStart} to {engagement.periodEnd}</p>
      <EngagementNav id={id} current="audit" status={engagement.status} />

      <p className="mt-6 text-sm"><Link href={base} className="text-blue-700 underline">Back to audit planning</Link></p>
      <h2 className="mt-3 text-lg font-semibold">Analytical review and ratios</h2>
      <p className="mt-1 text-sm text-slate-700">
        Year-on-year movement of every line in the statements, from the adjusted trial balance. Use it at planning to decide where to look, and again at completion to
        check the finished statements still make sense.
      </p>

      {!data.auditOn && <p className="mt-3 rounded border border-slate-300 bg-slate-50 px-3 py-2 text-sm">The audit is off for this engagement, so explanations cannot be written. Turn it on from the audit planning page.</p>}
      {data.auditOn && engagement.status !== "open" && <p className="mt-3 rounded border border-slate-300 bg-slate-50 px-3 py-2 text-sm">This engagement is locked. The review is shown as it stands.</p>}
      {!data.hasComparatives ? (
        <p role="note" className="mt-3 rounded border border-amber-400 bg-amber-50 px-3 py-2 text-sm">
          There is no prior year on this engagement, so there is nothing to compare with: no movement is flagged and the prior-year ratios are n/a. Link or import the prior year to use this page fully.
        </p>
      ) : !data.thresholds ? (
        <p role="note" className="mt-3 rounded border border-amber-400 bg-amber-50 px-3 py-2 text-sm">
          Materiality has not been set, so no movement can be flagged yet. <Link href={base} className="text-blue-700 underline">Set materiality on the audit planning page</Link> first.
        </p>
      ) : (
        <p className="mt-3 text-sm text-slate-700">
          {FLAG_RULE_TEXT} Performance materiality is {formatAmount(data.thresholds.performanceMinor)}; clearly trivial is {formatAmount(data.thresholds.trivialMinor)}.
          {data.unexplained > 0 ? (
            <span className="ml-1 font-medium text-amber-900">{data.unexplained} flagged movement(s) have no explanation that still stands, which holds up the lock.</span>
          ) : (
            <span className="ml-1 font-medium text-emerald-800">Every flagged movement is explained.</span>
          )}
        </p>
      )}

      {data.rows.length === 0 ? (
        <p className="mt-6 text-sm text-slate-600">Import a trial balance and map its accounts to see the comparison.</p>
      ) : (
        <section className="mt-6">
          <h3 className="font-semibold">Year-on-year comparison</h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-300 text-slate-600">
                <tr>
                  <th className="py-2 font-medium">Line</th>
                  <th className={th}>Current year</th>
                  <th className={th}>Prior year</th>
                  <th className={th}>Change</th>
                  <th className={th}>Change %</th>
                </tr>
              </thead>
              {["Statement of comprehensive income", "Statement of financial position"].map((section) => (
                <tbody key={section}>
                  <tr>
                    <th colSpan={5} className="pt-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">{section}</th>
                  </tr>
                  {data.rows
                    .filter((r) => r.section === section)
                    .map((r) => (
                      <RowView key={`${section}:${r.key}`} r={r} id={id} editable={data.editable} />
                    ))}
                </tbody>
              ))}
            </table>
          </div>
        </section>
      )}

      <section className="mt-10">
        <h3 className="font-semibold">Ratios</h3>
        <p className="mt-1 text-sm text-slate-600">
          Worked out from the period-end balances in the statements, not from averages. Days use a {DAYS_IN_YEAR}-day year whatever the length of the period. A ratio is n/a when what it
          divides by is zero or negative, or when the year has no figures.
        </p>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-300 text-slate-600">
              <tr>
                <th className="py-2 font-medium">Ratio</th>
                <th className="py-2 pl-4 font-medium">Formula</th>
                <th className={th}>Current year</th>
                <th className={th}>Prior year</th>
                <th className={th}>Change</th>
              </tr>
            </thead>
            <tbody>
              {data.ratios.map((r) => (
                <tr key={r.key} className="border-b border-slate-100">
                  <td className="py-1.5 font-medium">{r.label}</td>
                  <td className="py-1.5 pl-4 text-slate-600">{r.formula}</td>
                  <td className={td}>{ratioText(r.current, r.unit)}</td>
                  <td className={td}>{ratioText(r.prior, r.unit)}</td>
                  <td className={td}>{changeText(r.change, r.unit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function RowView({ r, id, editable }: { r: AnalyticsRow; id: string; editable: boolean }) {
  const strong = r.kind !== "line";
  const e = r.explanation;
  return (
    <>
      <tr className={`border-b border-slate-100 ${r.flag ? "bg-amber-50" : ""} ${strong ? "font-semibold" : ""}`}>
        <td className="py-1.5">
          {r.label}
          {r.flag && <span className="ml-2 rounded bg-amber-200 px-1.5 py-0.5 text-xs font-medium text-amber-950">Explain</span>}
        </td>
        <td className={td}>{formatAmount(r.current)}</td>
        <td className={td}>{formatAmount(r.prior)}</td>
        <td className={td}>{formatAmount(r.change)}</td>
        <td className={td}>{percent(r)}</td>
      </tr>
      {r.flag && (
        <tr className="border-b border-slate-200 bg-amber-50">
          <td colSpan={5} className="pb-3 pl-2 pr-2 text-sm">
            <p className="text-xs text-slate-700">{r.flag.reason}</p>
            {e && (
              <p className="mt-1">
                <span className="font-medium">Explanation:</span> {e.text}{" "}
                <span className="text-xs text-slate-600">{e.writtenByName}, {e.writtenAt}</span>
              </p>
            )}
            {e?.stale && (
              <p className="mt-1 font-medium text-amber-900">
                The figures have changed since this was written. Re-confirm it still holds, or rewrite it. Until then it does not count towards the lock.
              </p>
            )}
            {editable && (
              <>
                <ActionForm action={saveExplanationAction} fields={{ engagementId: id, lineKey: r.key }} className="mt-2">
                  <label className="flex flex-col gap-1 text-xs text-slate-700">
                    {e ? "Rewrite the explanation" : "Explanation: the cause, and what you did to confirm it"}
                    <textarea name="explanation" rows={2} maxLength={3000} required defaultValue={e?.text ?? ""} className={input} />
                  </label>
                  <button className={`${small} mt-1`}>Save explanation</button>
                </ActionForm>
                {e?.stale && (
                  <ActionForm action={reconfirmExplanationAction} fields={{ engagementId: id, lineKey: r.key }} className="mt-1">
                    <button className={small}>Re-confirm as written</button>
                  </ActionForm>
                )}
              </>
            )}
            {!editable && !e && <p className="mt-1 text-xs text-slate-600">No explanation recorded.</p>}
          </td>
        </tr>
      )}
    </>
  );
}
