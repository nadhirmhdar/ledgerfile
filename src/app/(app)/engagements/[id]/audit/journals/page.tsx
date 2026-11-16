import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import * as repo from "@/server/repo";
import * as audit from "@/server/audit";
import * as ledger from "@/server/ledger";
import { FLAGS, FLAG_LABEL } from "@/domain/journal-risk";
import { LIBRARY_STATUS } from "@/domain/audit";
import { formatAmount } from "@/domain/money";
import { ActionForm } from "@/app/action-form";
import { FileInput } from "@/app/file-input";
import { importLedgerAction, recordJournalTestAction, selectEntryAction } from "@/app/ledger-actions";
import { EngagementNav } from "../../nav";

export const dynamic = "force-dynamic";

const input = "w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900";
const small = "rounded border border-slate-400 px-2 py-1 text-xs hover:bg-slate-100";
const num = "py-1.5 pl-4 text-right tabular-nums whitespace-nowrap";

export default async function JournalTestingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ flag?: string; user?: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const filter = await searchParams;

  const session = await getSession();
  const data = await withFirm(await getDb(), session.firmId, async (tx) => {
    const engagement = await repo.getEngagement(tx, id);
    if (!engagement) return null;
    const overview = (await ledger.getLedgerOverview(tx, id, filter))!;
    const lines = await ledger.getLinesForEntries(tx, id, overview.entries.map((e) => e.entryNo));
    return { engagement, overview, lines, auditOverview: await audit.getAuditOverview(tx, id) };
  });
  if (!data) notFound();
  const { engagement, overview, lines, auditOverview } = data;

  const open = engagement.status === "open";
  const enabled = auditOverview?.enabled ?? false;
  const base = `/engagements/${id}/audit/journals`;
  const href = (next: { flag?: string; user?: string }) => {
    const q = new URLSearchParams();
    if (next.flag) q.set("flag", next.flag);
    if (next.user) q.set("user", next.user);
    return q.size > 0 ? `${base}?${q}` : base;
  };
  const activeFlag = FLAGS.find((f) => f.code === filter.flag)?.code;
  const activeUser = overview.users.includes(filter.user ?? "") ? filter.user : undefined;
  const chip = (active: boolean) => `rounded-full border px-3 py-1 text-xs ${active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 text-blue-700 hover:bg-slate-100"}`;

  return (
    <div className="py-8 text-slate-900">
      <Link href="/" className="text-sm text-blue-700 underline">All engagements</Link>
      <h1 className="mt-2 text-2xl font-semibold">{engagement.clientName}</h1>
      <p className="mt-1 text-sm text-slate-600">{engagement.periodStart} to {engagement.periodEnd}</p>
      <EngagementNav id={id} current="audit" status={engagement.status} />

      <p className="mt-6 text-sm">
        <Link href={`/engagements/${id}/audit`} className="text-blue-700 underline">Audit planning</Link>
        {" · "}
        <Link href={`/engagements/${id}/audit/C16`} className="text-blue-700 underline">C16 programme</Link>
      </p>
      <h2 className="mt-2 text-xl font-semibold">Journal entry testing</h2>
      <p className="mt-1 text-sm text-slate-700">
        Import the client&apos;s journal listing for the period, check it is complete, and select entries to test for management override of controls.
        A flag is a reason to look at an entry, not a finding.
      </p>
      <p role="note" className="mt-3 rounded border border-amber-400 bg-amber-50 px-3 py-2 text-xs">
        The risk characteristics used here follow the draft methodology ({LIBRARY_STATUS}).
      </p>

      {!enabled ? (
        <p className="mt-6 text-sm text-slate-600">
          Turn the audit on for this engagement on the <Link href={`/engagements/${id}/audit`} className="text-blue-700 underline">Audit tab</Link> to import a journal listing.
        </p>
      ) : (
        <>
          {open && (
            <ActionForm action={importLedgerAction} fields={{ engagementId: id }} className="mt-6 rounded border border-slate-200 bg-slate-50 p-4">
              <h3 className="text-base font-semibold">{overview.listing ? "Replace the journal listing" : "Import the journal listing"}</h3>
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <FileInput maxBytes={10 * 1024 * 1024} accept=".xlsx,.csv" label="Journal listing file" className="text-sm text-slate-900" />
                <button className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700">{overview.listing ? "Replace" : "Import"}</button>
              </div>
              <p className="mt-2 text-xs text-slate-600">
                Excel (.xlsx) or CSV, up to 50,000 lines. Needs columns for date, journal number, account code, and Debit and Credit (or one Amount).
                Description and Posted by are used when present. Dates are read day first (31/12/2025). Every entry must balance.
                {overview.listing && " The listing cannot be replaced once an entry has been tested."}
              </p>
            </ActionForm>
          )}

          {overview.listing && overview.reconciliation && (
            <>
              <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ["Entries", overview.listing.entryCount.toLocaleString("en-US")],
                  ["Lines", overview.listing.lineCount.toLocaleString("en-US")],
                  ["Dated", `${overview.listing.from} to ${overview.listing.to}`],
                  ["Selected / tested", `${overview.selected} / ${overview.tested}`],
                ].map(([title, value]) => (
                  <div key={title} className="rounded border border-slate-200 p-3">
                    <div className="text-xs text-slate-600">{title}</div>
                    <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
                  </div>
                ))}
              </section>
              <p className="mt-2 text-xs text-slate-600">
                {overview.listing.fileName}, imported by {overview.listing.importedBy} on {overview.listing.importedAt}.
              </p>

              <section className="mt-8">
                <h3 className="text-lg font-semibold">Completeness</h3>
                <p className={`mt-1 text-sm ${overview.reconciliation.differences.length === 0 ? "text-emerald-800" : "text-red-800"}`}>
                  {overview.reconciliation.differences.length === 0
                    ? `The listing's movement agrees to the trial balance for all ${overview.reconciliation.agreed} accounts checked.`
                    : `The listing's movement agrees to the trial balance for ${overview.reconciliation.agreed} accounts and differs for ${overview.reconciliation.differences.length}.`}
                  {overview.reconciliation.unchecked > 0 && ` ${overview.reconciliation.unchecked} account(s) could not be checked (unmapped, or no prior-year balance).`}
                </p>
                {overview.reconciliation.differences.length > 0 && (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-slate-300 text-slate-600">
                        <tr>
                          <th className="py-1.5 font-medium">Account</th>
                          <th className={`${num} font-medium`}>Movement per trial balance</th>
                          <th className={`${num} font-medium`}>Movement per listing</th>
                          <th className={`${num} font-medium`}>Difference</th>
                        </tr>
                      </thead>
                      <tbody>
                        {overview.reconciliation.differences.slice(0, 15).map((d) => (
                          <tr key={d.code} className="border-b border-slate-200">
                            <td className="py-1.5">
                              <span className="font-mono text-xs">{d.code}</span> {d.name}
                            </td>
                            <td className={num}>{formatAmount(d.expectedMinor)}</td>
                            <td className={num}>{formatAmount(d.ledgerMinor)}</td>
                            <td className={num}>{formatAmount(d.differenceMinor)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {overview.reconciliation.differences.length > 15 && <p className="mt-1 text-xs text-slate-600">Showing the 15 largest differences.</p>}
                  </div>
                )}
                <p className="mt-2 text-xs text-slate-600">
                  Only entries dated within the period are counted. Balance sheet accounts are rolled forward from the prior-year balance; income and expense accounts from zero. Retained earnings usually differs by the
                  prior year&apos;s result, which is closed into it outside the period&apos;s journals. Investigate every other difference before relying on the listing.
                </p>
              </section>

              <section className="mt-8">
                <h3 className="text-lg font-semibold">Entries to consider</h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link href={href({ user: activeUser })} className={chip(!activeFlag)}>All flagged</Link>
                  {FLAGS.filter((f) => (overview.flagCounts[f.code] ?? 0) > 0).map((f) => (
                    <Link key={f.code} href={href({ flag: f.code, user: activeUser })} className={chip(activeFlag === f.code)} title={f.explanation}>
                      {f.label} ({overview.flagCounts[f.code]})
                    </Link>
                  ))}
                </div>
                {overview.users.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-slate-600">Posted by:</span>
                    <Link href={href({ flag: activeFlag })} className={chip(!activeUser)}>Anyone</Link>
                    {overview.users.slice(0, 20).map((u) => (
                      <Link key={u} href={href({ flag: activeFlag, user: u })} className={chip(activeUser === u)}>{u}</Link>
                    ))}
                  </div>
                )}
                <p className="mt-3 text-sm text-slate-600">
                  {overview.matching === 0
                    ? "No entries match."
                    : `${overview.matching.toLocaleString("en-US")} entr${overview.matching === 1 ? "y matches" : "ies match"}${overview.matching > overview.entries.length ? `; showing the first ${overview.entries.length}, selected entries and those with most flags first` : ""}.`}
                </p>

                {overview.entries.map((e) => (
                  <div key={e.entryNo} className={`mt-3 rounded border p-3 ${e.test?.status === "tested" ? "border-emerald-300 bg-emerald-50" : e.test ? "border-amber-400 bg-amber-50" : "border-slate-200"}`}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h4 className="font-semibold">
                        {e.entryNo} <span className="ml-1 text-xs font-normal text-slate-600">{e.date}{e.postedBy ? ` · posted by ${e.postedBy}` : ""}</span>
                      </h4>
                      <span className="text-sm tabular-nums">{formatAmount(e.totalMinor)}</span>
                    </div>
                    <p className="text-sm">{e.description ?? <span className="text-slate-500">No description</span>}</p>
                    {e.flags.length > 0 && (
                      <p className="mt-1 flex flex-wrap gap-1">
                        {e.flags.map((f) => (
                          <span key={f} className="rounded bg-slate-200 px-1.5 py-0.5 text-xs">{FLAG_LABEL.get(f)}</span>
                        ))}
                      </p>
                    )}
                    <table className="mt-2 w-full text-left text-sm">
                      <tbody>
                        {(lines.get(e.entryNo) ?? []).map((l, i) => (
                          <tr key={i} className="border-t border-slate-200">
                            <td className="py-1 font-mono text-xs">{l.accountCode}</td>
                            <td className="py-1">{l.accountName ?? ""}{l.description && l.description !== e.description ? ` · ${l.description}` : ""}</td>
                            <td className={num}>{l.amountMinor > 0 ? formatAmount(l.amountMinor) : ""}</td>
                            <td className={num}>{l.amountMinor < 0 ? formatAmount(-l.amountMinor) : ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {e.test?.status === "tested" && (
                      <div className="mt-2 text-sm">
                        <p><span className="font-medium">Work done:</span> {e.test.workDone}</p>
                        <p><span className="font-medium">Conclusion:</span> {e.test.conclusion} <span className="text-xs text-slate-600">— {e.test.testedBy}</span></p>
                      </div>
                    )}
                    {open && !e.test && (
                      <ActionForm action={selectEntryAction} fields={{ engagementId: id, entryNo: e.entryNo, select: "true" }} className="mt-2">
                        <button className={small}>Select for testing</button>
                      </ActionForm>
                    )}
                    {open && e.test?.status === "selected" && (
                      <>
                        <ActionForm action={recordJournalTestAction} fields={{ engagementId: id, entryNo: e.entryNo }} className="mt-2">
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <label className="flex flex-col gap-1 text-sm text-slate-700">
                              Support inspected
                              <textarea name="workDone" rows={2} maxLength={5000} required className={input} />
                            </label>
                            <label className="flex flex-col gap-1 text-sm text-slate-700">
                              Conclusion
                              <textarea name="conclusion" rows={2} maxLength={5000} required className={input} />
                            </label>
                          </div>
                          <button className={`${small} mt-2`}>Record conclusion</button>
                        </ActionForm>
                        <ActionForm action={selectEntryAction} fields={{ engagementId: id, entryNo: e.entryNo, select: "false" }} className="mt-1">
                          <button className={small}>Remove from selection</button>
                        </ActionForm>
                      </>
                    )}
                  </div>
                ))}
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
