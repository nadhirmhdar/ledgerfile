import { GROUP_BY_CODE } from "./groups";
import { POLICIES } from "./policies";

/**
 * The wording of the notes to the financial statements that a person can edit. Pure.
 *
 * A passage is named by a key that does not depend on the note numbers (which are generated): general, basis, policies (the introduction to the
 * accounting policies), policy:<slug of the policy title> and group:<GROUP CODE> (a narrative above a group note's table). Figures, tables, totals and
 * the note numbers are never editable. A saved passage replaces the generated words for that passage only; "going back" is a version marked generated,
 * which the statements treat as no edit at all.
 */

export const MAX_PARAGRAPHS = 20;
export const MAX_PARAGRAPH_LENGTH = 4000;

export const GENERAL_KEY = "general";
export const BASIS_KEY = "basis";
export const POLICIES_KEY = "policies";

export const policySlug = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
export const policyKey = (title: string): string => `policy:${policySlug(title)}`;
export const groupKey = (code: string): string => `group:${code}`;

const POLICY_BY_KEY = new Map(POLICIES.map((p) => [policyKey(p.title), p]));

/** Whether the key names a passage that exists in the notes' design (whether or not it applies to this engagement today). */
export function isKnownKey(key: string): boolean {
  if (key === GENERAL_KEY || key === BASIS_KEY || key === POLICIES_KEY) return true;
  if (key.startsWith("policy:")) return POLICY_BY_KEY.has(key);
  if (key.startsWith("group:")) return GROUP_BY_CODE.has(key.slice("group:".length));
  return false;
}

/** What a passage is called, for the history and the "Kept but not shown" list. */
export function describeKey(key: string): string {
  if (key === GENERAL_KEY) return "General information";
  if (key === BASIS_KEY) return "Basis of preparation";
  if (key === POLICIES_KEY) return "Introduction to the accounting policies";
  if (key.startsWith("policy:")) return `Policy: ${POLICY_BY_KEY.get(key)?.title ?? key.slice("policy:".length)}`;
  if (key.startsWith("group:")) return `Narrative above the table: ${GROUP_BY_CODE.get(key.slice("group:".length))?.name ?? key.slice("group:".length)}`;
  return key;
}

export type ParagraphCheck = { ok: true; paragraphs: string[] } | { ok: false; message: string };

/**
 * The paragraphs as typed, checked. Line breaks inside a paragraph are kept; the ends of each paragraph are trimmed. At least one paragraph, none empty,
 * at most 20 of at most 4,000 characters.
 */
export function checkParagraphs(input: unknown): ParagraphCheck {
  if (!Array.isArray(input) || !input.every((p) => typeof p === "string")) return { ok: false, message: "The text was not understood." };
  const paragraphs = (input as string[]).map((p) => p.replace(/\r\n?/g, "\n").trim());
  if (paragraphs.length === 0) return { ok: false, message: "Write at least one paragraph, or go back to the generated wording." };
  if (paragraphs.length > MAX_PARAGRAPHS) return { ok: false, message: `A passage can have at most ${MAX_PARAGRAPHS} paragraphs. This one has ${paragraphs.length}.` };
  for (const [i, p] of paragraphs.entries()) {
    if (p === "") return { ok: false, message: `Paragraph ${i + 1} is empty. Write in it or remove it.` };
    if (p.length > MAX_PARAGRAPH_LENGTH) return { ok: false, message: `Paragraph ${i + 1} is ${p.length.toLocaleString("en-GB")} characters; the most is ${MAX_PARAGRAPH_LENGTH.toLocaleString("en-GB")}. Split it into two.` };
  }
  return { ok: true, paragraphs };
}

/** One saved version of a passage. */
export interface NoteVersion {
  version: number;
  paragraphs: string[];
  /** The marker for "back to the generated wording": no paragraphs, and the generated words apply. */
  generated: boolean;
  by: string;
  /** Date and time, UTC, as shown. */
  at: string;
  /** "firm_default" for wording copied from the firm's statement defaults when the engagement was created; null for a person's own text. */
  source?: "person" | "firm_default" | null;
}

/** The overrides the statement pack takes: the paragraphs of every passage whose current version is a person's text. */
export function overridesFrom(current: Map<string, NoteVersion>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, v] of current) if (!v.generated) out[key] = v.paragraphs;
  return out;
}

/** Edited text kept for a passage that is not in this engagement's notes today (a policy that no longer applies, a group with no note). */
export function keptButNotShown(overrides: Record<string, string[]>, shownKeys: Set<string>): string[] {
  return Object.keys(overrides).filter((k) => !shownKeys.has(k));
}

/** The words that say how a passage reads: "Edited by Pia on 2026-03-01 10:00", or null on generated words. */
export const editedLine = (v: Pick<NoteVersion, "by" | "at">): string => `Edited by ${v.by} on ${v.at}`;
export const DRAFT_PASSAGE_LABEL = "Unreviewed draft wording";

/** The text of a version cut for the audit log, so a long passage does not fill it. */
export const cutForLog = (paragraphs: string[] | null, max = 600): string | null => {
  if (paragraphs === null) return null;
  const text = paragraphs.join("\n\n");
  return text.length > max ? `${text.slice(0, max)}…` : text;
};
