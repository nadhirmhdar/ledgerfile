"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db";
import * as auth from "@/server/auth";
import { redact, signupOpen, SIGNUP_CLOSED_MESSAGE } from "@/server/config";
import { clearSessionCookie, getSession, setSessionCookie } from "@/server/session";
import type { FormState } from "./actions";

const field = (form: FormData, name: string) => String(form.get(name) ?? "");

function failure(e: unknown): FormState {
  // Only messages written for users are shown; anything else is reported generically.
  if (e instanceof auth.AuthError) return { ok: false, message: e.message };
  // Log the message only: database errors carry the statement's parameters, which can include a password hash.
  console.error("auth action failed:", e instanceof Error ? redact(e.message) : "unknown error");
  return { ok: false, message: "Something went wrong. Please try again." };
}

export async function signInAction(_prev: FormState, form: FormData): Promise<FormState> {
  let token: string;
  try {
    token = await auth.signIn(await getDb(), field(form, "email"), field(form, "password"));
  } catch (e) {
    return failure(e);
  }
  await setSessionCookie(token);
  redirect("/");
}

export async function signUpAction(_prev: FormState, form: FormData): Promise<FormState> {
  // Checked on the server, whatever the page showed: closed sign-up is a rule, not a hidden link.
  if (!signupOpen()) return { ok: false, message: SIGNUP_CLOSED_MESSAGE };
  const email = field(form, "email");
  const password = field(form, "password");
  if (password !== field(form, "confirm")) return { ok: false, message: "The two passwords do not match." };
  let token: string;
  try {
    const db = await getDb();
    await auth.signUp(db, { firmName: field(form, "firmName"), name: field(form, "name"), email, password });
    token = await auth.signIn(db, email, password);
  } catch (e) {
    return failure(e);
  }
  await setSessionCookie(token);
  redirect("/");
}

export async function signOutAction(): Promise<void> {
  const token = await clearSessionCookie();
  await auth.signOut(await getDb(), token);
  redirect("/sign-in");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Run one user-management operation as the signed-in administrator. */
async function manage(form: FormData, done: string, work: (session: auth.AuthSession, userId: string) => Promise<void>): Promise<FormState> {
  const session = await getSession();
  const userId = field(form, "userId");
  if (!UUID.test(userId)) return { ok: false, message: "User not found." };
  try {
    await work(session, userId);
  } catch (e) {
    return failure(e);
  }
  revalidatePath("/team");
  return { ok: true, message: done };
}

export async function setUserRoleAction(_prev: FormState, form: FormData): Promise<FormState> {
  return manage(form, "Role updated.", async (session, userId) => auth.setUserRole(await getDb(), session, userId, field(form, "role")));
}

export async function setUserActiveAction(_prev: FormState, form: FormData): Promise<FormState> {
  const active = field(form, "active") === "true";
  return manage(form, active ? "Reactivated." : "Deactivated.", async (session, userId) => auth.setUserActive(await getDb(), session, userId, active));
}

export async function resetUserPasswordAction(_prev: FormState, form: FormData): Promise<FormState> {
  return manage(form, "Password reset. Give them the new password privately.", async (session, userId) =>
    auth.resetUserPassword(await getDb(), session, userId, field(form, "password")),
  );
}

export async function changePasswordAction(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await getSession();
  const next = field(form, "password");
  if (next !== field(form, "confirm")) return { ok: false, message: "The two new passwords do not match." };
  try {
    await auth.changeOwnPassword(await getDb(), session, field(form, "current"), next);
  } catch (e) {
    return failure(e);
  }
  // Changing the password ends every session, so the user signs in again with the new one.
  await clearSessionCookie();
  redirect("/sign-in");
}

export async function addUserAction(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await getSession();
  const name = field(form, "name");
  try {
    await auth.addUser(await getDb(), session, { name, email: field(form, "email"), role: field(form, "role"), password: field(form, "password") });
  } catch (e) {
    return failure(e);
  }
  revalidatePath("/team");
  return { ok: true, message: `Added ${name.trim()}. Give them their initial password privately.` };
}
