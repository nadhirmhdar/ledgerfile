"use client";

import { useActionState } from "react";
import { buttonClass } from "@/ui/button";
import { createClientAction, createEngagementAction, setMappingAction, uploadTrialBalanceAction, type FormState } from "./actions";

const initial: FormState = { ok: true, message: "" };
const input = "rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";
const button = "rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50";

function Feedback({ state }: { state: FormState }) {
  if (!state.message) return null;
  return (
    <div role="status" className={`mt-3 rounded border px-3 py-2 text-sm ${state.ok ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-red-300 bg-red-50 text-red-900"}`}>
      <p>{state.message}</p>
      {state.details && state.details.length > 0 && (
        <ul className="mt-2 list-disc pl-5">
          {state.details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function NewClientForm() {
  const [state, action, pending] = useActionState(createClientAction, initial);
  return (
    <form action={action}>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Client name
          <input name="name" required maxLength={200} className={`${input} w-72`} />
        </label>
        <button className={button} disabled={pending}>Add client</button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

export function NewEngagementForm({ clients }: { clients: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(createEngagementAction, initial);
  return (
    <form action={action}>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Client
          <select name="clientId" required className={`${input} w-72`} defaultValue="">
            <option value="" disabled>Choose a client</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Period start
          <input type="date" name="periodStart" required className={input} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Period end
          <input type="date" name="periodEnd" required className={input} />
        </label>
        <button className={button} disabled={pending}>Create engagement</button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

export function UploadForm({ engagementId, hasAccounts }: { engagementId: string; hasAccounts: boolean }) {
  const [state, action, pending] = useActionState(uploadTrialBalanceAction, initial);
  return (
    <form action={action}>
      <input type="hidden" name="engagementId" value={engagementId} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium text-ink">
          Trial balance file (.xlsx or .csv)
          <input type="file" name="file" accept=".xlsx,.csv" required className="text-sm font-normal text-ink" />
        </label>
        <button className={buttonClass("primary")} disabled={pending}>{pending ? "Importing…" : hasAccounts ? "Replace trial balance" : "Import trial balance"}</button>
      </div>
      <p className="mt-2 text-sm text-ink-muted">
        Needs a column for account code or name, and either Debit and Credit columns or one Balance column. A Prior Year column is optional.
      </p>
      <Feedback state={state} />
    </form>
  );
}

export function MappingSelect({
  engagementId,
  accountId,
  value,
  groups,
  label = "Group",
}: {
  engagementId: string;
  accountId: string;
  value: string | null;
  groups: { code: string; name: string }[];
  /** The accessible name, so each row's control is announced with its account. */
  label?: string;
}) {
  return (
    <form action={setMappingAction}>
      <input type="hidden" name="engagementId" value={engagementId} />
      <input type="hidden" name="accountId" value={accountId} />
      <select
        name="groupCode"
        aria-label={label}
        defaultValue={value ?? ""}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className={`min-h-10 w-full rounded-md border bg-surface px-3 py-1.5 text-sm text-ink sm:w-64 ${value ? "border-border-strong" : "border-warning bg-warning-soft"}`}
      >
        <option value="">Not mapped</option>
        {groups.map((g) => (
          <option key={g.code} value={g.code}>{g.name}</option>
        ))}
      </select>
    </form>
  );
}
