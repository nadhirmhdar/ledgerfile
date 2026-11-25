import { checkParagraphs } from "./note-texts";

/**
 * The firm's statement defaults, as rules and words. Pure.
 *
 * The firm sets a presentation currency, a rounding and default wording for some passages of the notes. They are copied onto an engagement when it is
 * created (a snapshot) and never referenced afterwards, so a later change to the firm's defaults does not alter an existing file. The app's own
 * generated wording keeps its "unreviewed draft" label; wording the firm wrote itself is labelled as the firm's.
 */

export const NOT_PARTNER_DEFAULTS = "Only a partner can change the firm's statement defaults.";
export const CURRENCY_WORDS = "A currency code is three letters, such as AED. Leave it blank for none.";

export type Unit = "exact" | "whole";
export const UNIT_LABEL: Record<Unit, string> = { exact: "Exact (two decimals)", whole: "Whole units" };
/** Minor units per presentation unit, as `buildStatementPack` takes it. */
export const unitMinorOf = (u: string | null | undefined): number => (u === "whole" ? 100 : 1);
export const isUnit = (v: string): v is Unit => v === "exact" || v === "whole";

/** A currency code as typed: three letters, any case, made upper case. Blank means not set. No list of currencies is kept. */
export function checkCurrency(input: string | null | undefined): { ok: true; code: string | null } | { ok: false; message: string } {
  const t = (input ?? "").trim();
  if (t === "") return { ok: true, code: null };
  if (!/^[A-Za-z]{3}$/.test(t)) return { ok: false, message: CURRENCY_WORDS };
  return { ok: true, code: t.toUpperCase() };
}

/** Text typed in one box as paragraphs: separated by a blank line; line breaks inside a paragraph are kept. */
export const textToParagraphs = (text: string): string[] =>
  text
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((p) => p.trim())
    .filter((p) => p !== "");

export const paragraphsToText = (paragraphs: string[]): string => paragraphs.join("\n\n");

/** Default wording as typed: blank clears it (null); otherwise the paragraphs, checked against the notes' own limits. */
export function checkDefaultText(text: string): { ok: true; paragraphs: string[] | null } | { ok: false; message: string } {
  const paragraphs = textToParagraphs(text);
  if (paragraphs.length === 0) return { ok: true, paragraphs: null };
  const checked = checkParagraphs(paragraphs);
  return checked.ok ? { ok: true, paragraphs: checked.paragraphs } : { ok: false, message: checked.message };
}

export const firmDefaultLabel = (at: string): string => `Firm default wording, from ${at}`;
