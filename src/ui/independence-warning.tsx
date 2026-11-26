import type { Check } from "@/domain/statements";
import { StatusBadge } from "./badge";
import { Callout } from "./feedback";

/** The lock check for independence, beside the lock: a warning, so it never stops the partner locking. Passing shows one quiet line. */
export function IndependenceWarning({ check }: { check: Check }) {
  if (check.passed) {
    return (
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <StatusBadge status="done" label="Passed" />
        <span>{check.label}.</span>
      </p>
    );
  }
  return (
    <Callout variant="warning" title="Needs attention">
      <p className="font-semibold">{check.label}.</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {check.items?.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <p className="mt-1">This is a warning: it does not stop the file being locked.</p>
    </Callout>
  );
}
