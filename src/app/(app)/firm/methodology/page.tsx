import Link from "next/link";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import { listFirmMethodology } from "@/server/firm-methodology";
import { getAdoption } from "@/server/methodology-adoption";
import { adoptionLine } from "@/domain/methodology-adoption";
import { MethodologyLabel } from "@/ui/methodology-label";
import { AdoptionSection } from "@/ui/adoption-section";
import { LIBRARY_STATUS, ASSERTIONS } from "@/domain/audit";
import { ActionForm } from "@/app/action-form";
import { addProcedureAction, editOwnProcedureAction, editProcedureAction, hideProcedureAction, resetProcedureAction, restoreOwnProcedureAction, retireOwnProcedureAction, showProcedureAction } from "@/app/methodology-actions";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Callout } from "@/ui/feedback";
import { Field, Input, Select, Textarea } from "@/ui/form";
import { PageHeader } from "@/ui/layout";
import { SummaryChevron, summaryRow } from "@/ui/summary-cue";
import { ADDED_LABEL, areaSummary, canEditMethodology, CHANGES_APPLY, TIER_WORDS, FIRM_WORDING_NOTE, DRAFT_LABEL, DRAFT_LABEL_TITLE, PROTECTED_NOTE, STATE_BADGE } from "@/ui/methodology-view";
import { MAX_BODY, MAX_EVIDENCE, MAX_OWN_PER_AREA, MAX_REFERENCE } from "@/domain/firm-methodology";
import type { OwnProcedureView } from "@/server/firm-methodology";

export const dynamic = "force-dynamic";

const TIER = { core: "Core", extended: "Extended", significant: "Significant risk" } as const;
const ASSERTION = new Map<string, string>(ASSERTIONS.map((a) => [a.code, a.label]));

/** The fields for adding or changing one of the firm's own procedures. Only the assertions the library's area already covers can be chosen. */
function OwnFields({ choices, start }: { choices: string[]; start?: OwnProcedureView }) {
  return (
    <div className="space-y-3">
      <Field label="Tier" hint="Core procedures always load. Extended ones load when an assertion is rated above low, and significant-risk ones when it is a significant risk.">
        <Select name="tier" defaultValue={start?.tier ?? "core"}>
          {Object.entries(TIER_WORDS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
      <fieldset>
        <legend className="text-sm font-medium">Assertions</legend>
        <p className="text-sm text-ink-muted">Choose at least one. Only the assertions this area already covers can be chosen, so its risk assessment stays as it is.</p>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          {choices.map((a) => (
            <label key={a} className="inline-flex min-h-10 items-center gap-2 text-sm">
              <input type="checkbox" name="assertion" value={a} defaultChecked={start?.assertions.includes(a)} />
              {ASSERTION.get(a) ?? a}
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="Procedure" hint={`Up to ${MAX_BODY.toLocaleString("en-US")} characters.`}>
        <Textarea name="body" defaultValue={start?.body ?? ""} rows={5} maxLength={MAX_BODY} required />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Evidence" hint={`Up to ${MAX_EVIDENCE} characters. It cannot start with "Partner sign-off".`}>
          <Input name="evidence" defaultValue={start?.evidence ?? ""} maxLength={MAX_EVIDENCE} required />
        </Field>
        <Field label="Reference" hint={`Up to ${MAX_REFERENCE} characters. Optional.`}>
          <Input name="reference" defaultValue={start?.reference ?? ""} maxLength={MAX_REFERENCE} />
        </Field>
      </div>
    </div>
  );
}

export default async function FirmMethodologyPage() {
  const session = await getSession();
  const { areas, adoption } = await withFirm(await getDb(), session.firmId, async (tx) => ({ areas: await listFirmMethodology(tx), adoption: await getAdoption(tx) }));
  const mayEdit = canEditMethodology(session.role);

  return (
    <div className="py-8 text-ink">
      <PageHeader
        breadcrumb={[{ label: "All engagements", href: "/" }]}
        title="Methodology"
        note={
          <Link href="/firm" className="text-accent hover:underline">
            Back to the firm
          </Link>
        }
        subtitle={mayEdit ? "The audit procedures your firm loads into its programmes. Reword them, hide the ones you do not use, or go back to the library's wording." : "The audit procedures your firm loads into its programmes. A partner changes them."}
      />
      <div className="mt-6 space-y-8">
        <AdoptionSection state={adoption.state} history={adoption.history} changeCount={adoption.now.changeCount} version={adoption.now.version} mayEdit={mayEdit} />
        {/* A current adoption replaces the draft label on the methodology procedures (owner decision 2026-11-25). */}
        <MethodologyLabel
          state={adoption.state}
          draft={
            <Callout variant="draft" title={DRAFT_LABEL_TITLE}>
              {DRAFT_LABEL} ({LIBRARY_STATUS})
              <span className="mt-1 block font-medium">{adoptionLine(adoption.state)}</span>
            </Callout>
          }
        />
        <p className="text-sm text-ink-muted">{CHANGES_APPLY}</p>

        {areas.map((area) => (
          <details key={area.code} className="group rounded-lg border border-border bg-surface shadow-card">
            <summary className={`${summaryRow} font-semibold`}>
              <SummaryChevron />
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                <span>
                  {area.code} {area.title}
                </span>
                <span className="text-sm font-normal text-ink-muted">{areaSummary(area.procedures.map((p) => p.state))}</span>
              </span>
            </summary>
            <ul className="divide-y divide-border border-t border-border">
              {area.procedures.map((p) => {
                const badge = STATE_BADGE[p.state];
                return (
                  <li key={p.id} className="px-4 py-4 sm:px-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">{p.id}</h3>
                      <Badge tone="neutral">{TIER[p.tier]}</Badge>
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                    </div>
                    {p.assertions.length > 0 && <p className="mt-1 text-sm text-ink-muted">Assertions: {p.assertions.map((a) => ASSERTION.get(a) ?? a).join(", ")}</p>}
                    {p.state === "edited" && <p className="mt-2 text-sm font-medium text-ink-muted">{FIRM_WORDING_NOTE}</p>}
                    <p className={`mt-2 text-sm ${p.state === "hidden" ? "text-ink-muted line-through" : ""}`}>{p.current.text}</p>
                    <p className="mt-1 text-sm text-ink-muted">
                      Evidence: {p.current.evidence}. Reference: {p.current.reference}.
                    </p>
                    {p.protected && <p className="mt-1 text-sm text-ink-muted">{PROTECTED_NOTE}</p>}

                    {mayEdit && (
                      <div className="mt-3 space-y-3">
                        <details className="rounded-md border border-border">
                          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Edit the wording</summary>
                          <div className="border-t border-border p-3">
                            <ActionForm action={editProcedureAction} fields={{ templateId: p.id }}>
                              <div className="space-y-3">
                                <Field label="Procedure" hint={`Up to ${MAX_BODY.toLocaleString("en-US")} characters.`}>
                                  <Textarea name="body" defaultValue={p.current.text} rows={5} maxLength={MAX_BODY} required />
                                </Field>
                                <div className="grid gap-3 sm:grid-cols-2">
                                  <Field label="Evidence" hint={`Up to ${MAX_EVIDENCE} characters.`}>
                                    <Input name="evidence" defaultValue={p.current.evidence} maxLength={MAX_EVIDENCE} required />
                                  </Field>
                                  <Field label="Reference" hint={`Up to ${MAX_REFERENCE} characters.`}>
                                    <Input name="reference" defaultValue={p.current.reference} maxLength={MAX_REFERENCE} />
                                  </Field>
                                </div>
                                <Button variant="primary">Save</Button>
                              </div>
                            </ActionForm>
                          </div>
                        </details>
                        <div className="flex flex-wrap items-start gap-3">
                          {p.state === "edited" || p.state === "hidden" ? (
                            <ActionForm action={resetProcedureAction} fields={{ templateId: p.id }}>
                              <Button variant="secondary" size="sm">
                                Reset to library wording
                              </Button>
                            </ActionForm>
                          ) : null}
                          {p.state === "hidden" ? (
                            <ActionForm action={showProcedureAction} fields={{ templateId: p.id }}>
                              <Button variant="secondary" size="sm">
                                Show
                              </Button>
                            </ActionForm>
                          ) : !p.protected ? (
                            <ActionForm action={hideProcedureAction} fields={{ templateId: p.id }}>
                              <Button variant="secondary" size="sm">
                                Hide
                              </Button>
                            </ActionForm>
                          ) : null}
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {(area.own.length > 0 || mayEdit) && (
              <div className="border-t border-border px-4 py-4 sm:px-5">
                <h3 className="font-semibold">Your firm&apos;s own procedures</h3>
                {area.own.length === 0 && <p className="mt-1 text-sm text-ink-muted">None yet. A procedure you add is loaded after the library&apos;s, by tier and risk like any other.</p>}
                <ul className="mt-2 divide-y divide-border">
                  {area.own.map((o) => (
                    <li key={o.id} className="py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="font-semibold">{o.id}</h4>
                        <Badge tone="info">{ADDED_LABEL}</Badge>
                        <Badge tone="neutral">{TIER_WORDS[o.tier]}</Badge>
                        {o.retired && <Badge tone="warning">Retired</Badge>}
                      </div>
                      <p className="mt-1 text-sm text-ink-muted">Assertions: {o.assertions.map((a) => ASSERTION.get(a) ?? a).join(", ")}</p>
                      <p className={`mt-2 text-sm ${o.retired ? "text-ink-muted line-through" : ""}`}>{o.body}</p>
                      <p className="mt-1 text-sm text-ink-muted">
                        Evidence: {o.evidence}. Reference: {o.reference || "none"}.
                      </p>
                      {mayEdit && (
                        <div className="mt-3 space-y-3">
                          {!o.retired && (
                            <details className="rounded-md border border-border">
                              <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Edit the procedure</summary>
                              <div className="border-t border-border p-3">
                                <ActionForm action={editOwnProcedureAction} fields={{ templateId: o.id }}>
                                  <OwnFields choices={area.assertionChoices} start={o} />
                                  <Button variant="primary">Save</Button>
                                </ActionForm>
                              </div>
                            </details>
                          )}
                          <ActionForm action={o.retired ? restoreOwnProcedureAction : retireOwnProcedureAction} fields={{ templateId: o.id }}>
                            <Button variant="secondary" size="sm">
                              {o.retired ? "Restore" : "Retire"}
                            </Button>
                          </ActionForm>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
                {mayEdit &&
                  (area.canAdd ? (
                    <details className="mt-3 rounded-md border border-border">
                      <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Add a procedure</summary>
                      <div className="border-t border-border p-3">
                        <ActionForm action={addProcedureAction} fields={{ areaCode: area.code }}>
                          <OwnFields choices={area.assertionChoices} />
                          <Button variant="primary">Add the procedure</Button>
                        </ActionForm>
                      </div>
                    </details>
                  ) : (
                    <p className="mt-3 text-sm text-ink-muted">This area has the most procedures a firm can add ({MAX_OWN_PER_AREA}, retired ones included).</p>
                  ))}
              </div>
            )}
          </details>
        ))}
      </div>
    </div>
  );
}
