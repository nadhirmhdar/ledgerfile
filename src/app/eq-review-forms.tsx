"use client";

import { startTransition, useActionState, useState } from "react";
import { buttonClass } from "@/ui/button";
import { Field, Select, Textarea } from "@/ui/form";
import { plainCount } from "@/ui/text";
import { MAX_EQ_NOTE } from "@/domain/eq-review";
import { canReview, type Role } from "@/domain/signoff";
import { roleLabel } from "@/ui/team-view";
import { setEqReviewAction, signEqReviewAction } from "./eq-review-actions";
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

/** Turn the engagement quality review on or off and choose the reviewer, for a partner or administrator on an open engagement. */
export function EqSettingForm({ engagementId, required, reviewerId, people, teamIds }: { engagementId: string; required: boolean; reviewerId: string | null; people: { id: string; name: string; role: Role }[]; teamIds: string[] }) {
  const [state, run, pending] = useActionState(setEqReviewAction, initial);
  const [on, setOn] = useState(required);
  const team = new Set(teamIds);
  // Only people the server would accept, plus the saved reviewer even if they no longer qualify, so the form shows what is set.
  const options = people.filter((p) => (canReview(p.role) && !team.has(p.id)) || p.id === reviewerId);
  return (
    <form onSubmit={send(run)}>
      <input type="hidden" name="engagementId" value={engagementId} />
      <fieldset disabled={pending} className="contents">
        <label className="flex min-h-10 items-center gap-2 text-sm font-medium text-ink">
          <input type="checkbox" name="required" checked={on} onChange={(e) => setOn(e.target.checked)} className="h-5 w-5" />
          Engagement quality review
        </label>
        {on && (
          <div className="mt-2 max-w-md">
            <Field label="EQ reviewer">
              <Select name="reviewerId" defaultValue={reviewerId ?? ""}>
                <option value="">Not chosen</option>
                {options.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({roleLabel(p.role)}){team.has(p.id) ? ", now on the team" : ""}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}
        <button className={`${buttonClass("secondary")} mt-3`} disabled={pending}>
          {pending ? "Saving…" : "Save quality review"}
        </button>
      </fieldset>
      <Message state={state} />
    </form>
  );
}

/** The named reviewer's sign-off, with an optional note. */
export function EqSignForm({ engagementId }: { engagementId: string }) {
  const [state, run, pending] = useActionState(signEqReviewAction, initial);
  return (
    <form onSubmit={send(run)}>
      <input type="hidden" name="engagementId" value={engagementId} />
      <fieldset disabled={pending} className="contents">
        <Field label="Note (optional)">
          <Textarea name="note" maxLength={MAX_EQ_NOTE} rows={3} />
        </Field>
        <button className={`${buttonClass("primary")} mt-3`} disabled={pending}>
          {pending ? "Saving…" : "Sign the quality review"}
        </button>
      </fieldset>
      <Message state={state} />
    </form>
  );
}
