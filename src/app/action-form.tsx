"use client";

import { useActionState } from "react";
import type { FormState } from "./actions";

const initial: FormState = { ok: true, message: "" };

/**
 * A form bound to a server action that returns a FormState.
 * Shows the action's message underneath; hidden fields carry the identifiers.
 */
export function ActionForm({
  action,
  fields,
  children,
  className,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  fields: Record<string, string>;
  children: React.ReactNode;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, initial);
  return (
    <form action={formAction} className={className}>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <fieldset disabled={pending} className="contents">
        {children}
      </fieldset>
      {state.message && (
        <div role="status" className={`mt-1 text-xs ${state.ok ? "text-emerald-800" : "text-red-800"}`}>
          <p>{state.message}</p>
          {state.details && state.details.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {state.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}
