"use client";

import { useActionState } from "react";
import { addUserAction, signInAction, signUpAction } from "./auth-actions";
import type { FormState } from "./actions";
import { Button } from "@/ui/button";
import { Field, Input, Select } from "@/ui/form";
import { roleLabel } from "@/ui/team-view";
import { plainCount } from "@/ui/text";

const initial: FormState = { ok: true, message: "" };

function Feedback({ state }: { state: FormState }) {
  if (!state.message) return null;
  return (
    <p role="status" className={`rounded-md border px-3 py-2 text-sm font-medium ${state.ok ? "border-success bg-success-soft text-success-strong" : "border-danger bg-danger-soft text-danger-strong"}`}>
      {plainCount(state.message)}
    </p>
  );
}

export function SignInForm() {
  const [state, action, pending] = useActionState(signInAction, initial);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Email">
        <Input name="email" type="email" autoComplete="username" required />
      </Field>
      <Field label="Password">
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>
      <Feedback state={state} />
      <Button variant="primary" className="w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}

export function SignUpForm({ minPassword }: { minPassword: number }) {
  const [state, action, pending] = useActionState(signUpAction, initial);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Firm name">
        <Input name="firmName" required minLength={2} maxLength={200} autoComplete="organization" />
      </Field>
      <Field label="Your name">
        <Input name="name" required minLength={2} maxLength={200} autoComplete="name" />
      </Field>
      <Field label="Email">
        <Input name="email" type="email" required autoComplete="username" />
      </Field>
      <Field label={`Password (at least ${minPassword} characters)`}>
        <Input name="password" type="password" required minLength={minPassword} autoComplete="new-password" />
      </Field>
      <Field label="Confirm password">
        <Input name="confirm" type="password" required minLength={minPassword} autoComplete="new-password" />
      </Field>
      <Feedback state={state} />
      <Button variant="primary" className="w-full" disabled={pending}>
        {pending ? "Creating…" : "Create firm account"}
      </Button>
    </form>
  );
}

export function AddUserForm({ roles, minPassword }: { roles: readonly string[]; minPassword: number }) {
  const [state, action, pending] = useActionState(addUserAction, initial);
  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <Input name="name" required minLength={2} maxLength={200} />
        </Field>
        <Field label="Email">
          <Input name="email" type="email" required />
        </Field>
        <Field label="Role">
          <Select name="role" required defaultValue="preparer">
            {roles.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`Initial password (at least ${minPassword} characters)`}>
          <Input name="password" type="password" required minLength={minPassword} autoComplete="new-password" />
        </Field>
      </div>
      <Feedback state={state} />
      <div>
        <Button variant="primary" disabled={pending}>
          Add user
        </Button>
      </div>
    </form>
  );
}
