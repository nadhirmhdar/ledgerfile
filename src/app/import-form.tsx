"use client";

import { startTransition, useActionState, useState } from "react";
import { plainCount } from "@/ui/text";
import { uploadForImport } from "./import-upload";
import type { FormState } from "./actions";

const initial: FormState = { ok: true, message: "" };

/**
 * An import form for a hosted site with direct uploads: a file over `viaStoreAbove` goes straight to the private store first and the action is given
 * its key instead; anything smaller is sent with the form exactly as before.
 */
export function LargeImportForm({
  action,
  fields,
  purpose,
  engagementId,
  viaStoreAbove,
  children,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  fields: Record<string, string>;
  purpose: string;
  engagementId: string;
  viaStoreAbove: number;
  children: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, initial);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState("");
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const file = data.get("file");
    setProblem("");
    if (!(file instanceof File) || file.size <= viaStoreAbove) {
      startTransition(() => formAction(data));
      return;
    }
    setSending(true);
    void uploadForImport(file, { purpose, engagementId }).then((r) => {
      setSending(false);
      if (!r.ok) return setProblem(r.message);
      data.delete("file");
      data.set("uploadKey", r.key);
      startTransition(() => formAction(data));
    });
  };
  const message = problem || state.message;
  return (
    <form onSubmit={submit}>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <fieldset disabled={pending || sending} className="contents">
        {children}
      </fieldset>
      <div role="status" className={`mt-1 text-sm font-medium ${problem || !state.ok ? "text-danger-strong" : "text-success-strong"}`}>
        {sending && <p className="text-ink-muted">Uploading the file…</p>}
        {!sending && message && (
          <>
            <p>{plainCount(message)}</p>
            {!problem && state.details && state.details.length > 0 && (
              <ul className="mt-1 list-disc pl-5">
                {state.details.map((d) => (
                  <li key={d}>{plainCount(d)}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </form>
  );
}
