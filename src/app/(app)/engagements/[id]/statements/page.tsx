import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import * as repo from "@/server/repo";
import { buildStatements, type StatementLine } from "@/domain/statements";
import { formatAmount } from "@/domain/money";
import { EngagementNav } from "../nav";

export const dynamic = "force-dynamic";

const num = "py-1.5 pl-6 text-right tabular-nums whitespace-nowrap";

function Row({ line, id, comparatives }: { line: StatementLine; id: string; comparatives: boolean }) {
  const weight = line.kind === "line" ? "" : "font-semibold";
  const rule = line.kind === "total" ? "border-t border-b-2 border-slate-900" : line.kind === "subtotal" ? "border-t border-slate-400" : "";
  return (
    <tr className={weight}>
      <td className="py-1.5">
        {line.groupCode ? (
          <Link href={`/engagements/${id}#ls-${line.groupCode}`} className="text-blue-700 underline">{line.label}</Link>
        ) : (
          line.label
        )}
      </td>
      <td className={`${num} ${rule}`}>{formatAmount(line.current)}</td>
      {comparatives && <td className={`${num} ${rule}`}>{formatAmount(line.prior)}</td>}
    </tr>
  );
}

export default async function StatementsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const session = await getSession();
  const { engagement, accounts } = await withFirm(await getDb(), session.firmId, async (tx) => ({
    engagement: await repo.getEngagement(tx, id),
    accounts: await repo.listAccounts(tx, id),
  }));
  if (!engagement) notFound();

  const s = buildStatements(accounts.map((a) => ({ ...a, closingMinor: a.closingMinor + a.adjustmentMinor })));
  const year = engagement.periodEnd.slice(0, 4);
  const priorYear = String(Number(year) - 1);
  const head = (
    <thead className="border-b border-slate-300 text-slate-600">
      <tr>
        <th className="py-2 font-medium" />
        <th className={`${num} font-medium`}>{year}</th>
        {s.hasComparatives && <th className={`${num} font-medium`}>{priorYear}</th>}
      </tr>
    </thead>
  );

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 text-slate-900">
      <Link href="/" className="text-sm text-blue-700 underline">All engagements</Link>
      <h1 className="mt-2 text-2xl font-semibold">{engagement.clientName}</h1>
      <p className="mt-1 text-sm text-slate-600">{engagement.periodStart} to {engagement.periodEnd}</p>
      <EngagementNav id={id} current="statements" status={engagement.status} />

      {accounts.length === 0 ? (
        <p className="mt-6 text-sm text-slate-600">Import a trial balance to see the statements.</p>
      ) : (
        <>
          <section className={`mt-6 rounded border p-4 ${s.clean ? "border-emerald-300 bg-emerald-50" : "border-amber-400 bg-amber-50"}`}>
            <h2 className="text-base font-semibold">{s.clean ? "All checks pass" : "Draft: checks outstanding"}</h2>
            <ul className="mt-2 space-y-1 text-sm">
              {s.checks.map((c) => (
                <li key={c.label}>
                  <span className={c.passed ? "text-emerald-800" : "font-semibold text-red-800"}>{c.passed ? "Passed" : "Failed"}</span>
                  <span className="ml-2">{c.label}.</span>
                  {c.detail && <span className="ml-1 text-slate-700">{c.detail}</span>}
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-8">
            <h2 className="text-lg font-semibold">Statement of financial position</h2>
            <p className="text-sm text-slate-600">At {engagement.periodEnd}</p>
            <table className="mt-3 w-full text-left text-sm">
              {head}
              <tbody>
                {s.financialPosition.map((section, i) => (
                  <FragmentRows key={i} title={section.title} span={s.hasComparatives ? 3 : 2}>
                    {section.lines.map((l) => (
                      <Row key={l.key} line={l} id={id} comparatives={s.hasComparatives} />
                    ))}
                  </FragmentRows>
                ))}
              </tbody>
            </table>
          </section>

          <section className="mt-10">
            <h2 className="text-lg font-semibold">Statement of comprehensive income</h2>
            <p className="text-sm text-slate-600">For the period ended {engagement.periodEnd}</p>
            <table className="mt-3 w-full text-left text-sm">
              {head}
              <tbody>
                {s.comprehensiveIncome.map((l) => (
                  <Row key={l.key} line={l} id={id} comparatives={s.hasComparatives} />
                ))}
              </tbody>
            </table>
          </section>

          <p className="mt-8 text-xs text-slate-600">
            Figures include posted journal entries. Not yet included: statement of changes in equity, statement of cash flows, notes,
            the split of borrowings between current and non-current, rounding, and Word or PDF export.
          </p>
        </>
      )}
    </main>
  );
}

function FragmentRows({ title, span, children }: { title: string; span: number; children: React.ReactNode }) {
  return (
    <>
      {title && (
        <tr>
          <th colSpan={span} scope="colgroup" className="pt-4 pb-1 text-left font-semibold">
            {title}
          </th>
        </tr>
      )}
      {children}
    </>
  );
}
