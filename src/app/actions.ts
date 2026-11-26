"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import * as repo from "@/server/repo";
import * as assistant from "@/server/mapping-assistant";
import { readSheets } from "@/server/excel";
import { importFileFrom, type ImportFile } from "@/server/import-source";
import { readsDiffer, recogniseWorkbook } from "@/domain/tb-recognise";
import { buildPreview, chosenFromEntries, type Preview as TbPreview, readTrialBalance, ROLE_LABEL, savedFrom, SOURCE_SENTENCE, type Layout } from "@/domain/tb-layout";
import * as tbLayout from "@/server/tb-layout";
import { headingsChangedMessage, parseTemplate, recogniseTemplate, TEMPLATE_LINK_TEXT, type SheetGrid, type TemplateReading } from "@/domain/tb-template";
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
  /** What importing would do, from the same reading the import uses. Present on every preview of a file that could be read. */
  review?: ImportReview;
  /** True when the roles shown are the person's own choice (so importing takes them as chosen). */
  edited?: boolean;
  /** True when the columns are fixed (the LedgerFile template), so there is nothing to choose. */
  locked?: boolean;
}

/** What an import would do, shown before anything is saved. */
export interface ImportReview {
  /** How the columns were found, in words. */
  source: string;
  sheetName: string;
  accounts: number;
  debitMinor: number;
  creditMinor: number;
  differenceMinor: number;
  balanced: boolean;
  /** Rows left out, numbered as in the sheet, with why. */
  skipped: { row: number; reason: string }[];
  errors: string[];
  warnings: string[];
  /** How sure the reading is, with the reasons that lowered it. Null when the columns were chosen or remembered, which are not guesses. */
  confidence: { level: "high" | "medium" | "low"; reasons: string[] } | null;
  /** True when the reading is a low-confidence guess: the person must say they have checked it. */
  mustConfirm: boolean;
  /** True when the file would import as it is: nothing wrong and balanced. */
  canImport: boolean;
}

function reviewOf(r: {
  source: string;
  sheetName: string;
  accounts: { closingMinor: number }[];
  differenceMinor: number;
  balanced: boolean;
  skipped?: { row: number; reason: string }[];
  errors?: string[];
  warnings?: string[];
  confidence?: { level: "high" | "medium" | "low"; reasons: string[] } | null;
}): ImportReview {
  const errors = r.errors ?? [];
  return {
    source: r.source,
    sheetName: r.sheetName,
    accounts: r.accounts.length,
    debitMinor: r.accounts.reduce((n, a) => n + Math.max(a.closingMinor, 0), 0),
    creditMinor: r.accounts.reduce((n, a) => n + Math.max(-a.closingMinor, 0), 0),
    differenceMinor: r.differenceMinor,
    balanced: r.balanced,
    skipped: (r.skipped ?? []).slice(0, 200),
    errors: errors.slice(0, 20),
    warnings: (r.warnings ?? []).slice(0, 20),
    confidence: r.confidence ?? null,
    mustConfirm: r.confidence?.level === "low",
    canImport: errors.length === 0 && r.balanced && r.confidence?.level !== "low",
  };
}

const PREVIEW_OK = "This is what the import would do. Nothing has been imported yet: check it, then press Import.";

/** The sentence about accounts whose name changed since their mapping was accepted (the group is kept only as a suggestion). */
const renamedNote = (r: { renamed?: number }): string[] => (r.renamed ? [`${r.renamed} account${r.renamed === 1 ? "" : "s"} changed name since the mapping was accepted, so the group is kept only as a suggestion to check.`] : []);

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

const DISAGREE = "This file can be read two ways that give different closing balances (for example, the movement columns and the closing columns). Check which columns are the closing balance.";

/** A file that is the LedgerFile template is read as the template, with certainty: its example rows are left out and every message names its row. */
async function importTemplate(
  session: Awaited<ReturnType<typeof getSession>>,
  engagementId: string,
  fileName: string,
  sheet: SheetGrid,
  tpl: Extract<TemplateReading, { kind: "template" }>,
  /** Preview only: say what the import would do and save nothing. The template's columns are fixed, so the preview is short and has one Import button. */
  showPreview = false,
): Promise<FormState> {
  const parsed = parseTemplate(sheet.rows, tpl.headerRow, tpl.columns);
  const left = parsed.skipped.map((k) => `Row ${k.row} was left out: ${k.reason}.`);
  if (showPreview) {
    const roleOf: Record<number, string> = { [tpl.columns["Account code"]]: "code", [tpl.columns["Account name"]]: "name", [tpl.columns["Debit"]]: "debit", [tpl.columns["Credit"]]: "credit" };
    const review = reviewOf({ source: SOURCE_SENTENCE.template, sheetName: sheet.name, accounts: parsed.accounts, differenceMinor: parsed.differenceMinor, balanced: parsed.balanced, skipped: parsed.skipped, errors: parsed.errors, warnings: parsed.warnings });
    return {
      ok: review.canImport,
      message: review.canImport ? PREVIEW_OK : "The file was read as the LedgerFile template, but it cannot be imported as it is. Nothing has been imported.",
      preview: { ...buildPreview(sheet.rows), headerRow: tpl.headerRow, fileName, sheet: 0, selected: roleOf, review, locked: true },
    };
  }
  if (parsed.errors.length > 0) return { ok: false, message: "The trial balance was not imported.", details: [...parsed.errors, ...left].slice(0, 20) };
  if (!parsed.balanced) {
    return { ok: false, message: `The trial balance does not balance: debits and credits differ by ${formatAmount(Math.abs(parsed.differenceMinor))}. Nothing was imported.`, details: left.slice(0, 20) };
  }
  try {
    const r = await withFirm(await getDb(), session.firmId, (tx) =>
      repo.importTrialBalance(tx, session, engagementId, fileName, parsed.accounts, { source: "template", sheet: sheet.name, headerRow: tpl.headerRow, skippedRows: parsed.skipped.length }),
    );
    revalidatePath(`/engagements/${engagementId}`);
    return {
      ok: true,
      message: `Imported ${r.imported} accounts: ${r.carriedForward} mapped from earlier work, ${r.suggested} suggested for review, ${r.unmapped} left unmapped. ${SOURCE_SENTENCE.template}.`,
      details: [...renamedNote(r), ...left, ...parsed.warnings].slice(0, 20),
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "The import failed." };
  }
}

/** Put a sentence about the template in front of a reading that went the usual way. */
function withNote(state: FormState, note: string | null): FormState {
  if (!note) return state;
  return state.ok ? { ...state, details: [note, ...(state.details ?? [])] } : { ...state, message: `${note} ${state.message}` };
}

export async function uploadTrialBalanceAction(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await getSession();
  const engagementId = String(form.get("engagementId") ?? "");
  if (!UUID.test(engagementId)) return { ok: false, message: "Engagement not found." };
  let source: ImportFile | null;
  try {
    source = await importFileFrom(form, session, "trial_balance", engagementId);
  } catch (e) {
    return { ok: false, message: e instanceof Error && !("code" in e) ? e.message : "The file could not be read." };
  }
  if (!source) return { ok: false, message: "Choose a trial balance file to upload." };
  const { file, maxBytes } = source;

  let sheets: { name: string; rows: unknown[][] }[];
  try {
    sheets = await readSheets(file.name, await file.arrayBuffer(), undefined, { keepIndent: true, maxBytes });
  } catch (e) {
    return { ok: false, message: `${e instanceof Error ? e.message : "The file could not be read."} Or start from our template: ${TEMPLATE_LINK_TEXT}.` };
  }

  // Everything is read again here: the browser's preview is only a way to say which column is which, never what the file holds.
  const entries: Record<string, string> = {};
  for (const [key, value] of form.entries()) if (typeof value === "string") entries[key] = value;
  // The step: "preview" says what an import would do and saves nothing; "import" saves. A caller that sends neither (the action as it always was) imports.
  // After a preview the columns come from the form only if the person changed them (edited) or asked to choose them; otherwise the file is read the way the
  // preview read it, so what is imported is what was shown.
  const dry = entries.intent === "preview";
  const picks = "headerRow" in entries && (entries.intent === undefined || entries.edited === "1" || entries.chooseColumns === "1");
  const chosenEntries = picks ? chosenFromEntries(entries) : null;
  // The sheet a choice was made on; anything else is the first sheet, as it has always been.
  const sheetIndex = chosenEntries && /^\d{1,2}$/.test(entries.sheet ?? "") && sheets[Number(entries.sheet)] ? Number(entries.sheet) : 0;
  const grid = sheets[sheetIndex].rows;
  const selectedOf = (layout: Layout | null): Record<number, string> => Object.fromEntries(Object.entries(layout?.columns ?? {}).map(([role, col]) => [col as number, role]));
  const sheet = buildPreview(grid);
  const preview = (layout: Layout | null): UploadPreview => ({ ...sheet, headerRow: layout && Number.isInteger(layout.headerRow) ? layout.headerRow : sheet.headerRow, fileName: file.name, sheet: sheetIndex, selected: selectedOf(layout) });
  if (chosenEntries && chosenEntries.clashes.length > 0) {
    return { ok: false, message: `Each role can be one column only: ${chosenEntries.clashes.map((r) => ROLE_LABEL[r]).join(", ")} was chosen more than once.`, preview: preview(chosenEntries.layout) };
  }

  // The LedgerFile template is read with certainty. With its heading changed it goes the usual way, and says so.
  const tpl = !chosenEntries && entries.chooseColumns !== "1" ? recogniseTemplate(sheets) : null;
  if (tpl?.kind === "template") return importTemplate(session, engagementId, file.name, sheets[tpl.sheetIndex], tpl, dry);
  const note = tpl?.kind === "edited" ? headingsChangedMessage(tpl.changed) : null;

  if (entries.intent === "import" && entries.low === "1" && entries.confirmLow !== "1") {
    return { ok: false, message: "Tick the box to say you have checked the columns and the totals. Nothing was imported.", preview: { ...preview(chosenEntries?.layout ?? null), edited: true } };
  }

  const rest = async (): Promise<FormState> => {
  const db = await getDb();
  const remembered = chosenEntries ? null : (await withFirm(db, session.firmId, (tx) => tbLayout.getRemembered(tx, engagementId)))?.layout ?? null;
  const reading = readTrialBalance(grid, { chosen: chosenEntries?.layout ?? null, remembered, ask: entries.chooseColumns === "1" });
  // The shape of the export, read when plain detection could not read the sheet or read it and the accounts did not balance. Nothing it already reads
  // and balances comes here. Not sure enough (low confidence) means ask: the chooser, with what it found filled in, and nothing imported.
  const recognise = async (): Promise<FormState | null> => {
    const found = recogniseWorkbook(sheets);
    if (!found) return null;
    const reviewFound = reviewOf({ source: SOURCE_SENTENCE.recognised, sheetName: found.sheetName, accounts: found.accounts, differenceMinor: found.differenceMinor, balanced: found.balanced, skipped: found.skipped, confidence: found.confidence });
    if (found.confidence.level === "low") {
      const rows = sheets[found.sheetIndex].rows;
      const pre = { ...buildPreview(rows), headerRow: found.prefill.headerRow, fileName: file.name, sheet: found.sheetIndex, selected: selectedOf(found.prefill), review: reviewFound, edited: true };
      return { ok: false, message: `The columns could not be read with confidence. Nothing was imported. ${found.confidence.reasons.join(" ")}`, preview: pre };
    }
    if (dry) {
      const pre = { ...buildPreview(sheets[found.sheetIndex].rows), headerRow: found.prefill.headerRow, fileName: file.name, sheet: found.sheetIndex, selected: selectedOf(found.prefill), review: reviewFound };
      return { ok: true, message: PREVIEW_OK, preview: pre };
    }
    try {
      const r = await withFirm(db, session.firmId, (tx) =>
        repo.importTrialBalance(tx, session, engagementId, file.name, found.accounts, { source: "recognised", sheet: found.sheetName, header: found.header, roles: found.roles, confidence: found.confidence.level, skippedRows: found.skipped.length }),
      );
      revalidatePath(`/engagements/${engagementId}`);
      return {
        ok: true,
        message: `Imported ${r.imported} accounts: ${r.carriedForward} mapped from earlier work, ${r.suggested} suggested for review, ${r.unmapped} left unmapped. ${SOURCE_SENTENCE.recognised}, ${found.confidence.level} confidence.`,
        details: [...renamedNote(r), ...found.confidence.reasons, ...found.skipped.map((k) => `Row ${k.row} was left out: ${k.reason.toLowerCase()}.`)].slice(0, 20),
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
  // Plain detection read the sheet and it balances, but the recogniser reads it into balanced accounts with different closing balances (an export with
  // opening, movement and closing columns balances in its movement columns too). We do not know which columns are the closing balance, so nothing is
  // imported: the chooser opens on that sheet, filled in with the recogniser's columns. What a person confirms is remembered for the client as usual.
  if (mayRecognise && parsed.errors.length === 0 && parsed.balanced) {
    const found = recogniseWorkbook(sheets);
    if (readsDiffer(parsed.accounts, found)) {
      const review = reviewOf({ source: SOURCE_SENTENCE.recognised, sheetName: found.sheetName, accounts: found.accounts, differenceMinor: found.differenceMinor, balanced: found.balanced, skipped: found.skipped, confidence: { level: "low", reasons: [DISAGREE] } });
      const pre = { ...buildPreview(sheets[found.sheetIndex].rows), headerRow: found.prefill.headerRow, fileName: file.name, sheet: found.sheetIndex, selected: selectedOf(found.prefill), review, edited: true };
      return { ok: false, message: DISAGREE, preview: pre };
    }
  }
  if (mayRecognise && (parsed.errors.length > 0 || !parsed.balanced)) {
    const state = await recognise();
    // A reading that is not sure leaves today's message in place rather than replacing it.
    if (state?.ok) return state;
  }
  if (dry) {
    const review = reviewOf({ source: SOURCE_SENTENCE[source], sheetName: sheets[sheetIndex].name, accounts: parsed.accounts, differenceMinor: parsed.differenceMinor, balanced: parsed.balanced, skipped: parsed.skipped, errors: parsed.errors, warnings: parsed.warnings });
    const message = review.canImport
      ? PREVIEW_OK
      : parsed.errors.length > 0
        ? "The trial balance cannot be imported as it is. Nothing has been imported."
        : `The trial balance does not balance: debits and credits differ by ${formatAmount(Math.abs(parsed.differenceMinor))}. Nothing has been imported.`;
    return { ok: review.canImport, message, preview: { ...preview(layout), review, edited: source === "chosen" } };
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
      details: [...renamedNote(r), ...parsed.warnings].slice(0, 20),
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "The import failed." };
  }
  };
  return withNote(await rest(), note);
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
