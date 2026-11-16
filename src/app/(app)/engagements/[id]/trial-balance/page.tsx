import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import * as repo from "@/server/repo";
import { buildLeadSheets } from "@/domain/leadsheet";
import { GROUPS } from "@/domain/groups";
import { formatAmount } from "@/domain/money";
import { approveAllAction } from "@/app/actions";
import { MappingSelect, UploadForm } from "@/app/forms";
import { EngagementNav } from "../nav";

export const dynamic = "force-dynamic";

const SOURCE_LABEL: Record<string, string> = {
  prior_year: "Prior year",
  rule: "Suggested",
  ai: "AI suggested",
  manual: "Set by preparer",
};

const num = "py-1.5 pl-4 text-right tabular-nums whitespace-nowrap";

export default async function EngagementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const session = await getSession();
  const { engagement, accounts } = await withFirm(await getDb(), session.firmId, async (tx) => ({
    engagement: await repo.getEngagement(tx, id),
    accounts: await repo.listAccounts(tx, id),
  }));
  if (!engagement) notFound();

  // Lead sheets show adjusted balances: trial balance plus journal entries.
  const hasAdjustments = accounts.some((a) => a.adjustmentMinor !== 0);
  const set = buildLeadSheets(accounts.map((a) => ({ ...a, closingMinor: a.closingMinor + a.adjustmentMinor })));
  const groups = [...GROUPS].sort((a, b) => a.sort - b.sort).map((g) => ({ code: g.code, name: g.name }));
  const toReview = accounts.filter((a) => a.groupCode && !a.approved).length;
  const total = accounts.reduce((s, a) => s + a.closingMinor, 0);

  return (
    <div className="py-8 text-slate-900">
      <Link href="/" className="text-sm text-blue-700 underline">All engagements</Link>
      <h1 className="mt-2 text-2xl font-semibold">{engagement.clientName}</h1>
      <p className="mt-1 text-sm text-slate-600">
        {engagement.periodStart} to {engagement.periodEnd}
        {engagement.priorEngagementId ? " · mappings carry forward from the prior year" : " · no prior-year engagement linked"}
      </p>

      <EngagementNav id={id} current="tb" status={engagement.status} />

      <section className="mt-6 rounded border border-slate-200 bg-slate-50 p-4">
        <h2 className="text-base font-semibold">Trial balance</h2>
        <div className="mt-3">
          <UploadForm engagementId={id} hasAccounts={accounts.length > 0} />
        </div>
      </section>

      {accounts.length > 0 && (
        <>
          <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Accounts", String(accounts.length)],
              ["Unmapped", String(set.unmapped.length)],
              ["Suggestions to review", String(toReview)],
              ["Trial balance total", total === 0 ? "Balanced" : formatAmount(total)],
            ].map(([label, value]) => (
              <div key={label} className="rounded border border-slate-200 p-3">
                <div className="text-xs text-slate-600">{label}</div>
                <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
              </div>
            ))}
          </section>

          <section className="mt-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Account mapping</h2>
              {toReview > 0 && (
                <form action={approveAllAction}>
                  <input type="hidden" name="engagementId" value={id} />
                  <button className="rounded border border-slate-900 px-3 py-1.5 text-sm font-medium hover:bg-slate-100">
                    {toReview === 1 ? "Accept 1 suggestion" : `Accept all ${toReview} suggestions`}
                  </button>
                </form>
              )}
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-300 text-slate-600">
                  <tr>
                    <th className="py-2 font-medium">Code</th>
                    <th className="py-2 font-medium">Account</th>
                    <th className={`${num} font-medium`}>Closing</th>
                    <th className={`${num} font-medium`}>Prior year</th>
                    <th className="py-2 pl-4 font-medium">Group</th>
                    <th className="py-2 pl-4 font-medium">Basis</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((a) => (
                    <tr key={a.id} className="border-b border-slate-200">
                      <td className="py-1.5 font-mono text-xs">{a.code}</td>
                      <td className="py-1.5">{a.name}</td>
                      <td className={num}>{formatAmount(a.closingMinor)}</td>
                      <td className={num}>{a.priorMinor === null ? "" : formatAmount(a.priorMinor)}</td>
                      <td className="py-1.5 pl-4">
                        <MappingSelect key={`${a.id}:${a.groupCode}`} engagementId={id} accountId={a.id} value={a.groupCode} groups={groups} />
                      </td>
                      <td className="py-1.5 pl-4 whitespace-nowrap text-slate-700">
                        {a.source ? SOURCE_LABEL[a.source] : "—"}
                        {a.source && !a.approved && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">Review</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="mt-10">
            <h2 id="lead-sheets" className="text-lg font-semibold">Lead sheets</h2>
            <p className={`mt-1 text-sm ${set.tiesToTrialBalance ? "text-emerald-800" : "text-red-800"}`}>
              {set.tiesToTrialBalance
                ? "Lead sheet totals agree to the trial balance."
                : "Lead sheet totals do not agree to the trial balance."}
              {set.unmapped.length > 0 && ` ${set.unmapped.length} unmapped account(s) are not on any lead sheet yet.`}
            </p>
            {set.sheets.map((sheet) => (
              <div key={sheet.groupCode} id={`ls-${sheet.groupCode}`} className="mt-5 overflow-x-auto rounded border border-slate-200">
                <table className="w-full text-left text-sm">
                  <caption className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-left">
                    <span className="font-semibold">{sheet.groupName}</span>
                    <span className="ml-2 text-xs text-slate-600">{sheet.section}</span>
                  </caption>
                  <thead className="text-slate-600">
                    <tr>
                      <th className="px-3 py-1.5 font-medium">Code</th>
                      <th className="py-1.5 font-medium">Account</th>
                      {hasAdjustments && <th className={`${num} font-medium`}>Per trial balance</th>}
                      {hasAdjustments && <th className={`${num} font-medium`}>Adjustments</th>}
                      <th className={`${num} font-medium`}>{hasAdjustments ? "Adjusted" : "Closing"}</th>
                      <th className={`${num} font-medium`}>Prior year</th>
                      <th className={`${num} pr-3 font-medium`}>Movement</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sheet.accounts.map((a) => (
                      <tr key={a.code} className="border-t border-slate-100">
                        <td className="px-3 py-1.5 font-mono text-xs">{a.code}</td>
                        <td className="py-1.5">{a.name}</td>
                        {hasAdjustments && <td className={num}>{formatAmount(a.closingMinor - (a.adjustmentMinor ?? 0))}</td>}
                        {hasAdjustments && <td className={num}>{a.adjustmentMinor ? formatAmount(a.adjustmentMinor) : ""}</td>}
                        <td className={num}>{formatAmount(a.closingMinor)}</td>
                        <td className={num}>{a.priorMinor === null ? "" : formatAmount(a.priorMinor)}</td>
                        <td className={`${num} pr-3`}>{formatAmount(a.closingMinor - (a.priorMinor ?? 0))}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-slate-300 font-semibold">
                      <td className="px-3 py-1.5" colSpan={hasAdjustments ? 4 : 2}>Total</td>
                      <td className={num}>{formatAmount(sheet.closingMinor)}</td>
                      <td className={num}>{formatAmount(sheet.priorMinor)}</td>
                      <td className={`${num} pr-3`}>
                        {formatAmount(sheet.varianceMinor)}
                        {sheet.variancePct !== null && <span className="ml-2 text-xs font-normal text-slate-600">{sheet.variancePct.toFixed(1)}%</span>}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
