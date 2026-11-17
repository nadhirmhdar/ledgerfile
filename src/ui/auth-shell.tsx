import type { ReactNode } from "react";

/** The LedgerFile name, set the way the top bar sets it. */
export function Wordmark({ className = "" }: { className?: string }) {
  return <span className={`text-lg font-bold tracking-tight text-accent ${className}`}>LedgerFile</span>;
}

/** A centred card on the page background for the pages a signed-out visitor sees: the wordmark above, the one h1 inside the card. */
export function AuthShell({ title, intro, footer, children }: { title: string; intro?: string; footer?: ReactNode; children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-md px-4 py-10 text-ink sm:py-16">
      <p className="mb-4 text-center">
        <Wordmark />
      </p>
      <div className="rounded-lg border border-border bg-surface px-5 py-6 shadow-card sm:px-6">
        <h1 className="text-2xl font-bold text-ink">{title}</h1>
        {intro && <p className="mt-2 text-sm text-ink-muted">{intro}</p>}
        <div className="mt-5">{children}</div>
      </div>
      {footer && <p className="mt-5 text-center text-sm text-ink-muted">{footer}</p>}
    </main>
  );
}
