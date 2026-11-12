import Link from "next/link";
import { redirect } from "next/navigation";
import { getOptionalSession } from "@/server/session";
import { MIN_PASSWORD_LENGTH } from "@/server/auth";
import { SignUpForm } from "@/app/auth-forms";

export const dynamic = "force-dynamic";

export default async function SignUpPage() {
  if (await getOptionalSession()) redirect("/");
  return (
    <main className="mx-auto w-full max-w-sm px-4 py-16 text-slate-900">
      <h1 className="text-2xl font-semibold">Create a firm account</h1>
      <p className="mt-2 text-sm text-slate-700">You become the firm&apos;s administrator and can add colleagues afterwards.</p>
      <div className="mt-6">
        <SignUpForm minPassword={MIN_PASSWORD_LENGTH} />
      </div>
      <p className="mt-6 text-sm text-slate-700">
        Already registered? <Link href="/sign-in" className="text-blue-700 underline">Sign in</Link>
      </p>
    </main>
  );
}
