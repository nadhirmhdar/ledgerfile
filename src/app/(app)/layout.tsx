import Link from "next/link";
import { getSession } from "@/server/session";
import { signOutAction } from "@/app/auth-actions";
import { Button } from "@/ui/button";
import { ChevronDownIcon, UserIcon } from "@/ui/icons";
import { TopNav } from "@/ui/top-nav";

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
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex items-center gap-4">
            <Link href="/" className="py-3 text-lg font-bold tracking-tight text-accent">
              LedgerFile
            </Link>
            <TopNav />
          </div>
          <details className="group relative">
            <summary className="inline-flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-md px-2 text-sm font-medium text-ink hover:bg-surface-muted [&::-webkit-details-marker]:hidden">
              <UserIcon />
              <span className="max-w-40 truncate">{session.name}</span>
              <ChevronDownIcon className="transition-transform group-open:rotate-180" />
            </summary>
            <div className="absolute right-0 z-40 mt-1 w-64 rounded-lg border border-border bg-surface p-3 shadow-pop">
              <p className="font-semibold text-ink">{session.name}</p>
              <p className="text-sm text-ink-muted">
                <span className="capitalize">{session.role}</span> · {session.firmName}
              </p>
              <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
                <Link href="/account" className="inline-flex min-h-10 items-center rounded-md px-2 text-sm font-medium text-ink hover:bg-surface-muted">
                  Account
                </Link>
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
