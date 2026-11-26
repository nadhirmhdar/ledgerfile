"use client";

import { startTransition, useActionState, useState } from "react";
import { buttonClass } from "@/ui/button";
import { Badge } from "@/ui/badge";
import { Field, Select, Textarea } from "@/ui/form";
import { plainCount } from "@/ui/text";
import { CONCLUSION_LABEL, DECLARATION, MAX_TEXT, STAGE_LABEL, STAGES, type Stage } from "@/domain/independence";
import { DRAFT_PASSAGE_LABEL } from "@/domain/note-texts";
import { concludeIndependenceAction, confirmIndependenceAction } from "./independence-actions";
import type { FormState } from "./actions";

const initial: FormState = { ok: true, message: "" };

function Message({ state }: { state: FormState }) {
  return state.message ? (
    <div role="status" className={`mt-3 text-sm font-medium ${state.ok ? "text-success-strong" : "text-danger-strong"}`}>
      <p>{plainCount(state.message)}</p>
    </div>
  ) : null;
}

const send = (run: (data: FormData) => void) => (e: React.FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  const data = new FormData(e.currentTarget);
  startTransition(() => run(data));
};

/** The signed-in person's own confirmation. The declaration they agree to is shown above the button, marked as draft wording. */
export function ConfirmIndependenceForm({ engagementId, firstStage }: { engagementId: string; firstStage: Stage }) {
  const [state, run, pending] = useActionState(confirmIndependenceAction, initial);
  const [outcome, setOutcome] = useState("confirmed");
  return (
    <form onSubmit={send(run)}>
      <input type="hidden" name="engagementId" value={engagementId} />
      <fieldset disabled={pending} className="contents">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Stage">
            <Select name="stage" defaultValue={firstStage}>
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABEL[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Your answer">
            <Select name="outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
              <option value="confirmed">I confirm</option>
              <option value="threats_noted">I confirm, and note threats</option>
            </Select>
          </Field>
        </div>
        {outcome === "threats_noted" && (
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Threats">
              <Textarea name="threats" required maxLength={MAX_TEXT} rows={3} />
            </Field>
            <Field label="Safeguards">
              <Textarea name="safeguards" required maxLength={MAX_TEXT} rows={3} />
            </Field>
          </div>
        )}
        <div className="mt-4 rounded-md border border-border bg-surface-muted/40 p-3">
          <p className="mb-2">
            <Badge tone="warning">{DRAFT_PASSAGE_LABEL}</Badge>
          </p>
          <p className="text-sm text-ink">{DECLARATION}</p>
        </div>
        <button className={`${buttonClass("primary")} mt-4`} disabled={pending}>
          {pending ? "Saving…" : "Record my confirmation"}
        </button>
      </fieldset>
      <Message state={state} />
    </form>
  );
}

/** The engagement partner's conclusion for a stage, with a note. */
export function ConcludeIndependenceForm({ engagementId, firstStage }: { engagementId: string; firstStage: Stage }) {
  const [state, run, pending] = useActionState(concludeIndependenceAction, initial);
  return (
    <form onSubmit={send(run)}>
      <input type="hidden" name="engagementId" value={engagementId} />
      <fieldset disabled={pending} className="contents">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Stage">
            <Select name="stage" defaultValue={firstStage}>
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABEL[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Conclusion">
            <Select name="conclusion" defaultValue="met">
              <option value="met">{CONCLUSION_LABEL.met}</option>
              <option value="not_met">{CONCLUSION_LABEL.not_met}</option>
            </Select>
          </Field>
        </div>
        <Field label="Note" className="mt-4">
          <Textarea name="note" required maxLength={MAX_TEXT} rows={3} />
        </Field>
        <button className={`${buttonClass("secondary")} mt-4`} disabled={pending}>
          {pending ? "Saving…" : "Record the partner's conclusion"}
        </button>
      </fieldset>
      <Message state={state} />
    </form>
  );
}
