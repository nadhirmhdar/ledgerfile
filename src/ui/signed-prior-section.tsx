import { SignedPriorForm, type SignedPriorRow } from "@/app/signed-prior-form";
import type { Check } from "@/domain/statements";
import { StatusBadge } from "./badge";
import { Callout } from "./feedback";
import { plainCount } from "./text";

/**
 * "Signed prior-year figures", for a client's first year in LedgerFile: the check against the signed statements (a warning, so it never stops a lock)
 * and, for a person who may edit the notes on an open engagement, the form to enter each figure. Everyone else reads the saved figures.
 */
export function SignedPriorSection({ engagementId, check, rows, canEnter }: { engagementId: string; check: Check; rows: SignedPriorRow[]; canEnter: boolean }) {
  const body = (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
      {/* A failing check sits in the box titled "Needs attention", so it does not repeat the words on a badge of its own. */}
      {check.passed && <StatusBadge status="done" label="Passed" />}
      <div className="min-w-0 flex-1 basis-60 text-ink">
        <p className={check.passed ? "" : "font-semibold"}>{check.label}.</p>
        {check.detail && <p className="text-ink-muted">{plainCount(check.detail)}</p>}
        {check.items && (
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-muted">
            {check.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
  return (
    <section aria-labelledby="signed-prior-heading" id="signed-prior" className="scroll-mt-4 space-y-3">
      <h2 id="signed-prior-heading" className="text-lg font-semibold text-ink">
        Signed prior-year figures
      </h2>
      <p className="text-sm text-ink-muted">
        This is the client&apos;s first year in LedgerFile, so there is no last-year file to compare the comparatives with. Enter each line as it appears in the
        statements that were signed; the check below is a warning and does not stop the file being locked.
      </p>
      {check.passed ? <div className="rounded-lg border border-border bg-surface px-4 py-3 shadow-card">{body}</div> : <Callout variant="warning" title="Needs attention">{body}</Callout>}
      {canEnter ? (
        <SignedPriorForm engagementId={engagementId} rows={rows} />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface shadow-card">
          {rows.map((r) => (
            <li key={r.key} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3">
              <p className="min-w-0 basis-full font-medium text-ink sm:basis-72">{r.label}</p>
              <p className="text-small text-ink-muted">
                In this file: <span className="font-medium text-ink">{r.comparative}</span>
              </p>
              <p className="text-small text-ink-muted">
                Signed: <span className="font-medium text-ink">{r.saved || "Not entered"}</span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
