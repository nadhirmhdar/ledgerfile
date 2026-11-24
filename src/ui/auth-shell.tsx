import type { ReactNode } from "react";
import { LedgerMark } from "./icons";

/** The LedgerFile name with its mark, set the way the top bar sets it. `onDark` is white with a white mark, for brand-deep surfaces. */
export function Wordmark({ className = "", onDark = false }: { className?: string; onDark?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-base font-semibold tracking-tight sm:gap-2 sm:text-lg ${onDark ? "text-white" : "text-ink"} ${className}`}>
      {onDark ? <LedgerMark className="text-white" inner="#0b1a3d" /> : <LedgerMark className="text-accent" />}
      LedgerFile
    </span>
  );
}

/**
 * The pages a signed-out visitor sees: a split screen. A brand-deep panel with a cobalt glow carries the mark and one line about what LedgerFile is
 * (a short band above the form on a phone); the form sits on a light surface, with the one h1 over it.
 */
export function AuthShell({ title, intro, footer, children }: { title: string; intro?: string; footer?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-1 flex-col lg:flex-row">
      <div
        className="relative overflow-hidden bg-brand-deep px-6 py-6 text-white lg:flex lg:w-[46%] lg:flex-col lg:justify-between lg:p-14"
        style={{ backgroundImage: "radial-gradient(60% 75% at 20% 60%, var(--color-brand-glow) 0%, transparent 72%)" }}
      >
        <Wordmark onDark className="text-lg sm:text-xl" />
        <p className="mt-3 max-w-md text-base leading-snug font-light text-brand-sub lg:mt-0 lg:text-4xl lg:leading-tight">
          Audit files for UAE practices, from trial balance to <span className="font-normal text-accent-bright">signed report</span>.
        </p>
        <p className="hidden text-sm text-brand-sub lg:block">Your trial balance, lead sheets, planning and statements, kept in one file.</p>
      </div>
      <main className="flex flex-1 items-start justify-center lg:items-center bg-surface px-4 py-10 text-ink sm:px-8 sm:py-14">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold text-ink">{title}</h1>
          {intro && <p className="mt-2 text-sm text-ink-muted">{intro}</p>}
          <div className="mt-6">{children}</div>
          {footer && <p className="mt-6 text-sm text-ink-muted">{footer}</p>}
        </div>
      </main>
    </div>
  );
}
