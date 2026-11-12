import { getSession } from "@/server/session";
import { MIN_PASSWORD_LENGTH } from "@/server/auth";
import { ActionForm } from "@/app/action-form";
import { changePasswordAction } from "@/app/auth-actions";

export const dynamic = "force-dynamic";

const input = "rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";
const label = "flex flex-col gap-1 text-sm text-slate-700";

export default async function AccountPage() {
  const session = await getSession();
  return (
    <main className="mx-auto w-full max-w-md px-4 py-8 text-slate-900">
      <h1 className="text-2xl font-semibold">Account</h1>
      <p className="mt-1 text-sm text-slate-600">
        {session.name} · {session.email} · <span className="capitalize">{session.role}</span> at {session.firmName}
      </p>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Change password</h2>
        <p className="mt-1 text-sm text-slate-600">You will be signed out everywhere and asked to sign in with the new password.</p>
        <ActionForm action={changePasswordAction} fields={{}} className="mt-4">
          <div className="flex flex-col gap-4">
            <label className={label}>
              Current password
              <input name="current" type="password" required autoComplete="current-password" className={input} />
            </label>
            <label className={label}>
              New password (at least {MIN_PASSWORD_LENGTH} characters)
              <input name="password" type="password" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" className={input} />
            </label>
            <label className={label}>
              Confirm new password
              <input name="confirm" type="password" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" className={input} />
            </label>
            <button className="self-start rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">Change password</button>
          </div>
        </ActionForm>
      </section>
    </main>
  );
}
