import { ActionForm } from "@/app/action-form";
import { adoptMethodologyAction, withdrawAdoptionAction } from "@/app/methodology-actions";
import { ADOPT_STATEMENT, adoptionSentence, changedWarning, MAX_NOTE, MAX_REASON, type AdoptionRecord, type AdoptionState } from "@/domain/methodology-adoption";
import { Badge } from "./badge";
import { Button } from "./button";
import { Callout } from "./feedback";
import { Field, Input, Textarea } from "./form";
import { Disclosure } from "./controls";

/**
 * The Adoption section at the top of the firm methodology page: whether a partner has recorded that the firm reviewed and adopted the library, what
 * changed since, and the history. The unreviewed-draft notice below it is not touched by any of this: adopting is the firm's statement, and the library
 * stays an unreviewed AI draft.
 */
export function AdoptionSection({ state, history, changeCount, version, mayEdit }: { state: AdoptionState; history: AdoptionRecord[]; changeCount: number; version: string; mayEdit: boolean }) {
  return (
    <section aria-labelledby="adoption-heading" className="space-y-3">
      <h2 id="adoption-heading" className="text-lg font-semibold">
        Adoption
      </h2>

      {state.kind === "none" && (
        <>
          <p className="text-sm text-ink-muted">
            {state.withdrawn ? `The adoption recorded on ${state.withdrawn.at} was withdrawn.` : "No partner has recorded that this firm has reviewed and adopted this methodology."} It is not adopted for this firm.
          </p>
          {mayEdit ? (
            <Disclosure summary="Record adoption for this firm">
              <AdoptForm version={version} changeCount={changeCount} />
            </Disclosure>
          ) : (
            <p className="text-sm text-ink-muted">A partner records adoption.</p>
          )}
        </>
      )}

      {state.kind === "current" && (
        <>
          <p className="text-sm font-medium">{adoptionSentence(state.adoption)}</p>
          {state.adoption.note && <p className="text-sm text-ink-muted">Note: {state.adoption.note}</p>}
          {mayEdit && <WithdrawForm />}
        </>
      )}

      {state.kind === "changed" && (
        <>
          <Callout variant="warning" title="Changed since it was adopted">
            {changedWarning(state.adoption, state.what)}
          </Callout>
          <p className="text-sm text-ink-muted">Last adopted: {adoptionSentence(state.adoption)}</p>
          {mayEdit ? (
            <div className="space-y-2">
              <Disclosure summary="Record adoption again">
                <AdoptForm version={version} changeCount={changeCount} />
              </Disclosure>
              <WithdrawForm />
            </div>
          ) : (
            <p className="text-sm text-ink-muted">A partner records adoption again.</p>
          )}
        </>
      )}

      {history.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold">History</h3>
          <ol className="mt-2 divide-y divide-border rounded-lg border border-border bg-surface text-sm shadow-card">
            {history.map((h) => (
              <li key={h.id} className="space-y-1 px-4 py-3">
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Badge tone={h.kind === "adopted" ? "info" : "neutral"}>{h.kind === "adopted" ? "Adopted" : "Withdrawn"}</Badge>
                  <span className="font-medium">{h.by}</span>
                  <span className="text-ink-muted tabular-nums">{h.at}</span>
                  <span className="text-ink-muted">library v{h.version}</span>
                  <span className="text-ink-muted">{h.changeCount === 1 ? "1 firm change" : `${h.changeCount} firm changes`}</span>
                </p>
                {h.kind === "adopted" && h.note && <p className="text-ink-muted">Note: {h.note}</p>}
                {h.kind === "withdrawn" && h.reason && <p className="text-ink-muted">Reason: {h.reason}</p>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

function AdoptForm({ version, changeCount }: { version: string; changeCount: number }) {
  return (
    <ActionForm action={adoptMethodologyAction} fields={{}}>
      <div className="space-y-3">
        <dl className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-small text-ink-subtle">Library version</dt>
            <dd className="font-medium">v{version}</dd>
          </div>
          <div>
            <dt className="text-small text-ink-subtle">The firm&apos;s changes</dt>
            <dd className="font-medium">{changeCount === 1 ? "1 change" : `${changeCount} changes`} (listed below)</dd>
          </div>
        </dl>
        <p className="rounded-md border border-border bg-surface-muted/50 px-3 py-2 text-sm">{ADOPT_STATEMENT}</p>
        <label className="flex min-h-10 items-center gap-2 text-sm font-medium">
          <input type="checkbox" name="confirm" value="yes" className="size-5 accent-accent" />I confirm
        </label>
        <Field label="Note (optional)" hint={`Up to ${MAX_NOTE.toLocaleString("en-GB")} characters.`}>
          <Textarea name="note" rows={3} maxLength={MAX_NOTE} />
        </Field>
        <p className="text-sm text-ink-muted">This records the firm&apos;s adoption. The library stays an unreviewed draft: nobody outside the firm has reviewed it.</p>
        <Button variant="primary">Record adoption</Button>
      </div>
    </ActionForm>
  );
}

function WithdrawForm() {
  return (
    <Disclosure summary="Withdraw adoption">
      <ActionForm action={withdrawAdoptionAction} fields={{}}>
        <div className="space-y-3">
          <Field label="Reason" hint={`Required. Up to ${MAX_REASON.toLocaleString("en-GB")} characters. It is recorded.`}>
            <Input name="reason" maxLength={MAX_REASON} required />
          </Field>
          <Button variant="secondary">Withdraw adoption</Button>
        </div>
      </ActionForm>
    </Disclosure>
  );
}
