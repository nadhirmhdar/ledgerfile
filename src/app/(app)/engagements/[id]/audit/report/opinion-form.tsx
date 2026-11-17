"use client";

import { useActionState, useState } from "react";
import { recordOpinionAction } from "@/app/opinion-actions";
import type { FormState } from "@/app/actions";
import { Button } from "@/ui/button";
import { Field, Input, Textarea } from "@/ui/form";
import { formProblems, OPINION_HINT, OPINION_KINDS, OPINION_LABEL, opinionFields } from "@/ui/opinion-view";
import type { OpinionKind } from "@/domain/report";

export interface OpinionDefaults {
  opinion: OpinionKind | "";
  basis: string;
  goingConcern: boolean;
  goingConcernNote: string;
  emphasis: string;
  otherMatter: string;
  reportDate: string;
}

const initial: FormState = { ok: true, message: "" };

/** The partner's form. What it shows follows the chosen opinion; the server applies the same rules again. */
export function OpinionForm({ engagementId, defaults }: { engagementId: string; defaults: OpinionDefaults }) {
  const [state, action, pending] = useActionState(recordOpinionAction, initial);
  const [kind, setKind] = useState<OpinionKind | "">(defaults.opinion);
  const [basis, setBasis] = useState(defaults.basis);
  const [gc, setGc] = useState(defaults.goingConcern);
  const [gcNote, setGcNote] = useState(defaults.goingConcernNote);
  const [date, setDate] = useState(defaults.reportDate);
  const fields = kind ? opinionFields(kind) : null;
  const problems = formProblems({ opinion: kind, basis, goingConcern: gc, goingConcernNote: gcNote, emphasis: "", reportDate: date });

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="engagementId" value={engagementId} />
      <fieldset disabled={pending} className="space-y-5">
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium text-ink">Opinion</legend>
          {OPINION_KINDS.map((k) => (
            <label key={k} className="flex items-start gap-3 rounded-md border border-border p-3 text-sm has-[:checked]:border-accent has-[:checked]:bg-surface-muted">
              <input type="radio" name="opinion" value={k} checked={kind === k} onChange={() => setKind(k)} className="mt-1 size-4 accent-accent" />
              <span>
                <span className="block font-medium text-ink">{OPINION_LABEL[k]}</span>
                <span className="block text-ink-muted">{OPINION_HINT[k]}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {fields?.basis && (
          <Field label="Basis for the modification" hint="Say what the matter is and what it affects. The report prints this paragraph as you write it. Required.">
            <Textarea name="basis" value={basis} onChange={(e) => setBasis(e.target.value)} maxLength={4000} rows={5} required />
          </Field>
        )}

        {fields?.goingConcern && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" name="goingConcern" checked={gc} onChange={(e) => setGc(e.target.checked)} className="size-4 accent-accent" />
              There is a material uncertainty about going concern
            </label>
            {gc && (
              <Field label="Note that discloses it" hint="The note number in the financial statements, for example 7. Use this only where the disclosure is adequate.">
                <Input name="goingConcernNote" value={gcNote} onChange={(e) => setGcNote(e.target.value)} maxLength={100} required className="max-w-48" />
              </Field>
            )}
          </div>
        )}

        {fields?.emphasis && (
          <Field label="Emphasis of matter (optional)" hint="A matter already disclosed that you want readers to notice. Written by you; the report adds that it does not change the opinion.">
            <Textarea name="emphasis" defaultValue={defaults.emphasis} maxLength={4000} rows={3} />
          </Field>
        )}

        {kind && (
          <Field label="Other matter (optional)" hint="Something other than what the statements disclose that you want to bring to readers' attention.">
            <Textarea name="otherMatter" defaultValue={defaults.otherMatter} maxLength={4000} rows={3} />
          </Field>
        )}

        <Field label="Report date">
          <Input type="date" name="reportDate" value={date} onChange={(e) => setDate(e.target.value)} required className="max-w-48" />
        </Field>

        <Button variant="primary" disabled={pending}>
          Record the opinion
        </Button>
      </fieldset>

      <div role="status" className="space-y-1 text-sm">
        {state.message && <p className={`font-medium ${state.ok ? "text-success-strong" : "text-danger-strong"}`}>{state.message}</p>}
        {problems.length > 0 && kind !== "" && (
          <ul className="list-disc pl-5 text-ink-muted">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
      </div>
    </form>
  );
}
