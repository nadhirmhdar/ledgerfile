"use client";

import { startTransition, useActionState } from "react";
import { buttonClass } from "@/ui/button";
import { Field, Input } from "@/ui/form";
import { plainCount } from "@/ui/text";
import { saveSignedPriorAction } from "./signed-prior-actions";
import type { FormState } from "./actions";

const initial: FormState = { ok: true, message: "" };

export interface SignedPriorRow {
  key: string;
  label: string;
  /** This file's comparative as the statements show it. */
  comparative: string;
  /** The signed figure saved now, as typed (empty when none). */
  saved: string;
}

/**
 * The signed prior-year figures, one amount for each face line that has a comparative. The values stay in the form when a check fails, and the server
 * checks everything again (who may enter them, that the file is open, each line and each amount).
 */
export function SignedPriorForm({ engagementId, rows }: { engagementId: string; rows: SignedPriorRow[] }) {
  const [state, run, pending] = useActionState(saveSignedPriorAction, initial);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => run(data));
      }}
    >
      <input type="hidden" name="engagementId" value={engagementId} />
      <fieldset disabled={pending} className="contents">
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface shadow-card">
          {rows.map((r) => (
            <li key={r.key} className="grid grid-cols-1 gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_12rem_12rem] sm:items-end">
              <p className="min-w-0 font-medium text-ink">{r.label}</p>
              <p className="text-small text-ink-muted">
                In this file: <span className="font-medium text-ink">{r.comparative}</span>
              </p>
              <Field label="Signed figure">
                <Input name={`amount:${r.key}`} inputMode="decimal" autoComplete="off" defaultValue={r.saved} placeholder="Not entered" />
              </Field>
            </li>
          ))}
        </ul>
        <button className={`${buttonClass("primary")} mt-4`} disabled={pending}>
          {pending ? "Saving…" : "Save the signed figures"}
        </button>
      </fieldset>
      {state.message && (
        <div role="status" className={`mt-3 text-sm font-medium ${state.ok ? "text-success-strong" : "text-danger-strong"}`}>
          <p>{plainCount(state.message)}</p>
        </div>
      )}
    </form>
  );
}
