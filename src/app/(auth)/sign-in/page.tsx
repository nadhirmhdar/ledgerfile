import Link from "next/link";
import { redirect } from "next/navigation";
import { getOptionalSession } from "@/server/session";
import { SignInForm } from "@/app/auth-forms";

export const dynamic = "force-dynamic";

export default async function SignInPage() {
  if (await getOptionalSession()) redirect("/");
  return (
    <main className="mx-auto w-full max-w-sm px-4 py-16 text-slate-900">
      <h1 className="text-2xl font-semibold">Sign in to LedgerFile</h1>
      <div className="mt-6">
        <SignInForm />
      </div>
      <p className="mt-6 text-sm text-slate-700">
        New firm? <Link href="/sign-up" className="text-blue-700 underline">Create a firm account</Link>
      </p>
    </main>
  );
}
