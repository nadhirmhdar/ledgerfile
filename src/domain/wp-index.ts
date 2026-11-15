import { AREAS, AREA_BY_CODE, CHECKLIST_BY_CODE, CHECKLISTS } from "./audit";

/**
 * The working paper index: the file's table of contents, derived from what the engagement already holds.
 *
 * The reference scheme is a default for the firm to confirm (docs/working-paper-index.md). Every reference that already exists
 * in the product keeps its form: checklists A1 to E3, areas C1 to C16, schedules C5-1. The index adds only suffixes and a general series.
 *
 *   G1 to G5   general papers: trial balance, journals, statements, client requests, review and file lock
 *   A1, B8, D3 checklist papers, as the checklists already number them
 *   B2.M       the materiality calculation, beside checklist B2 (B8.R risk assessment, B3.A analytical review, A3.L / D5.L letters, D1.M misstatements)
 *   C5.L1      a lead sheet of area C5 (one per lead sheet group, numbered in the group order the area lists them)
 *   C5.P       the audit procedures of area C5 (C16.J journal testing)
 *   C5-1       a test schedule of area C5, as the schedules already number themselves
 *   C5-F1      an uploaded file, referenced by the preparer. The "-F" shape is one the application never makes itself.
 */

export type Status = "not_started" | "in_progress" | "prepared" | "reviewed" | "not_applicable";

export const STATUS_LABEL: Record<Status, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  prepared: "Prepared",
  reviewed: "Reviewed",
  not_applicable: "Not applicable",
};
export const STATUSES: Status[] = ["not_started", "in_progress", "prepared", "reviewed", "not_applicable"];

export type Kind =
  | "trial_balance"
  | "journals"
  | "statements"
  | "requests"
  | "lock"
  | "checklist"
  | "materiality"
  | "risk"
  | "analytics"
  | "letter"
  | "misstatements"
  | "lead_sheet"
  | "procedures"
  | "journal_testing"
  | "schedule"
  | "file";

export const KIND_LABEL: Record<Kind, string> = {
  trial_balance: "Trial balance",
  journals: "Journals",
  statements: "Financial statements",
  requests: "Client requests",
  lock: "Sign-off",
  checklist: "Checklist",
  materiality: "Materiality",
  risk: "Risk assessment",
  analytics: "Analytical review",
  letter: "Letter",
  misstatements: "Misstatements",
  lead_sheet: "Lead sheet",
  procedures: "Procedures",
  journal_testing: "Journal testing",
  schedule: "Test schedule",
  file: "Uploaded file",
};

export interface IndexEntry {
  /** Null only for an uploaded file the preparer has not referenced. */
  reference: string | null;
  section: string;
  title: string;
  kind: Kind;
  /** Where the paper lives, as a path from the site root. */
  href: string;
  preparedBy: string | null;
  preparedOn: string | null;
  reviewedBy: string | null;
  reviewedOn: string | null;
  status: Status;
  /** False for papers the product has no review step for: they are never counted as waiting for review. */
  reviewable: boolean;
  /** What the product knows, or does not know, about the paper: counts, or why no preparer or reviewer is shown. */
  note: string | null;
}

// --- Sections -----------------------------------------------------------------

export interface SectionDef {
  code: string;
  title: string;
}

export const UNFILED = "UNFILED";
export const GENERAL = "G";
const STAGE_TITLE: Record<string, string> = { A: "Acceptance", B: "Planning", D: "Completion", E: "Reporting" };

/** Sections in file order: general and planning first, then the areas in numeric order, then completion and reporting. */
export const SECTIONS: SectionDef[] = [
  { code: GENERAL, title: "General" },
  { code: "A", title: STAGE_TITLE.A },
  { code: "B", title: STAGE_TITLE.B },
  ...AREAS.slice()
    .sort((a, b) => naturalCompare(a.code, b.code))
    .map((a) => ({ code: a.code, title: `${a.code} ${a.title}` })),
  { code: "D", title: STAGE_TITLE.D },
  { code: "E", title: STAGE_TITLE.E },
  { code: UNFILED, title: "Unfiled" },
];
const SECTION_RANK = new Map(SECTIONS.map((s, i) => [s.code, i]));
export const SECTION_BY_CODE = new Map(SECTIONS.map((s) => [s.code, s]));

/** The section an area or checklist code belongs to: an area is its own section; a checklist sits in the section of its stage. */
export function sectionOfCode(code: string): string | null {
  if (AREA_BY_CODE.has(code)) return code;
  const checklist = CHECKLIST_BY_CODE.get(code);
  return checklist ? checklist.stage : null;
}

/** Natural order: C2 before C10, B2 before B2.M before B3. Text compares as text, digit runs as numbers. */
export function naturalCompare(a: string, b: string): number {
  const ta = a.match(/\d+|\D+/g) ?? [];
  const tb = b.match(/\d+|\D+/g) ?? [];
  for (let i = 0; i < Math.min(ta.length, tb.length); i++) {
    const x = ta[i];
    const y = tb[i];
    if (x === y) continue;
    const nx = /^\d/.test(x);
    const ny = /^\d/.test(y);
    if (nx && ny) return Number(x) - Number(y) || x.length - y.length;
    return x < y ? -1 : 1;
  }
  return ta.length - tb.length;
}

// Within an area the order is lead sheets, procedures, journal testing, schedules, then uploaded files. Elsewhere reference order decides.
const KIND_RANK: Partial<Record<Kind, number>> = { lead_sheet: 0, procedures: 1, journal_testing: 2, schedule: 3, file: 9 };

export function compareEntries(a: IndexEntry, b: IndexEntry): number {
  const sa = SECTION_RANK.get(a.section) ?? SECTIONS.length;
  const sb = SECTION_RANK.get(b.section) ?? SECTIONS.length;
  if (sa !== sb) return sa - sb;
  const ka = KIND_RANK[a.kind] ?? 0;
  const kb = KIND_RANK[b.kind] ?? 0;
  if (ka !== kb) return ka - kb;
  // A file with no reference comes after the referenced ones, by name.
  if (a.reference === null || b.reference === null) {
    if (a.reference === b.reference) return a.title.localeCompare(b.title);
    return a.reference === null ? 1 : -1;
  }
  return naturalCompare(a.reference, b.reference) || a.title.localeCompare(b.title);
}

// --- Lead sheet references ----------------------------------------------------

/** The area a lead sheet group belongs to. Every group belongs to exactly one. */
export const AREA_OF_GROUP = new Map<string, string>(AREAS.flatMap((a) => a.groups.map((g) => [g, a.code] as const)));

/**
 * The reference of a lead sheet: its area, ".L", and its place among that area's groups. The place comes from the fixed list of groups the
 * area covers, not from which have a balance this year, so a reference does not change when a balance appears or disappears.
 */
export function leadSheetReference(groupCode: string): string | null {
  const area = AREA_OF_GROUP.get(groupCode);
  if (!area) return null;
  return `${area}.L${AREA_BY_CODE.get(area)!.groups.indexOf(groupCode) + 1}`;
}

// --- Uploaded files -----------------------------------------------------------

/** The shape of a reference typed for a file. The application's own references are never of this shape. */
export const FILE_REFERENCE = /^[A-E][0-9]{1,2}-F[1-9][0-9]{0,2}$/;

/** Normalise and check a typed file reference. Blank means none. Throws a message written for the user. */
export function cleanFileReference(raw: string | null | undefined): string | null {
  const text = (raw ?? "").replace(/\s+/g, "").toUpperCase();
  if (text === "") return null;
  if (!FILE_REFERENCE.test(text)) throw new Error("A file reference is the area or checklist code, then -F and a number, such as C5-F1.");
  const code = text.split("-")[0];
  if (!sectionOfCode(code)) throw new Error(`${code} is not an area or checklist on the file.`);
  return text;
}

/** Check and normalise the code a file is filed under (an area or checklist). Blank means none. */
export function cleanSectionCode(raw: string | null | undefined): string | null {
  const text = (raw ?? "").trim().toUpperCase();
  if (text === "") return null;
  if (!sectionOfCode(text)) throw new Error("Choose an area or checklist to file this file under.");
  return text;
}

/**
 * The area or checklist code a file is filed under. A file that supports a lead sheet is filed in that lead sheet's area, and one that
 * supports a procedure where the procedure is (an area, or a checklist such as B8). A file that supports the engagement generally is filed
 * where its preparer says, and is unfiled until they do. Null means unfiled.
 */
export function homeOfFile(f: { targetKind: string; target: string | null; procedureTemplate: string | null; sectionCode: string | null }): string | null {
  if (f.targetKind === "lead_sheet") return f.target ? (AREA_OF_GROUP.get(f.target) ?? null) : null;
  if (f.targetKind === "procedure") {
    const code = f.procedureTemplate?.split(".")[0] ?? null;
    return code && sectionOfCode(code) ? code : null;
  }
  return f.sectionCode && sectionOfCode(f.sectionCode) ? f.sectionCode : null;
}

// --- Statuses -----------------------------------------------------------------

export const peopleLabel = (names: string[]): string | null => {
  const distinct = [...new Set(names)];
  return distinct.length === 0 ? null : distinct.length === 1 ? distinct[0] : `${distinct.length} people`;
};

/**
 * The status of a set of procedures or checklist steps, by the same rules the lock uses: a step is finished once it is no longer open,
 * and a finished step needs a review unless it is the partner's own sign-off.
 */
export function stepsStatus(c: { total: number; open: number; notApplicable: number; unreviewed: number }): Status {
  if (c.total === 0 || c.open === c.total) return "not_started";
  if (c.open > 0) return "in_progress";
  // Steps set aside as not applicable still need a review, as the lock counts them: all not applicable and unreviewed is only prepared.
  if (c.unreviewed > 0) return "prepared";
  return c.notApplicable === c.total ? "not_applicable" : "reviewed";
}

/** A lead sheet: reviewed once a reviewer has signed; open review points keep it in progress; prepared once the preparer has signed. */
export function leadSheetStatus(s: { prepared: boolean; reviewed: boolean; openPoints: number }): Status {
  if (s.reviewed) return "reviewed";
  if (s.openPoints > 0) return "in_progress";
  return s.prepared ? "prepared" : "not_started";
}

/** A test schedule: reviewed, or prepared with a conclusion (unless a difference is unexplained), or in progress once it has lines. */
export function scheduleStatus(s: { hasLines: boolean; hasConclusion: boolean; reviewed: boolean; differenceUnexplained: boolean }): Status {
  // An unexplained difference holds up the lock whether or not the schedule was reviewed.
  if (s.reviewed && !s.differenceUnexplained) return "reviewed";
  if (s.hasConclusion && !s.differenceUnexplained) return "prepared";
  return s.hasLines || s.hasConclusion || s.differenceUnexplained ? "in_progress" : "not_started";
}

/** The risk assessment, with the partner's approval counted as its review only while that approval still stands. */
export function riskStatus(r: { anyRated: boolean; unassessed: number; approval: "none" | "current" | "lapsed" }): Status {
  if (r.approval === "current") return "reviewed";
  if (r.approval === "lapsed") return "in_progress";
  if (!r.anyRated) return "not_started";
  return r.unassessed > 0 ? "in_progress" : "prepared";
}

// --- Summary ------------------------------------------------------------------

export interface Counts {
  total: number;
  notStarted: number;
  inProgress: number;
  prepared: number;
  reviewed: number;
  notApplicable: number;
  /** Papers that have a review step and have not been reviewed: what a reviewer still has to get to. */
  toReview: number;
}

export const isToReview = (e: Pick<IndexEntry, "reviewable" | "status">): boolean =>
  e.reviewable && (e.status === "not_started" || e.status === "in_progress" || e.status === "prepared");

export function countEntries(entries: IndexEntry[]): Counts {
  const c: Counts = { total: entries.length, notStarted: 0, inProgress: 0, prepared: 0, reviewed: 0, notApplicable: 0, toReview: 0 };
  for (const e of entries) {
    if (e.status === "not_started") c.notStarted++;
    else if (e.status === "in_progress") c.inProgress++;
    else if (e.status === "prepared") c.prepared++;
    else if (e.status === "reviewed") c.reviewed++;
    else c.notApplicable++;
    if (isToReview(e)) c.toReview++;
  }
  return c;
}

export interface IndexSection {
  code: string;
  title: string;
  entries: IndexEntry[];
  counts: Counts;
}
export interface WorkingPaperIndex {
  sections: IndexSection[];
  overall: Counts;
}

/** Order the entries and group them into sections, leaving out sections that have no papers. */
export function buildIndex(entries: IndexEntry[]): WorkingPaperIndex {
  const sorted = entries.slice().sort(compareEntries);
  const sections: IndexSection[] = [];
  for (const def of SECTIONS) {
    const own = sorted.filter((e) => e.section === def.code);
    if (own.length > 0) sections.push({ code: def.code, title: def.title, entries: own, counts: countEntries(own) });
  }
  return { sections, overall: countEntries(sorted) };
}

export type IndexFilter = "all" | "unreviewed" | "not_started";
export const isIndexFilter = (v: string): v is IndexFilter => v === "all" || v === "unreviewed" || v === "not_started";

/** The sections with only the entries that match; each section's counts are those of the entries shown. */
export function filterIndex(index: WorkingPaperIndex, filter: IndexFilter): IndexSection[] {
  if (filter === "all") return index.sections;
  const keep = filter === "unreviewed" ? isToReview : (e: IndexEntry) => e.status === "not_started";
  return index.sections
    .map((s) => {
      const entries = s.entries.filter(keep);
      return { ...s, entries, counts: countEntries(entries) };
    })
    .filter((s) => s.entries.length > 0);
}

/** Every checklist the index can list, in file order. Exposed so tests can check no reference repeats. */
export const CHECKLIST_CODES = CHECKLISTS.map((c) => c.code);

/** The line under the summary about papers marked not applicable; null when there are none. */
export function notApplicableNote(n: number): string | null {
  if (n <= 0) return null;
  return `${n} more ${n === 1 ? "is" : "are"} marked not applicable.`;
}
