"use client";

import { useState, type ReactNode } from "react";

/**
 * One line of a compact list, with a text-style button on the right that opens a panel under the row, full width. The panel's
 * content is passed in already built, so any form in it keeps its own action.
 */
export function ExpandRow({ head, label, children }: { head: ReactNode; label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="px-4 py-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {head}
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="inline-flex min-h-10 items-center rounded-md px-2 text-sm font-medium text-accent hover:bg-accent-soft sm:ml-auto">
          {label}
        </button>
      </div>
      {open && <div className="border-t border-border py-3">{children}</div>}
    </li>
  );
}
