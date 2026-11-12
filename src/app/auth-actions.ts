"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db";
import * as auth from "@/server/auth";
import { clearSessionCookie, getSession, setSessionCookie } from "@/server/session";
import type { FormState } from "./actions";

const field = (form: FormData, name: string) => String(form.get(name) ?? "");

function failure(e: unknown): FormState {
  // Only messages written for users are shown; anything else is reported generically.
  if (e instanceof auth.AuthError) return { ok: false, message: e.message };
  // Log the message only: database errors carry the statement's parameters, which can include a password hash.
  console.error("auth action failed:", e instanceof Error ? e.message : "unknown error");
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
