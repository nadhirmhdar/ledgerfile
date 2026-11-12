"use client";

import { useActionState } from "react";
import { addUserAction, signInAction, signUpAction } from "./auth-actions";
import type { FormState } from "./actions";

const initial: FormState = { ok: true, message: "" };
const input = "rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";
const label = "flex flex-col gap-1 text-sm text-slate-700";
const button = "rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50";

function Feedback({ state }: { state: FormState }) {
  if (!state.message) return null;
  return (
    <p role="status" className={`rounded border px-3 py-2 text-sm ${state.ok ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-red-300 bg-red-50 text-red-900"}`}>
      {state.message}
    </p>
  );
}

export function SignInForm() {
  const [state, action, pending] = useActionState(signInAction, initial);
  return (
    <form action={action} className="flex flex-col gap-4">
      <label className={label}>
        Email
        <input name="email" type="email" autoComplete="username" required className={input} />
      </label>
      <label className={label}>
        Password
        <input name="password" type="password" autoComplete="current-password" required className={input} />
      </label>
      <Feedback state={state} />
      <button className={button} disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}

export function SignUpForm({ minPassword }: { minPassword: number }) {
  const [state, action, pending] = useActionState(signUpAction, initial);
  return (
    <form action={action} className="flex flex-col gap-4">
      <label className={label}>
        Firm name
        <input name="firmName" required minLength={2} maxLength={200} autoComplete="organization" className={input} />
      </label>
      <label className={label}>
        Your name
        <input name="name" required minLength={2} maxLength={200} autoComplete="name" className={input} />
      </label>
      <label className={label}>
        Email
        <input name="email" type="email" required autoComplete="username" className={input} />
      </label>
      <label className={label}>
        Password (at least {minPassword} characters)
        <input name="password" type="password" required minLength={minPassword} autoComplete="new-password" className={input} />
      </label>
      <label className={label}>
        Confirm password
        <input name="confirm" type="password" required minLength={minPassword} autoComplete="new-password" className={input} />
      </label>
      <Feedback state={state} />
      <button className={button} disabled={pending}>{pending ? "Creating…" : "Create firm account"}</button>
    </form>
  );
}

export function AddUserForm({ roles, minPassword }: { roles: readonly string[]; minPassword: number }) {
  const [state, action, pending] = useActionState(addUserAction, initial);
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className={label}>
          Name
          <input name="name" required minLength={2} maxLength={200} className={`${input} w-56`} />
        </label>
        <label className={label}>
          Email
          <input name="email" type="email" required className={`${input} w-64`} />
        </label>
        <label className={label}>
          Role
          <select name="role" required defaultValue="preparer" className={`${input} capitalize`}>
            {roles.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </label>
        <label className={label}>
          Initial password (at least {minPassword} characters)
          <input name="password" type="password" required minLength={minPassword} autoComplete="new-password" className={`${input} w-56`} />
        </label>
        <button className={button} disabled={pending}>Add user</button>
      </div>
      <Feedback state={state} />
    </form>
  );
}
