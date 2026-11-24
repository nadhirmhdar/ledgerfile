"use server";

import { revalidatePath } from "next/cache";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import { updateClient } from "@/server/clients";
import type { FormState } from "./actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const field = (form: FormData, name: string) => String(form.get(name) ?? "");

/** Save a client's name and details. The role is read again from the database; every value is checked again here. */
export async function updateClientAction(_prev: FormState, form: FormData): Promise<FormState> {
  const id = field(form, "clientId");
  if (!UUID.test(id)) return { ok: false, message: "Client not found." };
  const month = field(form, "yearEndMonth").trim();
  const day = field(form, "yearEndDay").trim();
  const session = await getSession();
  try {
    const result = await withFirm(await getDb(), session.firmId, (tx) =>
      updateClient(tx, session, id, {
        name: field(form, "name"),
        licenceNumber: field(form, "licenceNumber"),
        licensingAuthority: field(form, "licensingAuthority"),
        taxRegistrationNumber: field(form, "taxRegistrationNumber"),
        yearEnd: month === "" && day === "" ? "" : `${month}-${day}`,
        address: field(form, "address"),
        contactName: field(form, "contactName"),
        contactEmail: field(form, "contactEmail"),
      }),
    );
    if (!result.ok) return { ok: false, message: "The client was not saved.", details: Object.values(result.errors ?? { message: result.message }) as string[] };
    revalidatePath(`/clients/${id}`);
    revalidatePath("/clients");
    revalidatePath("/");
    return { ok: true, message: result.changed.length === 0 ? "No change: these are the details already saved." : `Saved: ${result.changed.join(", ").toLowerCase()}.` };
  } catch (e) {
    const known = e instanceof Error && !("code" in e);
    if (!known) console.error("client edit failed:", e instanceof Error ? e.message : "unknown error");
    return { ok: false, message: known ? e.message : "The client was not saved." };
  }
}
