"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import * as repo from "@/server/repo";
import * as assistant from "@/server/mapping-assistant";
import { readSheets } from "@/server/excel";
import { recogniseWorkbook } from "@/domain/tb-recognise";
import { buildPreview, chosenFromEntries, type Preview as TbPreview, readTrialBalance, ROLE_LABEL, savedFrom, SOURCE_SENTENCE, type Layout } from "@/domain/tb-layout";
import * as tbLayout from "@/server/tb-layout";
import { formatAmount, parseAmount } from "@/domain/money";
import * as journals from "@/server/journals";
import type { JournalLineInput } from "@/domain/journal";
import { cleanName, MAX_NAME, MIN_NAME } from "@/domain/client-import";

export interface FormState {
  ok: boolean;
  message: string;
  details?: string[];
  /** Set when the columns could not be read, or the user asked to choose them: the first rows of the sheet, to say which column is which. */
  preview?: UploadPreview;
}

export interface UploadPreview extends TbPreview {
  fileName: string;
  /** Which sheet of the workbook the rows are from (0-based), sent back with the choice. */
  sheet: number;
  /** The roles already chosen, by column, so the chooser shows them again after a refusal. */
  selected: Record<number, string>;
}

/** Log a refused change without failing the request. */
function refused(e: unknown): void {
  console.warn("change refused:", e instanceof Error ? e.message : "unknown error");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function createClientAction(_prev: FormState, form: FormData): Promise<FormState> {
  const name = cleanName(form.get("name"));
  if (name.length < MIN_NAME || name.length > MAX_NAME) return { ok: false, message: "Enter the client's name." };
  const session = await getSession();
  try {
    await withFirm(await getDb(), session.firmId, (tx) => repo.createClient(tx, session, name));
  } catch (e) {
    return { ok: false, message: e instanceof Error && !("code" in e) ? e.message : "The client was not added." };
  }
  revalidatePath("/");
  return { ok: true, message: `Added ${name}.` };
}

export async function createEngagementAction(_prev: FormState, form: FormData): Promise<FormState> {
  const clientId = String(form.get("clientId") ?? "");
  const start = String(form.get("periodStart") ?? "");
  const end = String(form.get("periodEnd") ?? "");
  if (!UUID.test(clientId)) return { ok: false, message: "Choose a client." };
  if (!DATE.test(start) || !DATE.test(end)) return { ok: false, message: "Enter both period dates." };
  if (end <= start) return { ok: false, message: "The period end must be after the period start." };

  const session = await getSession();
  let id: string;
  try {
    id = await withFirm(await getDb(), session.firmId, (tx) => repo.createEngagement(tx, session, clientId, start, end));
  } catch (e) {
    return { ok: false, message: e instanceof Error && !("code" in e) ? e.message : "The engagement was not created. Check the dates." };
  }
  redirect(`/engagements/${id}`);
}

export async function uploadTrialBalanceAction(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await getSession();
  const engagementId = String(form.get("engagementId") ?? "");
  const file = form.get("file");
  if (!UUID.test(engagementId)) return { ok: false, message: "Engagement not found." };
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose a trial balance file to upload." };

  let sheets: { name: string; rows: unknown[][] }[];
  try {
    sheets = await readSheets(file.name, await file.arrayBuffer());
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "The file could not be read." };
  }

  // Everything is read again here: the browser's preview is only a way to say which column is which, never what the file holds.
  const entries: Record<string, string> = {};
  for (const [key, value] of form.entries()) if (typeof value === "string") entries[key] = value;
  const chosenEntries = "headerRow" in entries ? chosenFromEntries(entries) : null;
  // The sheet a choice was made on; anything else is the first sheet, as it has always been.
  const sheetIndex = chosenEntries && /^\d{1,2}$/.test(entries.sheet ?? "") && sheets[Number(entries.sheet)] ? Number(entries.sheet) : 0;
  const grid = sheets[sheetIndex].rows;
  const selectedOf = (layout: Layout | null): Record<number, string> => Object.fromEntries(Object.entries(layout?.columns ?? {}).map(([role, col]) => [col as number, role]));
  const sheet = buildPreview(grid);
  const preview = (layout: Layout | null): UploadPreview => ({ ...sheet, headerRow: layout && Number.isInteger(layout.headerRow) ? layout.headerRow : sheet.headerRow, fileName: file.name, sheet: sheetIndex, selected: selectedOf(layout) });
  if (chosenEntries && chosenEntries.clashes.length > 0) {
    return { ok: false, message: `Each role can be one column only: ${chosenEntries.clashes.map((r) => ROLE_LABEL[r]).join(", ")} was chosen more than once.`, preview: preview(chosenEntries.layout) };
  }

  const db = await getDb();
  const remembered = chosenEntries ? null : (await withFirm(db, session.firmId, (tx) => tbLayout.getRemembered(tx, engagementId)))?.layout ?? null;
  const reading = readTrialBalance(grid, { chosen: chosenEntries?.layout ?? null, remembered, ask: entries.chooseColumns === "1" });
  // The shape of the export, read when plain detection could not read the sheet or read it and the accounts did not balance. Nothing it already reads
  // and balances comes here. Not sure enough (low confidence) means ask: the chooser, with what it found filled in, and nothing imported.
  const recognise = async (): Promise<FormState | null> => {
    const found = recogniseWorkbook(sheets);
    if (!found) return null;
    if (found.confidence.level === "low") {
      const rows = sheets[found.sheetIndex].rows;
      const pre = { ...buildPreview(rows), headerRow: found.prefill.headerRow, fileName: file.name, sheet: found.sheetIndex, selected: selectedOf(found.prefill) };
      return { ok: false, message: `The columns could not be read with confidence. Nothing was imported. ${found.confidence.reasons.join(" ")}`, preview: pre };
    }
    try {
      const r = await withFirm(db, session.firmId, (tx) =>
        repo.importTrialBalance(tx, session, engagementId, file.name, found.accounts, { source: "recognised", sheet: found.sheetName, header: found.header, roles: found.roles, confidence: found.confidence.level, skippedRows: found.skipped.length }),
      );
      revalidatePath(`/engagements/${engagementId}`);
      return {
        ok: true,
        message: `Imported ${r.imported} accounts: ${r.carriedForward} mapped from earlier work, ${r.suggested} suggested for review, ${r.unmapped} left unmapped. ${SOURCE_SENTENCE.recognised}, ${found.confidence.level} confidence.`,
        details: [...found.confidence.reasons, ...found.skipped.map((k) => `Row ${k.row} was left out: ${k.reason.toLowerCase()}.`)].slice(0, 20),
      };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : "The import failed." };
    }
  };
  const mayRecognise = !chosenEntries && entries.chooseColumns !== "1";
  if (reading.kind === "choose" && mayRecognise) {
    const state = await recognise();
    if (state) return state;
  }
  if (reading.kind === "choose") {
    return { ok: false, message: reading.reason, preview: preview(chosenEntries?.layout ?? null) };
  }

  const { result: parsed, source, layout } = reading;
  if (mayRecognise && (parsed.errors.length > 0 || !parsed.balanced)) {
    const state = await recognise();
    // A reading that is not sure leaves today's message in place rather than replacing it.
    if (state?.ok) return state;
  }
  const again = source === "chosen" ? { preview: preview(layout) } : {};
  if (parsed.errors.length > 0) {
    return { ok: false, message: "The trial balance was not imported.", details: parsed.errors.slice(0, 20), ...again };
  }
  if (!parsed.balanced) {
    return {
      ok: false,
      message: `The trial balance does not balance: debits and credits differ by ${formatAmount(Math.abs(parsed.differenceMinor))}. Nothing was imported.`,
      ...again,
    };
  }

  try {
    const saved = savedFrom(grid, layout);
    const r = await withFirm(db, session.firmId, async (tx) => {
      const imported = await repo.importTrialBalance(tx, session, engagementId, file.name, parsed.accounts, { source, ...saved });
      await tbLayout.rememberLayout(tx, session, engagementId, saved);
      return imported;
    });
    revalidatePath(`/engagements/${engagementId}`);
    return {
      ok: true,
      message: `Imported ${r.imported} accounts: ${r.carriedForward} mapped from earlier work, ${r.suggested} suggested for review, ${r.unmapped} left unmapped. ${SOURCE_SENTENCE[source]}.`,
      details: parsed.warnings.slice(0, 20),
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "The import failed." };
  }
}

/** Forget the columns remembered for the engagement's client. */
export async function forgetTbLayoutAction(form: FormData): Promise<void> {
  const engagementId = String(form.get("engagementId") ?? "");
  if (!UUID.test(engagementId)) return;
  const session = await getSession();
  await withFirm(await getDb(), session.firmId, (tx) => tbLayout.forgetLayout(tx, session, engagementId)).catch(refused);
  revalidatePath(`/engagements/${engagementId}`);
}

export async function setBorrowingsCurrentAction(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await getSession();
  const engagementId = String(form.get("engagementId") ?? "");
  if (!UUID.test(engagementId)) return { ok: false, message: "Engagement not found." };
  const current = parseAmount(form.get("current")) ?? 0;
  const prior = parseAmount(form.get("prior")) ?? 0;
  if (Number.isNaN(current) || Number.isNaN(prior) || current < 0 || prior < 0) return { ok: false, message: "Enter the amounts as positive numbers." };
  try {
    await withFirm(await getDb(), session.firmId, (tx) => repo.setBorrowingsCurrent(tx, session, engagementId, current, prior));
  } catch (e) {
    return { ok: false, message: e instanceof Error && !("code" in e) ? e.message : "The amounts were not saved." };
  }
  revalidatePath(`/engagements/${engagementId}`, "layout");
  return { ok: true, message: "Saved." };
}

export async function setMappingAction(form: FormData): Promise<void> {
  const engagementId = String(form.get("engagementId") ?? "");
  const accountId = String(form.get("accountId") ?? "");
  const groupCode = String(form.get("groupCode") ?? "");
  if (!UUID.test(engagementId) || !UUID.test(accountId)) return;
  const session = await getSession();
  await withFirm(await getDb(), session.firmId, (tx) => repo.setMapping(tx, session, accountId, groupCode === "" ? null : groupCode)).catch(refused);
  revalidatePath(`/engagements/${engagementId}`);
}

export async function approveAllAction(form: FormData): Promise<void> {
  const engagementId = String(form.get("engagementId") ?? "");
  if (!UUID.test(engagementId)) return;
  const session = await getSession();
  await withFirm(await getDb(), session.firmId, (tx) => repo.approveAllMappings(tx, session, engagementId)).catch(refused);
  revalidatePath(`/engagements/${engagementId}`);
}

/** Ask the mapping assistant to suggest again for the accounts that are unmapped or not yet accepted. Never changes an accepted mapping. */
export async function suggestAgainAction(_prev: FormState, form: FormData): Promise<FormState> {
  const engagementId = String(form.get("engagementId") ?? "");
  if (!UUID.test(engagementId)) return { ok: false, message: "Engagement not found." };
  const session = await getSession();
  try {
    const r = await withFirm(await getDb(), session.firmId, (tx) => assistant.suggestAgain(tx, session, engagementId));
    revalidatePath(`/engagements/${engagementId}`);
    return { ok: true, message: r.placed === 0 && r.declined === 0 ? "Nothing to suggest: every account is accepted." : `Suggested ${r.placed}, could not place ${r.declined}.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error && !("code" in e) ? e.message : "The suggestions were not saved." };
  }
}

export async function acceptMappingAction(form: FormData): Promise<void> {
  const engagementId = String(form.get("engagementId") ?? "");
  const accountId = String(form.get("accountId") ?? "");
  if (!UUID.test(engagementId) || !UUID.test(accountId)) return;
  const session = await getSession();
  await withFirm(await getDb(), session.firmId, (tx) => assistant.acceptMapping(tx, session, accountId)).catch(refused);
  revalidatePath(`/engagements/${engagementId}`);
}

export async function acceptHighConfidenceAction(form: FormData): Promise<void> {
  const engagementId = String(form.get("engagementId") ?? "");
  if (!UUID.test(engagementId)) return;
  const session = await getSession();
  await withFirm(await getDb(), session.firmId, (tx) => assistant.acceptHighConfidence(tx, session, engagementId)).catch(refused);
  revalidatePath(`/engagements/${engagementId}`);
}

export async function createJournalAction(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await getSession();
  const engagementId = String(form.get("engagementId") ?? "");
  const type = String(form.get("type") ?? "");
  const description = String(form.get("description") ?? "");
  if (!UUID.test(engagementId)) return { ok: false, message: "Engagement not found." };
  if (type !== "adjusting" && type !== "reclassification") return { ok: false, message: "Choose the entry type." };

  let raw: unknown;
  try {
    raw = JSON.parse(String(form.get("lines") ?? "[]"));
  } catch {
    return { ok: false, message: "The entry could not be read." };
  }
  if (!Array.isArray(raw) || raw.length > 200) return { ok: false, message: "The entry could not be read." };

  const lines: JournalLineInput[] = [];
  for (const [i, item] of raw.entries()) {
    const { accountId, debit, credit } = (item ?? {}) as Record<string, unknown>;
    const dr = parseAmount(debit);
    const cr = parseAmount(credit);
    if (dr === null && cr === null && !accountId) continue; // an empty row
    if (typeof accountId !== "string" || !UUID.test(accountId)) return { ok: false, message: `Line ${i + 1}: choose an account.` };
    if (Number.isNaN(dr) || Number.isNaN(cr) || (dr ?? 0) < 0 || (cr ?? 0) < 0) return { ok: false, message: `Line ${i + 1}: enter amounts as positive numbers.` };
    if (dr && cr) return { ok: false, message: `Line ${i + 1}: enter a debit or a credit, not both.` };
    lines.push({ accountId, amountMinor: (dr ?? 0) - (cr ?? 0) });
  }

  try {
    await withFirm(await getDb(), session.firmId, (tx) => journals.createJournal(tx, session, engagementId, { type, description, lines }));
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "The entry was not posted." };
  }
  revalidatePath(`/engagements/${engagementId}`, "layout");
  return { ok: true, message: "Entry posted." };
}

export async function deleteJournalAction(form: FormData): Promise<void> {
  const engagementId = String(form.get("engagementId") ?? "");
  const journalId = String(form.get("journalId") ?? "");
  if (!UUID.test(engagementId) || !UUID.test(journalId)) return;
  const session = await getSession();
  await withFirm(await getDb(), session.firmId, (tx) => journals.deleteJournal(tx, session, journalId)).catch(refused);
  revalidatePath(`/engagements/${engagementId}`, "layout");
}
