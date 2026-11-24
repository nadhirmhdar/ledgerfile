"use client";

import { useState } from "react";
import { buttonClass } from "@/ui/button";

/**
 * One click puts the suggested ratings into the area's form, in the blanks only. It saves nothing: the person reads the form and presses Save. It sits
 * inside the form that holds the rating selects, and never changes a select that already has a rating.
 */
export function SuggestionFill({ fill }: { fill: { assertion: string; level: string }[] }) {
  const [filled, setFilled] = useState<number | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        className={buttonClass("secondary")}
        onClick={(e) => {
          const form = e.currentTarget.closest("form");
          let n = 0;
          for (const f of fill) {
            const el = form?.elements.namedItem(`risk-${f.assertion}`);
            if (el instanceof HTMLSelectElement && el.value === "") {
              el.value = f.level;
              el.dispatchEvent(new Event("change", { bubbles: true }));
              n++;
            }
          }
          setFilled(n);
        }}
      >
        Fill the form with the suggestions
      </button>
      {filled !== null && (
        <span role="status" className="text-sm text-ink-muted">
          {filled === 0 ? "Nothing to fill: every suggested assertion already has a rating." : `Filled ${filled}. Nothing is saved until you press Save.`}
        </span>
      )}
    </span>
  );
}
