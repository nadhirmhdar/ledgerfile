import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import * as repo from "@/server/repo";
import { buildStatementPack } from "@/domain/statement-pack";
import type { StatementLine } from "@/domain/statements";
import { formatPresentation } from "@/domain/money";
import { EngagementNav } from "../nav";

export const dynamic = "force-dynamic";

const num = "py-1.5 pl-6 text-right tabular-nums whitespace-nowrap";
const ruleFor = (kind: string) => (kind === "total" ? "border-t border-b-2 border-slate-900" : kind === "subtotal" ? "border-t border-slate-400" : "");

export default async function StatementsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ units?: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const whole = (await searchParams).units === "whole";

  const session = await getSession();
  const { engagement, accounts } = await withFirm(await getDb(), session.firmId, async (tx) => ({
    engagement: await repo.getEngagement(tx, id),
    accounts: await repo.listAccounts(tx, id),
  }));
  if (!engagement) notFound();

  const pack = buildStatementPack(
    accounts.map((a) => ({ ...a, closingMinor: a.closingMinor + a.adjustmentMinor })),
    { unitMinor: whole ? 100 : 1 },
  );
  const s = pack.base;
  const fmt = (n: number) => formatPresentation(n, pack.rounding.unitMinor);
  const year = engagement.periodEnd.slice(0, 4);
  const priorYear = String(Number(year) - 1);
  const base = `/engagements/${id}`;
  const query = whole ? "?units=whole" : "";

  const head = (
    <thead className="border-b border-slate-300 text-slate-600">
      <tr>
        <th className="py-2 font-medium" />
        <th className="py-2 pl-4 text-right font-medium">Note</th>
        <th className={`${num} font-medium`}>{year}</th>
        {s.hasComparatives && <th className={`${num} font-medium`}>{priorYear}</th>}
      </tr>
    </thead>
  );
  const Row = ({ line }: { line: StatementLine }) => {
    const note = line.groupCode ? pack.noteByGroup[line.groupCode] : undefined;
    return (
      <tr className={line.kind === "line" ? "" : "font-semibold"}>
        <td className="py-1.5">
          {line.groupCode ? <Link href={`${base}#ls-${line.groupCode}`} className="text-blue-700 underline">{line.label}</Link> : line.label}
        </td>
        <td className="py-1.5 pl-4 text-right font-normal">{note ? <a href={`#note-${note}`} className="text-blue-700 underline">{note}</a> : ""}</td>
        <td className={`${num} ${ruleFor(line.kind)}`}>{fmt(line.current)}</td>
        {s.hasComparatives && <td className={`${num} ${ruleFor(line.kind)}`}>{fmt(line.prior)}</td>}
      </tr>
    );
  };

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 text-slate-900">
      <Link href="/" className="text-sm text-blue-700 underline">All engagements</Link>
      <h1 className="mt-2 text-2xl font-semibold">{engagement.clientName}</h1>
      <p className="mt-1 text-sm text-slate-600">{engagement.periodStart} to {engagement.periodEnd}</p>
      <EngagementNav id={id} current="statements" status={engagement.status} />

      {accounts.length === 0 ? (
        <p className="mt-6 text-sm text-slate-600">Import a trial balance to see the statements.</p>
      ) : (
        <>
          <section className={`mt-6 rounded border p-4 ${pack.clean ? "border-emerald-300 bg-emerald-50" : "border-amber-400 bg-amber-50"}`}>
            <h2 className="text-base font-semibold">{pack.clean ? "All checks pass" : "Draft: checks outstanding"}</h2>
            <ul className="mt-2 space-y-1 text-sm">
              {pack.checks.map((c) => (
                <li key={c.label}>
                  <span className={c.passed ? "text-emerald-800" : "font-semibold text-red-800"}>{c.passed ? "Passed" : "Failed"}</span>
                  <span className="ml-2">{c.label}.</span>
                  {c.detail && <span className="ml-1 text-slate-700">{c.detail}</span>}
                </li>
              ))}
            </ul>
          </section>

          <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
            <span>
              Figures shown {whole ? "rounded to whole units" : "to two decimal places"}.{" "}
              <Link href={`${base}/statements${whole ? "" : "?units=whole"}`} className="text-blue-700 underline">
                {whole ? "Show exact figures" : "Round to whole units"}
              </Link>
            </span>
            <a href={`${base}/statements/export${query}`} className="rounded bg-slate-900 px-3 py-1.5 font-medium text-white hover:bg-slate-700">
              Download as Word
            </a>
          </div>
          {(pack.rounding.current || pack.rounding.prior) && (
            <p className="mt-2 text-xs text-slate-600">
              Rounding each account separately left a small difference, which was put through:
              {pack.rounding.current && ` ${pack.rounding.current.account} (${year}: ${fmt(pack.rounding.current.amountMinor)})`}
              {pack.rounding.prior && ` ${pack.rounding.prior.account} (${priorYear}: ${fmt(pack.rounding.prior.amountMinor)})`}.
            </p>
          )}

          <section className="mt-8">
            <h2 className="text-lg font-semibold">Statement of financial position</h2>
            <p className="text-sm text-slate-600">At {engagement.periodEnd}</p>
            <table className="mt-3 w-full text-left text-sm">
              {head}
              <tbody>
                {s.financialPosition.flatMap((section, i) => [
                  ...(section.title
                    ? [
                        <tr key={`t${i}`}>
                          <th colSpan={s.hasComparatives ? 4 : 3} scope="colgroup" className="pt-4 pb-1 text-left font-semibold">{section.title}</th>
                        </tr>,
                      ]
                    : []),
                  ...section.lines.map((l) => <Row key={l.key} line={l} />),
                ])}
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
                  <Row key={l.key} line={l} />
                ))}
              </tbody>
            </table>
          </section>

          {!s.hasComparatives && (
            <p className="mt-8 rounded border border-slate-300 bg-slate-50 p-3 text-sm">
              The statement of changes in equity and the statement of cash flows need prior-year balances. Import a trial balance with a Prior Year column to produce them.
            </p>
          )}

          {pack.equity && (
            <section className="mt-10">
              <h2 className="text-lg font-semibold">Statement of changes in equity</h2>
              <p className="text-sm text-slate-600">For the period ended {engagement.periodEnd}</p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-300 text-slate-600">
                    <tr>
                      <th className="py-2 font-medium" />
                      {pack.equity.columns.map((c) => (
                        <th key={c.key} className={`${num} font-medium whitespace-normal`}>{c.label}</th>
                      ))}
                      <th className={`${num} font-medium`}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pack.equity.rows.map((r) => (
                      <tr key={r.key} className={r.kind === "total" ? "font-semibold" : ""}>
                        <td className="py-1.5">{r.label}</td>
                        {r.values.map((v, i) => (
                          <td key={i} className={`${num} ${ruleFor(r.kind)}`}>{fmt(v)}</td>
                        ))}
                        <td className={`${num} ${ruleFor(r.kind)}`}>{fmt(r.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {pack.cashFlow && (
            <section className="mt-10">
              <h2 className="text-lg font-semibold">Statement of cash flows</h2>
              <p className="text-sm text-slate-600">
                For the period ended {engagement.periodEnd}. Derived from the movements between the two years (indirect method): review it for non-cash transactions and disposals.
              </p>
              <table className="mt-3 w-full text-left text-sm">
                <thead className="border-b border-slate-300 text-slate-600">
                  <tr>
                    <th className="py-2 font-medium" />
                    <th className={`${num} font-medium`}>{year}</th>
                  </tr>
                </thead>
                <tbody>
                  {pack.cashFlow.sections.flatMap((section) => [
                    <tr key={section.title}>
                      <th colSpan={2} scope="colgroup" className="pt-4 pb-1 text-left font-semibold">{section.title}</th>
                    </tr>,
                    ...section.lines.map((l) => (
                      <tr key={l.key} className={l.kind === "line" ? "" : "font-semibold"}>
                        <td className="py-1.5">{l.label}</td>
                        <td className={`${num} ${ruleFor(l.kind)}`}>{fmt(l.current)}</td>
                      </tr>
                    )),
                  ])}
                  <tr className="font-semibold">
                    <td className="pt-4 pb-1.5">Net increase/(decrease) in cash and cash equivalents</td>
                    <td className={`${num} pt-4 ${ruleFor("subtotal")}`}>{fmt(pack.cashFlow.netChange)}</td>
                  </tr>
                  <tr>
                    <td className="py-1.5">Cash and cash equivalents at the start of the year</td>
                    <td className={num}>{fmt(pack.cashFlow.opening)}</td>
                  </tr>
                  <tr className="font-semibold">
                    <td className="py-1.5">Cash and cash equivalents at the end of the year</td>
                    <td className={`${num} ${ruleFor("total")}`}>{fmt(pack.cashFlow.closing)}</td>
                  </tr>
                </tbody>
              </table>
            </section>
          )}

          <section className="mt-10">
            <h2 className="text-lg font-semibold">Notes to the financial statements</h2>
            <p className="text-sm text-slate-600">Text in [square brackets] is for you to complete in the Word document.</p>
            {pack.notes.map((note) => (
              <div key={note.number} id={`note-${note.number}`} className="mt-5">
                <h3 className="font-semibold">
                  {note.number}. {note.title}
                </h3>
                {note.paragraphs.map((p, i) => (
                  <p key={i} className="mt-1 text-sm">{p}</p>
                ))}
                {note.table && (
                  <table className="mt-2 w-full text-left text-sm">
                    <thead className="border-b border-slate-300 text-slate-600">
                      <tr>
                        <th className="py-1.5 font-medium" />
                        <th className={`${num} font-medium`}>{year}</th>
                        {s.hasComparatives && <th className={`${num} font-medium`}>{priorYear}</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {note.table.rows.map((r, i) => (
                        <tr key={i}>
                          <td className="py-1.5">{r.label}</td>
                          <td className={num}>{fmt(r.current)}</td>
                          {s.hasComparatives && <td className={num}>{r.prior === null ? "" : fmt(r.prior)}</td>}
                        </tr>
                      ))}
                      <tr className="font-semibold">
                        <td className="py-1.5">Total</td>
                        <td className={`${num} ${ruleFor("total")}`}>{fmt(note.table.totalCurrent)}</td>
                        {s.hasComparatives && <td className={`${num} ${ruleFor("total")}`}>{fmt(note.table.totalPrior)}</td>}
                      </tr>
                    </tbody>
                  </table>
                )}
              </div>
            ))}
          </section>
        </>
      )}
    </main>
  );
}
