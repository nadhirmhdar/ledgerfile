import { ActionForm } from "@/app/action-form";
import { saveFirmDefaultsAction } from "@/app/statement-defaults-actions";
import { MAX_PARAGRAPH_LENGTH, MAX_PARAGRAPHS, policyKey, STANDARD_NOTES } from "@/domain/note-texts";
import { POLICIES } from "@/domain/policies";
import { paragraphsToText, UNIT_LABEL, type Unit } from "@/domain/statement-defaults";
import type { FirmDefaults } from "@/server/statement-defaults";
import { Button } from "./button";
import { Card } from "./layout";
import { Field, Input, Select, Textarea } from "./form";
import { Disclosure } from "./controls";

const FRAMEWORK: { key: string; title: string }[] = [
  { key: "general", title: "General information" },
  { key: "basis", title: "Basis of preparation" },
  { key: "policies", title: "Introduction to the accounting policies" },
];

/**
 * The firm's statement defaults: the presentation currency, the rounding and default wording for notes passages. Copied onto NEW engagements when
 * they are created; an existing engagement never changes. A partner edits; everyone else reads. Wording left blank means the app's generated wording,
 * which keeps its unreviewed-draft label.
 */
export function StatementDefaultsSection({ defaults, mayEdit }: { defaults: FirmDefaults; mayEdit: boolean }) {
  const unit: Unit = defaults.unit ?? "exact";
  const text = (key: string) => (defaults.notes.get(key) ? paragraphsToText(defaults.notes.get(key)!.paragraphs) : "");
  const set = [...defaults.notes.keys()].length;
  return (
    <Card
      title="Statement defaults"
      description="Used for new engagements only, copied when the engagement is created. Changing them later does not change an engagement that already exists. The app's own generated wording stays an unreviewed draft."
    >
      {!mayEdit ? (
        <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-small text-ink-subtle">Presentation currency</dt>
            <dd className="font-medium">{defaults.currency ?? "Not set"}</dd>
          </div>
          <div>
            <dt className="text-small text-ink-subtle">Rounding</dt>
            <dd className="font-medium">{UNIT_LABEL[unit]}</dd>
          </div>
          <div>
            <dt className="text-small text-ink-subtle">Default wording</dt>
            <dd className="font-medium">{set === 0 ? "None" : `${set} ${set === 1 ? "passage" : "passages"}`}</dd>
          </div>
          <p className="text-sm text-ink-muted sm:col-span-3">A partner changes the statement defaults.</p>
        </dl>
      ) : (
        <ActionForm action={saveFirmDefaultsAction} fields={{}}>
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Presentation currency" hint="Three letters, such as AED. Blank for none: statements then show [currency] to complete.">
                <Input name="currency" defaultValue={defaults.currency ?? ""} maxLength={3} autoCapitalize="characters" />
              </Field>
              <Field label="Rounding" hint="The default view and export of each new engagement. The Exact / Whole units toggle still overrides it.">
                <Select name="unit" defaultValue={defaults.unit ?? "exact"}>
                  <option value="exact">{UNIT_LABEL.exact}</option>
                  <option value="whole">{UNIT_LABEL.whole}</option>
                </Select>
              </Field>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Default wording for the notes</h3>
              <p className="text-sm text-ink-muted">
                Written as plain paragraphs, separated by a blank line (up to {MAX_PARAGRAPHS}, each up to {MAX_PARAGRAPH_LENGTH.toLocaleString("en-GB")} characters). Leave a passage blank to use the generated wording. A new engagement starts with this wording and
                labels it as the firm&apos;s default, with the date.
              </p>
              {FRAMEWORK.map((p) => (
                <Field key={p.key} label={p.title}>
                  <Textarea name={`note:${p.key}`} defaultValue={text(p.key)} rows={4} />
                </Field>
              ))}
              <Disclosure summary={`Other standard notes (${STANDARD_NOTES.length})`}>
                <div className="space-y-3">
                  {STANDARD_NOTES.map((n) => (
                    <Field key={n.key} label={n.title}>
                      <Textarea name={`note:${n.key}`} defaultValue={text(n.key)} rows={3} />
                    </Field>
                  ))}
                </div>
              </Disclosure>
              <Disclosure summary={`Accounting policies (${POLICIES.length})`}>
                <div className="space-y-3">
                  {POLICIES.map((p) => (
                    <Field key={p.title} label={p.title}>
                      <Textarea name={`note:${policyKey(p.title)}`} defaultValue={text(policyKey(p.title))} rows={3} />
                    </Field>
                  ))}
                </div>
              </Disclosure>
            </div>
            <Button variant="primary">Save the statement defaults</Button>
          </div>
        </ActionForm>
      )}
    </Card>
  );
}
