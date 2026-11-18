import Link from "next/link";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import { listFirmMethodology } from "@/server/firm-methodology";
import { LIBRARY_STATUS, ASSERTIONS } from "@/domain/audit";
import { ActionForm } from "@/app/action-form";
import { editProcedureAction, hideProcedureAction, resetProcedureAction, showProcedureAction } from "@/app/methodology-actions";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Callout } from "@/ui/feedback";
import { Field, Input, Textarea } from "@/ui/form";
import { PageHeader } from "@/ui/layout";
import { SummaryChevron, summaryRow } from "@/ui/summary-cue";
import { areaSummary, canEditMethodology, CHANGES_APPLY, FIRM_WORDING_NOTE, DRAFT_LABEL, DRAFT_LABEL_TITLE, PROTECTED_NOTE, STATE_BADGE } from "@/ui/methodology-view";
import { MAX_BODY, MAX_EVIDENCE, MAX_REFERENCE } from "@/domain/firm-methodology";

export const dynamic = "force-dynamic";

const TIER = { core: "Core", extended: "Extended", significant: "Significant risk" } as const;
const ASSERTION = new Map<string, string>(ASSERTIONS.map((a) => [a.code, a.label]));

export default async function FirmMethodologyPage() {
  const session = await getSession();
  const areas = await withFirm(await getDb(), session.firmId, (tx) => listFirmMethodology(tx));
  const mayEdit = canEditMethodology(session.role);

  return (
    <div className="py-8 text-ink">
      <PageHeader
        breadcrumb={[{ label: "All engagements", href: "/" }]}
        title="Methodology"
        meta={
          <Link href="/firm" className="text-accent hover:underline">
            Back to the firm
          </Link>
        }
        subtitle={mayEdit ? "The audit procedures your firm loads into its programmes. Reword them, hide the ones you do not use, or go back to the library's wording." : "The audit procedures your firm loads into its programmes. A partner changes them."}
      />
      <div className="mt-6 space-y-4">
        <Callout variant="draft" title={DRAFT_LABEL_TITLE}>
          {DRAFT_LABEL} ({LIBRARY_STATUS})
        </Callout>
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
          </details>
        ))}
      </div>
    </div>
  );
}
