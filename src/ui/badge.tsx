import type { ReactNode } from "react";
import { BangIcon, CheckIcon, CrossIcon, DashIcon, DotIcon, LockIcon, RingIcon } from "./icons";
import { STATUS_LABEL, statusTone, type Status, type Tone } from "./status";

const PILL: Record<Tone, string> = {
  neutral: "bg-neutral-soft text-neutral-strong",
  info: "bg-info-soft text-info-strong",
  warning: "bg-warning-soft text-warning-strong",
  success: "bg-success-soft text-success-strong",
  danger: "bg-danger-soft text-danger-strong",
  muted: "bg-surface-muted text-ink-muted",
  slate: "bg-neutral-soft text-neutral-strong",
};
const ICON: Record<Tone, ReactNode> = {
  neutral: <RingIcon />,
  info: <DotIcon />,
  warning: <BangIcon />,
  success: <CheckIcon />,
  danger: <CrossIcon />,
  muted: <DashIcon />,
  slate: <LockIcon />,
};

/**
 * A chip: one size (12 px, weight 500, so it never competes with a title), a small icon and a sentence-case word. The word carries the meaning; the
 * icon and the tint only add to it.
 */
export function Badge({ tone = "neutral", children, className = "" }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap [&>svg]:size-3 ${PILL[tone]} ${className}`}>
      {ICON[tone]}
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
