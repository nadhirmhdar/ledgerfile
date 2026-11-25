"use client";

import { startTransition, useActionState } from "react";
import { buttonClass } from "@/ui/button";
import { Field, Input, Select } from "@/ui/form";
import { SLOT_LABEL, SLOTS, NOT_ASSIGNED, type Slot } from "@/domain/my-work";
import { roleLabel } from "@/ui/team-view";
import { plainCount } from "@/ui/text";
import { assignTeamAction } from "./team-actions";
import type { FormState } from "./actions";

const initial: FormState = { ok: true, message: "" };

export interface PersonOption {
  id: string;
  name: string;
  role: string;
}

/**
 * The Team form on an engagement's overview, for a partner or administrator. The values stay in the form when a check fails. The server checks
 * everything again, including that the person is an active member of this firm.
 */
export function EngagementTeamForm({
  engagementId,
  people,
  current,
}: {
  engagementId: string;
  people: PersonOption[];
  current: { preparerId: string | null; reviewerId: string | null; partnerId: string | null; reportDueOn: string | null };
}) {
  const [state, run, pending] = useActionState(assignTeamAction, initial);
  const selected: Record<Slot, string | null> = { preparer: current.preparerId, reviewer: current.reviewerId, partner: current.partnerId };
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SLOTS.map((slot) => (
            <Field key={slot} label={SLOT_LABEL[slot]}>
              <Select name={`${slot}Id`} defaultValue={selected[slot] ?? ""}>
                <option value="">{NOT_ASSIGNED}</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({roleLabel(p.role)})
                  </option>
                ))}
              </Select>
            </Field>
          ))}
          <Field label="Report due">
            <Input name="reportDueOn" type="date" defaultValue={current.reportDueOn ?? ""} />
          </Field>
        </div>
        <button className={`${buttonClass("primary")} mt-4`} disabled={pending}>
          {pending ? "Saving…" : "Save the team"}
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
