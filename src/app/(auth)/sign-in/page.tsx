import Link from "next/link";
import { redirect } from "next/navigation";
import { getOptionalSession } from "@/server/session";
import { signupOpen } from "@/server/config";
import { SignInForm } from "@/app/auth-forms";
import { AuthShell } from "@/ui/auth-shell";

export const dynamic = "force-dynamic";

export default async function SignInPage() {
  if (await getOptionalSession()) redirect("/");
  return (
    <AuthShell
      title="Sign in to LedgerFile"
      footer={
        signupOpen() ? (
          <>
            New firm?{" "}
            <Link href="/sign-up" className="font-medium text-accent hover:underline">
              Create a firm account
            </Link>
          </>
        ) : undefined
      }
    >
      <SignInForm />
    </AuthShell>
  );
}
