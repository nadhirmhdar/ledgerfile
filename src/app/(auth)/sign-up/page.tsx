import Link from "next/link";
import { redirect } from "next/navigation";
import { getOptionalSession } from "@/server/session";
import { MIN_PASSWORD_LENGTH } from "@/server/auth";
import { SignUpForm } from "@/app/auth-forms";
import { AuthShell } from "@/ui/auth-shell";

export const dynamic = "force-dynamic";

export default async function SignUpPage() {
  if (await getOptionalSession()) redirect("/");
  return (
    <AuthShell
      title="Create a firm account"
      intro="You become the firm's administrator and can add colleagues afterwards."
      footer={
        <>
          Already registered?{" "}
          <Link href="/sign-in" className="font-medium text-accent hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <SignUpForm minPassword={MIN_PASSWORD_LENGTH} />
    </AuthShell>
  );
}
