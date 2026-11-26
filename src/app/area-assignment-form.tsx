"use client";

import { startTransition, useActionState, useState } from "react";
import { buttonClass } from "@/ui/button";
import { Field, Select } from "@/ui/form";
import { slotOptions } from "@/domain/my-work";
import { SAME_AS_ENGAGEMENT } from "@/domain/area-assignments";
import { roleLabel } from "@/ui/team-view";
import { plainCount } from "@/ui/text";
import { setAreaAssignmentAction } from "./team-actions";
import type { FormState } from "./actions";
import type { PersonOption } from "./engagement-team-form";

const initial: FormState = { ok: true, message: "" };

export interface AreaOption {
  code: string;
  title: string;
}

/**
 * Set one audit area's own preparer and reviewer, for a partner or administrator on an open engagement. "Same as the engagement" clears the place. With
 * `fixedArea` the form is for that one area (on the area's own page); without it the form offers a choice of area (on the Team panel). The values stay
 * in the form when a check fails, and the server checks everything again, including that each person is an active member of this firm.
 */
export function AreaAssignmentForm({
  engagementId,
  people,
  areas,
  current,
  fixedArea,
}: {
  engagementId: string;
  people: PersonOption[];
  areas: AreaOption[];
  /** The areas that have their own people today, by area code. */
  current: Record<string, { preparerId: string | null; reviewerId: string | null }>;
  fixedArea?: string;
}) {
  const [state, run, pending] = useActionState(setAreaAssignmentAction, initial);
  const [area, setArea] = useState(fixedArea ?? areas[0]?.code ?? "");
  const now = current[area] ?? { preparerId: null, reviewerId: null };
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {fixedArea ? (
            <input type="hidden" name="areaCode" value={fixedArea} />
          ) : (
            <Field label="Area">
              <Select name="areaCode" value={area} onChange={(e) => setArea(e.target.value)}>
                {areas.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.code} {a.title}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Area preparer">
            <Select key={`p-${area}-${now.preparerId ?? ""}`} name="preparerId" defaultValue={now.preparerId ?? ""}>
              <option value="">{SAME_AS_ENGAGEMENT}</option>
              {slotOptions("preparer", people, now.preparerId).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({roleLabel(p.role)})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Area reviewer">
            <Select key={`r-${area}-${now.reviewerId ?? ""}`} name="reviewerId" defaultValue={now.reviewerId ?? ""}>
              <option value="">{SAME_AS_ENGAGEMENT}</option>
              {slotOptions("reviewer", people, now.reviewerId).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({roleLabel(p.role)}){p.stale ? ", no longer a reviewer" : ""}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <button className={`${buttonClass("primary")} mt-4`} disabled={pending}>
          {pending ? "Saving…" : "Save the area's team"}
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
