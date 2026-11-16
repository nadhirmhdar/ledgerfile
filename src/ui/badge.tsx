import type { ReactNode } from "react";
import { LockIcon } from "./icons";
import { STATUS_LABEL, statusTone, type Status, type Tone } from "./status";

const TEXT: Record<Tone, string> = {
  neutral: "text-neutral-strong",
  info: "text-info-strong",
  warning: "text-warning-strong",
  success: "text-success-strong",
  danger: "text-danger-strong",
  muted: "text-ink-muted",
  slate: "text-neutral-strong",
};
const DOT: Record<Tone, string> = {
  neutral: "border-2 border-neutral bg-transparent",
  info: "bg-info",
  warning: "bg-warning",
  success: "bg-success",
  danger: "bg-danger",
  muted: "bg-ink-subtle opacity-60",
  slate: "bg-neutral-strong",
};

/** A coloured dot and a short word. The word always carries the meaning; the dot only adds to it. */
export function Badge({ tone = "neutral", children, className = "" }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${TEXT[tone]} ${className}`}>
      {tone === "slate" ? <LockIcon width={14} height={14} /> : <span aria-hidden="true" className={`inline-block size-2.5 shrink-0 rounded-full ${DOT[tone]}`} />}
      {children}
    </span>
  );
}

/** A status from the app's fixed vocabulary. `label` replaces the standard word when a stage needs a more exact one ("Ready to lock"). */
export function StatusBadge({ status, label, className }: { status: Status; label?: string; className?: string }) {
  return (
    <Badge tone={statusTone(status)} className={className}>
      {label ?? STATUS_LABEL[status]}
    </Badge>
  );
}
