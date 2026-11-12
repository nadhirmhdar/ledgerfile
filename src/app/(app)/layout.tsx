import Link from "next/link";
import { getSession } from "@/server/session";
import { signOutAction } from "@/app/auth-actions";

export const dynamic = "force-dynamic";

/** Everything under this layout requires a signed-in user. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  return (
    <>
      <header className="border-b border-slate-200 bg-slate-50 text-slate-900">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <nav aria-label="Main" className="flex items-center gap-5 text-sm">
            <Link href="/" className="text-base font-semibold">LedgerFile</Link>
            <Link href="/" className="text-blue-700 underline">Engagements</Link>
            <Link href="/team" className="text-blue-700 underline">Team</Link>
          </nav>
          <div className="flex items-center gap-3 text-sm">
            <span>
              {session.name} · <span className="capitalize">{session.role}</span> · {session.firmName}
            </span>
            <form action={signOutAction}>
              <button className="rounded border border-slate-400 px-3 py-1 hover:bg-slate-100">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      {children}
    </>
  );
}
