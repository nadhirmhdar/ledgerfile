"use client";

import { useState, type ReactNode } from "react";
import { ChevronDownIcon } from "./icons";

/**
 * A list row of two lines. The first line is what the row is; the second has the muted detail on the left and, on the right, a
 * quick action and a button that opens the rest of the row as a panel below, full width. The panel is passed in already built,
 * so any form in it keeps its own action.
 */
export function TwoLineRow({ line1, detail, quick, label, accessibleName, children }: { line1: ReactNode; detail: ReactNode; quick?: ReactNode; label: string; accessibleName: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="px-4 py-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">{line1}</div>
      <div className="mt-0.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="min-w-0 text-sm text-ink-muted">{detail}</div>
        <div className="flex flex-wrap items-center gap-2">
          {quick}
          <button
            type="button"
            aria-expanded={open}
            aria-label={accessibleName}
            onClick={() => setOpen((o) => !o)}
            className="inline-flex min-h-8 items-center gap-1 rounded-md border border-border-strong bg-surface px-3 text-sm font-medium text-accent hover:bg-accent-soft"
          >
            {label}
            <ChevronDownIcon className={`transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>
      {open && <div className="mt-2 border-t border-border pt-3">{children}</div>}
    </li>
  );
}
