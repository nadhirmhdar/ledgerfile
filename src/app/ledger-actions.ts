"use server";

import { revalidatePath } from "next/cache";
import { getDb, withFirm, type Tx } from "@/server/db";
import { getSession } from "@/server/session";
import type { Session } from "@/server/repo";
import * as ledger from "@/server/ledger";
import { readGrid } from "@/server/excel";
import { MAX_LEDGER_LINES, parseLedger } from "@/domain/ledger-parse";
import type { FormState } from "./actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const field = (form: FormData, name: string) => String(form.get(name) ?? "");

async function run(form: FormData, done: (result: unknown) => string, work: (tx: Tx, session: Session, engagementId: string) => Promise<unknown>): Promise<FormState> {
  const session = await getSession();
  const engagementId = field(form, "engagementId");
  if (!UUID.test(engagementId)) return { ok: false, message: "Engagement not found." };
  let result: unknown;
  try {
    result = await withFirm(await getDb(), session.firmId, (tx) => work(tx, session, engagementId));
  } catch (e) {
    // Messages thrown by the journal testing rules are written for users. Database errors are not shown.
    const known = e instanceof Error && !("code" in e);
    if (!known) console.error("journal testing action failed:", e instanceof Error ? e.message : "unknown error");
    return { ok: false, message: known ? e.message : "Something went wrong. Please try again." };
  }
  revalidatePath(`/engagements/${engagementId}`, "layout");
  return { ok: true, message: done(result) };
}

export async function importLedgerAction(_prev: FormState, form: FormData): Promise<FormState> {
  await getSession();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose the journal listing to upload." };

  let grid: unknown[][];
  try {
    // A little over the line limit is read, so that an over-long listing is reported and never silently cut short.
    grid = await readGrid(file.name, await file.arrayBuffer(), MAX_LEDGER_LINES + 200);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "The file could not be read." };
  }
  const parsed = parseLedger(grid);
  if (parsed.errors.length > 0) return { ok: false, message: "The journal listing was not imported.", details: parsed.errors };

  return run(
    form,
    (r) => {
      const { lines, entries, flagged } = r as { lines: number; entries: number; flagged: number };
      return `Imported ${lines.toLocaleString("en-US")} lines in ${entries.toLocaleString("en-US")} entries. ${flagged.toLocaleString("en-US")} entries show at least one risk characteristic.`;
    },
    (tx, session, engagementId) => ledger.importLedger(tx, session, engagementId, file.name, parsed.lines),
  );
}

export async function selectEntryAction(_prev: FormState, form: FormData): Promise<FormState> {
  const select = field(form, "select") === "true";
  return run(
    form,
    () => "",
    (tx, session, engagementId) => (select ? ledger.selectForTesting(tx, session, engagementId, field(form, "entryNo")) : ledger.unselect(tx, session, engagementId, field(form, "entryNo"))),
  );
}

export async function recordJournalTestAction(_prev: FormState, form: FormData): Promise<FormState> {
  return run(
    form,
    () => "Conclusion recorded.",
    (tx, session, engagementId) => ledger.recordJournalTest(tx, session, engagementId, field(form, "entryNo"), { workDone: field(form, "workDone"), conclusion: field(form, "conclusion") }),
  );
}
