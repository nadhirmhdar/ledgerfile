import type { ReactNode } from "react";
import { buttonClass } from "./button";

/** Class names for form controls that sit inside existing forms (a plain element keeps its name, value and label as they are). */
export const ctl = "min-h-10 max-w-full rounded-md border border-border-strong bg-surface px-3 py-1.5 text-sm text-ink";
export const ctlWarn = "min-h-10 max-w-full rounded-md border border-warning bg-warning-soft px-3 py-1.5 text-sm text-ink";
export const fieldLabel = "flex min-w-0 max-w-full flex-col gap-1 text-sm font-medium text-ink";

/** A closed section that opens in place. The summary looks like a secondary button, so it reads as an action. */
export function Disclosure({ summary, open = false, children, className = "" }: { summary: string; open?: boolean; children: ReactNode; className?: string }) {
  return (
    <details open={open} className={`rounded-lg border border-border bg-surface shadow-card ${className}`}>
      <summary className={`${buttonClass("secondary")} m-3 w-fit cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>{summary}</summary>
      <div className="border-t border-border px-4 py-4 sm:px-5">{children}</div>
    </details>
  );
}
