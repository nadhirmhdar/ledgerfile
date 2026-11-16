import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import * as repo from "@/server/repo";
import * as journals from "@/server/journals";
import { formatAmount } from "@/domain/money";
import { canDeleteJournal } from "@/domain/permissions";
import { deleteJournalAction } from "@/app/actions";
import { EngagementNav } from "../nav";
import { DeleteJournalButton, JournalForm } from "./journal-form";

export const dynamic = "force-dynamic";

const num = "py-1.5 pl-4 text-right tabular-nums whitespace-nowrap";

export default async function JournalsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const session = await getSession();
  const { engagement, accounts, list } = await withFirm(await getDb(), session.firmId, async (tx) => ({
    engagement: await repo.getEngagement(tx, id),
    accounts: await repo.listAccounts(tx, id),
    list: await journals.listJournals(tx, id),
  }));
  if (!engagement) notFound();

  return (
    <div className="py-8 text-slate-900">
      <Link href="/" className="text-sm text-blue-700 underline">All engagements</Link>
      <h1 className="mt-2 text-2xl font-semibold">{engagement.clientName}</h1>
      <p className="mt-1 text-sm text-slate-600">{engagement.periodStart} to {engagement.periodEnd}</p>
      <EngagementNav id={id} current="journals" status={engagement.status} />

      {accounts.length === 0 ? (
        <p className="mt-6 text-sm text-slate-600">Import a trial balance before posting journal entries.</p>
      ) : (
        <>
          <section className="mt-6 rounded border border-slate-200 bg-slate-50 p-4">
            <h2 className="text-base font-semibold">New entry</h2>
            <div className="mt-3">
              <JournalForm engagementId={id} accounts={accounts.map((a) => ({ id: a.id, code: a.code, name: a.name }))} />
            </div>
          </section>

          <section className="mt-8">
            <h2 className="text-lg font-semibold">Posted entries</h2>
            {list.length === 0 ? (
              <p className="mt-2 text-sm text-slate-600">No entries yet. Lead sheets and statements show the trial balance as imported.</p>
            ) : (
              list.map((j) => (
                <div key={j.id} className="mt-4 overflow-x-auto rounded border border-slate-200">
                  <table className="w-full text-left text-sm">
                    <caption className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-left">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span>
                          <span className="font-semibold">
                            {j.type === "adjusting" ? "AJE" : "RJE"} {j.number}
                          </span>
                          <span className="ml-2">{j.description}</span>
                          <span className="ml-2 text-xs text-slate-600">{j.createdAt}</span>
                        </span>
                        {engagement.status === "open" && canDeleteJournal(session.role, j.createdBy === session.userId) && (
                        <form action={deleteJournalAction}>
                          <input type="hidden" name="engagementId" value={id} />
                          <input type="hidden" name="journalId" value={j.id} />
                          <DeleteJournalButton label={`${j.type === "adjusting" ? "AJE" : "RJE"} ${j.number}`} />
                        </form>
                        )}
                      </div>
                    </caption>
                    <thead className="text-slate-600">
                      <tr>
                        <th className="px-3 py-1.5 font-medium">Code</th>
                        <th className="py-1.5 font-medium">Account</th>
                        <th className={`${num} font-medium`}>Debit</th>
                        <th className={`${num} pr-3 font-medium`}>Credit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {j.lines.map((l, i) => (
                        <tr key={i} className="border-t border-slate-100">
                          <td className="px-3 py-1.5 font-mono text-xs">{l.accountCode}</td>
                          <td className="py-1.5">{l.accountName}</td>
                          <td className={num}>{l.amountMinor > 0 ? formatAmount(l.amountMinor) : ""}</td>
                          <td className={`${num} pr-3`}>{l.amountMinor < 0 ? formatAmount(-l.amountMinor) : ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))
            )}
          </section>
        </>
      )}
    </div>
  );
}
