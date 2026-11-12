"use client";

import { useActionState, useState } from "react";
import { createJournalAction, type FormState } from "@/app/actions";

interface Line {
  accountId: string;
  debit: string;
  credit: string;
}

type State = FormState & { posted: number };
const initial: State = { ok: true, message: "", posted: 0 };
const blank = (): Line => ({ accountId: "", debit: "", credit: "" });
const input = "rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900";

/** Loose client-side reading of an amount, only for the running totals; the server does the real parsing. */
function toNumber(text: string): number {
  const n = Number(text.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

type Props = { engagementId: string; accounts: { id: string; code: string; name: string }[] };

export function JournalForm(props: Props) {
  // Count successful posts: the fields are re-created (cleared) only after a success,
  // so a rejected entry keeps what the user typed.
  const [state, action, pending] = useActionState(async (prev: State, data: FormData): Promise<State> => {
    const result = await createJournalAction(prev, data);
    return { ...result, posted: prev.posted + (result.ok ? 1 : 0) };
  }, initial);
  return (
    <form action={action}>
      <Fields key={state.posted} pending={pending} {...props} />
      {state.message && (
        <p role="status" className={`mt-3 rounded border px-3 py-2 text-sm ${state.ok ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-red-300 bg-red-50 text-red-900"}`}>
          {state.message}
        </p>
      )}
    </form>
  );
}

function Fields({ engagementId, accounts, pending }: Props & { pending: boolean }) {
  const [lines, setLines] = useState<Line[]>([blank(), blank()]);
  const [type, setType] = useState("adjusting");
  const [description, setDescription] = useState("");

  const update = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const debits = lines.reduce((s, l) => s + toNumber(l.debit), 0);
  const credits = lines.reduce((s, l) => s + toNumber(l.credit), 0);
  const difference = Math.round((debits - credits) * 100) / 100;
  const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <>
      <input type="hidden" name="engagementId" value={engagementId} />
      <input type="hidden" name="lines" value={JSON.stringify(lines)} />
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Type
          <select name="type" className={input} value={type} onChange={(e) => setType(e.target.value)}>
            <option value="adjusting">Adjusting entry</option>
            <option value="reclassification">Reclassification</option>
          </select>
        </label>
        <label className="flex min-w-64 flex-1 flex-col gap-1 text-sm text-slate-700">
          Description
          <input name="description" required minLength={3} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} className={input} placeholder="What the entry corrects and why" />
        </label>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-slate-600">
            <tr>
              <th className="py-1 font-medium">Account</th>
              <th className="py-1 pl-2 font-medium">Debit</th>
              <th className="py-1 pl-2 font-medium">Credit</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="py-1">
                  <select aria-label={`Line ${i + 1} account`} value={l.accountId} onChange={(e) => update(i, { accountId: e.target.value })} className={`${input} w-full min-w-56`}>
                    <option value="">Choose an account</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} · {a.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-1 pl-2">
                  <input aria-label={`Line ${i + 1} debit`} inputMode="decimal" value={l.debit} onChange={(e) => update(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} className={`${input} w-32 text-right`} />
                </td>
                <td className="py-1 pl-2">
                  <input aria-label={`Line ${i + 1} credit`} inputMode="decimal" value={l.credit} onChange={(e) => update(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} className={`${input} w-32 text-right`} />
                </td>
                <td className="py-1 pl-2">
                  {lines.length > 2 && (
                    <button type="button" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="text-sm text-red-700 underline" aria-label={`Remove line ${i + 1}`}>
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
            <tr className="border-t border-slate-300 font-semibold">
              <td className="py-1.5">
                <button type="button" onClick={() => setLines((ls) => [...ls, blank()])} className="text-sm font-normal text-blue-700 underline">
                  Add line
                </button>
              </td>
              <td className="py-1.5 pl-2 text-right tabular-nums">{money(debits)}</td>
              <td className="py-1.5 pl-2 text-right tabular-nums">{money(credits)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50" disabled={pending || difference !== 0 || debits === 0}>
          {pending ? "Posting…" : "Post entry"}
        </button>
        <span className={`text-sm ${difference === 0 ? "text-slate-600" : "text-red-800"}`}>
          {debits === 0 && credits === 0 ? "Enter the lines; debits must equal credits." : difference === 0 ? "Debits equal credits." : `Out of balance by ${money(Math.abs(difference))}.`}
        </span>
      </div>
    </>
  );
}

export function DeleteJournalButton({ label }: { label: string }) {
  return (
    <button
      className="text-sm text-red-700 underline"
      onClick={(e) => {
        if (!window.confirm(`Delete ${label}? Its number will not be reused.`)) e.preventDefault();
      }}
    >
      Delete
    </button>
  );
}
