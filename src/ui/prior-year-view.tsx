import type { Check } from "@/domain/statements";
import Link from "next/link";
import { NO_COMPARATIVES, NOT_LINKED, priorBasis } from "@/domain/prior-year-checks";
import type { PriorYearResult } from "@/server/prior-year-checks";
import { StatusBadge } from "./badge";
import { Callout } from "./feedback";
import { plainCount } from "./text";

/** The warnings that need a person, for the overview's "Needs attention". Empty when they all pass. */
export const priorYearAttention = (r: PriorYearResult | null): Check[] => (r && r.linked ? r.checks.filter((c) => !c.passed) : []);

/**
 * The checks against last year's file, under the statements' own checks. They are warnings, so they are shown in the warning tone with the words
 * "Needs attention" and an icon, never by colour alone, and they say they do not stop the file being locked.
 */
export function PriorYearChecks({ result, engagementId }: { result: PriorYearResult; engagementId: string }) {
  if (!result.linked) return <p className="text-sm text-ink-muted">{NOT_LINKED}</p>;
  const failing = result.checks.filter((c) => !c.passed);
  const rows = (
    <ul className="divide-y divide-border">
      {[...failing, ...result.checks.filter((c) => c.passed)].map((c) => (
        <li key={c.label} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0">
          {/* A failing check sits in the box titled "Needs attention", so it does not repeat the words on a badge of its own. */}
          {c.passed && <StatusBadge status="done" label="Passed" />}
          <div className="min-w-0 flex-1 basis-60 text-ink">
            <p className={c.passed ? "" : "font-semibold"}>{c.label}.</p>
            {c.detail && <p className="text-ink-muted">{plainCount(c.detail)}</p>}
            {c.items && (
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-muted">
                {c.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
            {c.detail === NO_COMPARATIVES && (
              <Link href={`/engagements/${engagementId}/trial-balance`} className="mt-0.5 inline-block font-medium text-accent underline underline-offset-2">
                Open trial balance and mapping
              </Link>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
  return (
    <section aria-labelledby="prior-year-checks" className="space-y-2">
      <h2 id="prior-year-checks" className="text-lg font-semibold text-ink">
        Checks against last year
      </h2>
      <p className="text-sm text-ink-muted">Compared with {priorBasis(result.priorSigned)}. These are warnings: they do not stop the file being locked, because a restatement is a legitimate reason for a difference.</p>
      {failing.length > 0 ? (
        <Callout variant="warning" title="Needs attention">
          {rows}
        </Callout>
      ) : (
        <div className="rounded-lg border border-border bg-surface px-4 py-3 shadow-card">{rows}</div>
      )}
    </section>
  );
}
