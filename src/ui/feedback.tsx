import Link from "next/link";
import type { ReactNode } from "react";
import { StatusBadge } from "./badge";
import { AlertIcon, CheckIcon, InboxIcon, InfoIcon, LockIcon, SparkIcon } from "./icons";
import type { Status } from "./status";
import { fraction } from "./text";

type CalloutVariant = "info" | "success" | "warning" | "danger" | "draft" | "locked";
// One callout, four tones (info, success, warning, danger) and two that borrow one: a soft tint, a 3 px bar at the left in the tone colour, and an icon
// in that colour. No full saturated fill and no full border.
const CALLOUT: Record<CalloutVariant, { box: string; icon: ReactNode; iconColour: string }> = {
  info: { box: "border-l-info bg-info-tint text-info-strong", icon: <InfoIcon />, iconColour: "text-info" },
  success: { box: "border-l-success bg-success-tint text-success-strong", icon: <CheckIcon />, iconColour: "text-success" },
  warning: { box: "border-l-warning bg-warning-tint text-warning-strong", icon: <AlertIcon />, iconColour: "text-warning" },
  danger: { box: "border-l-danger bg-danger-tint text-danger-strong", icon: <AlertIcon />, iconColour: "text-danger" },
  // Machine-written text that no person has checked yet: it must stay clearly visible wherever it is shown (the words "unreviewed draft" stay in it).
  draft: { box: "border-l-warning bg-warning-tint text-warning-strong", icon: <SparkIcon />, iconColour: "text-warning" },
  locked: { box: "border-l-neutral bg-neutral-tint text-neutral-strong", icon: <LockIcon />, iconColour: "text-neutral" },
};

/** A short message that is not part of the flow. The draft variant is for "AI draft: not reviewed" labels. */
export function Callout({ variant = "info", title, children, className = "" }: { variant?: CalloutVariant; title?: string; children?: ReactNode; className?: string }) {
  const v = CALLOUT[variant];
  return (
    <div role={variant === "danger" ? "alert" : "note"} className={`flex gap-3 rounded-lg border-l-[3px] px-4 py-3 text-sm ${v.box} ${className}`}>
      <span className={`mt-0.5 shrink-0 ${v.iconColour}`}>{v.icon}</span>
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? "mt-1" : ""}>{children}</div>}
      </div>
    </div>
  );
}

/** Nothing here yet: a small line icon, what this place is for, and the one thing to do about it (when the person can do it). */
export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-border-input bg-surface px-6 py-10 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-surface-muted text-ink-subtle [&>svg]:size-6">{icon ?? <InboxIcon />}</span>
      <h2 className="mt-4 text-base font-semibold text-ink">{title}</h2>
      <p className="mt-1 max-w-md text-sm text-ink-muted">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Progress as a bar and a figure: role="progressbar", with the words beside it so the bar is never the only sign. */
export function ProgressBar({ value, max, label, tone = "accent", showText = true }: { value: number; max: number; label: string; tone?: "accent" | "success"; showText?: boolean }) {
  const pct = max <= 0 ? 0 : Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="flex items-center gap-3">
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={Math.max(max, 0)}
        aria-valuenow={Math.min(value, Math.max(max, 0))}
        aria-valuetext={fraction(value, max)}
        className="h-1.5 min-w-16 flex-1 overflow-hidden rounded-full bg-track"
      >
        <div className={`h-full rounded-full ${tone === "success" ? "bg-success" : "bg-accent"}`} style={{ width: `${pct}%` }} />
      </div>
      {showText && <span className="shrink-0 text-small text-ink-muted tabular-nums">{fraction(value, max)}</span>}
    </div>
  );
}

export interface Step {
  key: string;
  title: string;
  summary: string;
  status: Status;
  statusLabel?: string;
  done: number;
  total: number;
  href: string;
}

/** Numbered stages in work order, each with its status, how far it has got, and a link to where the work is. */
export function StepList({ steps }: { steps: Step[] }) {
  // The current stage is the first one not done: it gets a ring.
  const current = steps.findIndex((s) => s.status !== "done");
  return (
    <ol className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface shadow-card">
      {steps.map((s, i) => (
        <li key={s.key} className="relative grid grid-cols-[2rem_1fr] gap-x-4 gap-y-1 px-4 py-4 transition-colors hover:bg-surface-muted/60 sm:px-6">
          <span
            aria-hidden="true"
            className={`flex size-8 items-center justify-center rounded-full text-sm font-semibold text-white ${s.status === "done" ? "bg-success" : "bg-accent"} ${i === current ? "ring-2 ring-accent ring-offset-2 ring-offset-surface" : ""}`}
          >
            {s.status === "done" ? <CheckIcon /> : i + 1}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <h3 className="text-base font-semibold text-ink">
                <Link href={s.href} className="rounded-sm after:absolute after:inset-0 hover:text-accent hover:underline">
                  {s.title}
                </Link>
              </h3>
              <StatusBadge status={s.status} label={s.statusLabel} />
            </div>
            <p className="mt-1 text-sm text-ink-muted">{s.summary}</p>
            {s.total > 1 && (
              <div className="mt-3 max-w-md">
                <ProgressBar value={s.done} max={s.total} label={`${s.title}: ${s.done} of ${s.total} done`} tone={s.status === "done" ? "success" : "accent"} />
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
