import { ActionForm } from "@/app/action-form";
import { approveDeletionAction, cancelDeletionAction, requestDeletionAction, retryFilesAction } from "@/app/retention-actions";
import { countsSentence, DELETED_WORDS, KEPT_WORDS, MAX_REASON, NOT_SET, ONE_PARTNER, stateWords, TOTAL_ROWS } from "@/domain/retention";
import type { RetentionItem, RetentionView } from "@/server/retention";
import { Badge } from "./badge";
import { Button } from "./button";
import { Callout, EmptyState } from "./feedback";
import { Field, Input, Textarea } from "./form";
import { Disclosure } from "./controls";

/** One archived file: its dates, the state of any request, and what the signed-in person may do about it. Nothing is deleted from this list directly. */
function Item({ item, me, partners }: { item: RetentionItem; me: string; partners: number }) {
  const r = item.request;
  const mine = r?.state === "pending" && r.requesterId === me;
  return (
    <li className="space-y-3 px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="font-semibold">{item.clientName}</h3>
        {item.eligible ? <Badge tone="warning">Past retention</Badge> : <Badge tone="neutral">Not yet eligible</Badge>}
      </div>
      <dl className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-small text-ink-subtle">Period</dt>
          <dd className="tabular-nums">
            {item.periodStart} to {item.periodEnd}
          </dd>
        </div>
        <div>
          <dt className="text-small text-ink-subtle">Archived on</dt>
          <dd className="tabular-nums">{item.archivedOn}</dd>
        </div>
        <div>
          <dt className="text-small text-ink-subtle">Eligible from</dt>
          <dd className="tabular-nums">{item.eligibleFrom ?? "No period set"}</dd>
        </div>
      </dl>
      <p className="text-sm text-ink-muted">{r ? stateWords({ kind: r.state, requester: r.requester, at: r.state === "cancelled" ? (r.cancelledAt ?? r.at) : r.at }) : stateWords({ kind: "none" })}</p>

      {r?.state === "pending" && (
        <div className="space-y-3 rounded-md border border-border bg-surface-muted/40 p-3 text-sm">
          <p>
            <span className="font-medium">Reason given:</span> {r.reason}
          </p>
          <p>
            <span className="font-medium">What would be removed:</span> {countsSentence(r.counts)} ({TOTAL_ROWS(r.counts).toLocaleString("en-GB")} rows in all).
          </p>
          {mine ? (
            <p className="font-medium">You asked for this deletion, so a different partner has to approve it.</p>
          ) : partners < 2 ? (
            <p className="font-medium">{ONE_PARTNER}</p>
          ) : (
            <ActionForm action={approveDeletionAction} fields={{ requestId: String(r.id) }}>
              <div className="space-y-2">
                <Field label={`Type the client's name, ${item.clientName}, to delete this file`} hint="Exactly as shown. This cannot be undone.">
                  <Input name="typedName" autoComplete="off" required />
                </Field>
                <Button variant="danger">Approve and delete</Button>
              </div>
            </ActionForm>
          )}
          <ActionForm action={cancelDeletionAction} fields={{ requestId: String(r.id) }}>
            <Button variant="secondary">Cancel this request</Button>
          </ActionForm>
        </div>
      )}

      {item.eligible && r?.state !== "pending" && (
        <Disclosure summary="Request deletion of this file">
          <ActionForm action={requestDeletionAction} fields={{ engagementId: item.engagementId }}>
            <div className="space-y-3">
              <p className="text-sm text-ink-muted">Asking deletes nothing. A different partner-level person has to approve it by typing the client&apos;s name.</p>
              <Field label="Reason" hint={`Required. Up to ${MAX_REASON.toLocaleString("en-GB")} characters. It is recorded.`}>
                <Textarea name="reason" rows={3} maxLength={MAX_REASON} required />
              </Field>
              <Button variant="secondary">Request deletion</Button>
            </div>
          </ActionForm>
        </Disclosure>
      )}
    </li>
  );
}

/** The body of /firm/retention. */
export function RetentionBody({ view, me }: { view: RetentionView; me: string }) {
  const eligible = view.items.filter((i) => i.eligible).length;
  return (
    <div className="space-y-8">
      {view.years === null ? (
        <Callout variant="info" title="No retention period is set">
          {NOT_SET} The firm&apos;s administrator sets the period on the Firm page. The application states no period of its own.
        </Callout>
      ) : (
        <p className="text-sm">
          The firm keeps archived files for <span className="font-semibold">{view.years === 1 ? "1 year" : `${view.years} years`}</span>, counted from the day each was archived. {eligible === 0 ? "No file is past it yet." : `${eligible} ${eligible === 1 ? "file is" : "files are"} past it.`}
        </p>
      )}
      <Callout variant="warning" title="Deleting cannot be undone">
        <p>{DELETED_WORDS}</p>
        <p className="mt-2">{KEPT_WORDS}</p>
      </Callout>
      {view.partners < 2 && <Callout variant="info">{ONE_PARTNER}</Callout>}

      {view.pendingFiles.length > 0 && (
        <section aria-labelledby="files-heading" className="space-y-3">
          <h2 id="files-heading" className="text-lg font-semibold">
            Files still to remove
          </h2>
          <Callout variant="warning" title={`${view.pendingFiles.length} ${view.pendingFiles.length === 1 ? "file" : "files"} of deleted engagements still in storage`}>
            <p>The engagement&apos;s records are deleted, but these stored files could not be removed yet. Try again.</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 break-all">
              {view.pendingFiles.map((f) => (
                <li key={f.id}>
                  {f.clientName}: <span className="font-mono text-small">{f.key}</span>
                </li>
              ))}
            </ul>
            <ActionForm action={retryFilesAction} fields={{}} className="mt-3">
              <Button variant="primary">Try again to remove these files</Button>
            </ActionForm>
          </Callout>
        </section>
      )}

      <section aria-labelledby="archived-heading" className="space-y-3">
        <h2 id="archived-heading" className="text-lg font-semibold">
          Archived files
        </h2>
        {view.items.length === 0 ? (
          <EmptyState title="No archived files" description="A file appears here once a partner has archived it." />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface shadow-card">
            {view.items.map((i) => (
              <Item key={i.engagementId} item={i} me={me} partners={view.partners} />
            ))}
          </ul>
        )}
      </section>

      {view.purged.length > 0 && (
        <section aria-labelledby="purged-heading" className="space-y-3">
          <h2 id="purged-heading" className="text-lg font-semibold">
            Deleted files
          </h2>
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface text-sm shadow-card">
            {view.purged.map((p) => (
              <li key={p.purgeId} className="space-y-1 px-4 py-3">
                <p className="font-medium">
                  {p.clientName}, {p.periodStart} to {p.periodEnd}
                </p>
                <p className="text-ink-muted">
                  Archived {p.archivedOn}, deleted {p.purgedOn}. Removed {TOTAL_ROWS(p.counts).toLocaleString("en-GB")} rows: {countsSentence(p.counts)}.
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
