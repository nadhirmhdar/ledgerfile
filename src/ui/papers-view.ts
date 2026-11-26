import { canReview, type Role } from "../domain/signoff";
import { count } from "./text";

/**
 * How the working papers page is read: which files a chip and a search leave, the line saying where each is filed, and which
 * controls a person is offered on a file. Pure; the server still enforces every rule.
 */

export type TargetKind = "engagement" | "lead_sheet" | "procedure";

export interface PaperLike {
  fileName: string;
  description: string | null;
  targetKind: TargetKind;
  reference: string | null;
  sectionCode: string | null;
  uploadedBy: string;
}

export type PapersShow = "" | "notfiled" | "noreference" | "leadsheet" | "procedure";

export function parsePapersShow(v: string | string[] | undefined): PapersShow {
  const one = (Array.isArray(v) ? v[0] : v) ?? "";
  return one === "notfiled" || one === "noreference" || one === "leadsheet" || one === "procedure" ? one : "";
}

export const parsePapersSearch = (v: string | string[] | undefined): string => ((Array.isArray(v) ? v[0] : v) ?? "").trim().slice(0, 100);

/** A general file that has not been filed under an area or checklist. A file for a lead sheet or a procedure is filed where it belongs. */
export const isNotFiled = (p: Pick<PaperLike, "targetKind" | "sectionCode">): boolean => p.targetKind === "engagement" && !p.sectionCode;

const matchesShow = (p: PaperLike, s: PapersShow) => {
  switch (s) {
    case "notfiled":
      return isNotFiled(p);
    case "noreference":
      return !p.reference;
    case "leadsheet":
      return p.targetKind === "lead_sheet";
    case "procedure":
      return p.targetKind === "procedure";
    default:
      return true;
  }
};

const matchesSearch = (p: PaperLike, q: string) => {
  const t = q.trim().toLowerCase();
  return t === "" || p.fileName.toLowerCase().includes(t) || (p.description ?? "").toLowerCase().includes(t);
};

export interface PaperCounts {
  all: number;
  notfiled: number;
  noreference: number;
  leadsheet: number;
  procedure: number;
}

/** Counts for the chips, with the search applied. */
export function paperCounts(rows: PaperLike[], q = ""): PaperCounts {
  const c: PaperCounts = { all: 0, notfiled: 0, noreference: 0, leadsheet: 0, procedure: 0 };
  for (const p of rows) {
    if (!matchesSearch(p, q)) continue;
    c.all++;
    if (isNotFiled(p)) c.notfiled++;
    if (!p.reference) c.noreference++;
    if (p.targetKind === "lead_sheet") c.leadsheet++;
    if (p.targetKind === "procedure") c.procedure++;
  }
  return c;
}

export function filterPapers<T extends PaperLike>(rows: T[], opts: { show?: PapersShow; q?: string } = {}): { rows: T[]; shown: number; total: number } {
  const kept = rows.filter((p) => matchesShow(p, opts.show ?? "") && matchesSearch(p, opts.q ?? ""));
  return { rows: kept, shown: kept.length, total: rows.length };
}

export const paperResults = (shown: number, total: number): string => `Showing ${shown} of ${count(total, "file")}.`;

/** "6 files: 3 with an index reference, 1 not filed." */
export function papersSentence(rows: Pick<PaperLike, "targetKind" | "sectionCode" | "reference">[]): string {
  if (rows.length === 0) return "No files yet.";
  const withRef = rows.filter((p) => p.reference).length;
  const notFiled = rows.filter(isNotFiled).length;
  const parts = [`${withRef} with an index reference`, notFiled > 0 && `${notFiled} not filed`].filter(Boolean);
  return `${count(rows.length, "file")}: ${parts.join(", ")}.`;
}

/** Where a file is filed, for the muted line under it. */
export function filingText(p: Pick<PaperLike, "targetKind" | "sectionCode">): string {
  if (p.targetKind === "lead_sheet") return "Filed with its lead sheet";
  if (p.targetKind === "procedure") return "Filed with its procedure";
  return p.sectionCode ? `Filed under ${p.sectionCode}` : "Not filed";
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export interface PaperControls {
  /** The reference input and its Save filing button. */
  filing: boolean;
  /** The section select: only for a file that supports the engagement as a whole. */
  sectionSelect: boolean;
  remove: boolean;
  /** Upload a new version of this file: anyone while the engagement is open, as for any upload. */
  newVersion: boolean;
}

/** Filing is for anyone while the engagement is open; removing is for the uploader or a reviewer or partner. Nothing once locked. */
export function paperControls(p: Pick<PaperLike, "targetKind" | "uploadedBy">, c: { open: boolean; role: Role; userId: string }): PaperControls {
  return { filing: c.open, sectionSelect: c.open && p.targetKind === "engagement", remove: c.open && (p.uploadedBy === c.userId || canReview(c.role)), newVersion: c.open };
}
