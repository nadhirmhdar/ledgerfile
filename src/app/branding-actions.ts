"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/server/db";
import { getSession } from "@/server/session";
import { getFileStore } from "@/server/file-store";
import { AuthError } from "@/server/auth";
import * as branding from "@/server/branding";
import { MAX_LOGO_BYTES } from "@/domain/branding";
import type { FormState } from "./actions";

const field = (form: FormData, name: string) => String(form.get(name) ?? "");

function failure(e: unknown, fallback: string): FormState {
  // Messages from the branding rules are written for users. Other errors are not shown.
  const known = e instanceof AuthError;
  if (!known) console.error("branding action failed:", e instanceof Error ? e.message : "unknown error");
  return { ok: false, message: known ? e.message : fallback };
}

export async function saveBrandingAction(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await getSession();
  try {
    await branding.updateBranding(await getDb(), session, { address: field(form, "address"), contactLine: field(form, "contactLine"), registrationLine: field(form, "registrationLine") });
  } catch (e) {
    return failure(e, "The firm details were not saved.");
  }
  revalidatePath("/firm");
  return { ok: true, message: "Saved." };
}

export async function uploadLogoAction(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await getSession();
  const file = form.get("logo");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose an image file." };
  if (file.size > MAX_LOGO_BYTES) return { ok: false, message: "The logo is larger than 1 MB. Save a smaller image and try again." };
  try {
    await branding.uploadLogo(await getDb(), session, new Uint8Array(await file.arrayBuffer()), getFileStore());
  } catch (e) {
    return failure(e, "The logo was not saved.");
  }
  revalidatePath("/firm");
  return { ok: true, message: "Logo saved." };
}

export async function removeLogoAction(): Promise<FormState> {
  const session = await getSession();
  try {
    await branding.removeLogo(await getDb(), session, getFileStore());
  } catch (e) {
    return failure(e, "The logo was not removed.");
  }
  revalidatePath("/firm");
  return { ok: true, message: "Logo removed." };
}
