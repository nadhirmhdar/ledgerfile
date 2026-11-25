import Link from "next/link";
import { getSession } from "@/server/session";
import { signOutAction } from "@/app/auth-actions";
import { Button } from "@/ui/button";
import { Wordmark } from "@/ui/auth-shell";
import { ChevronDownIcon, UserIcon } from "@/ui/icons";
import { roleLabel } from "@/ui/team-view";
import { TopNav } from "@/ui/top-nav";
import { canManageFirm } from "@/ui/branding-view";
import { canLock } from "@/domain/signoff";
import { canEditMethodology } from "@/ui/methodology-view";

export const dynamic = "force-dynamic";

/** Everything under this layout requires a signed-in user. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  return (
    <>
      <a
        href="#main"
        className="sr-only rounded-md bg-accent px-4 py-2 text-sm font-medium text-surface focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50"
      >
        Skip to main content
      </a>
      <header className="bg-brand-deep text-white">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-stretch justify-between gap-x-2 px-4 sm:flex-nowrap sm:gap-3 sm:px-6">
          <div className="contents sm:flex sm:min-w-0 sm:items-stretch sm:gap-8">
            <Link href="/" aria-label="LedgerFile, engagements" className="flex min-h-14 items-center rounded-sm focus-visible:outline-accent-bright max-sm:mr-auto">
              <Wordmark onDark />
            </Link>
            <TopNav admin={canManageFirm(session.role)} />
          </div>
          <details className="group relative self-center">
            <summary aria-label={session.name} className="inline-flex min-h-10 min-w-10 shrink-0 cursor-pointer justify-center list-none items-center gap-2 rounded-md px-2 text-sm font-medium text-white transition-colors hover:bg-white/10 focus-visible:outline-accent-bright [&::-webkit-details-marker]:hidden">
              <UserIcon />
              <span className="hidden max-w-40 truncate sm:inline">{session.name}</span>
              <ChevronDownIcon className="hidden transition-transform group-open:rotate-180 sm:block" />
            </summary>
            <div className="absolute right-0 z-40 mt-1 w-64 rounded-lg border border-border bg-surface p-3 shadow-pop">
              <p className="font-semibold text-ink">{session.name}</p>
              <p className="text-sm text-ink-muted">
                {roleLabel(session.role)} · {session.firmName}
              </p>
              <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
                <Link href="/account" className="inline-flex min-h-10 items-center rounded-md px-2 text-sm font-medium text-ink hover:bg-surface-muted">
                  Account
                </Link>
                {canEditMethodology(session.role) && (
                  <Link href="/firm/methodology" className="inline-flex min-h-10 items-center rounded-md px-2 text-sm font-medium text-ink hover:bg-surface-muted">
                    Methodology
                  </Link>
                )}
                {canLock(session.role) && (
                  <Link href="/firm/audit-log" className="inline-flex min-h-10 items-center rounded-md px-2 text-sm font-medium text-ink hover:bg-surface-muted">
                    Audit log
                  </Link>
                )}
                {canManageFirm(session.role) && (
                  <Link href="/firm" className="inline-flex min-h-10 items-center rounded-md px-2 text-sm font-medium text-ink hover:bg-surface-muted">
                    Firm
                  </Link>
                )}
                <form action={signOutAction}>
                  <Button variant="secondary" className="w-full">
                    Sign out
                  </Button>
                </form>
              </div>
            </div>
          </details>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 px-4 sm:px-6">
        {children}
      </main>
    </>
  );
}
