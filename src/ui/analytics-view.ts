import type { Tone } from "./status";
import { count } from "./text";

/** How the analytical review page words its facts, filters the lines it was given, and shows a line's state. Pure presentation over what getAnalytics returned. */

export interface ReviewRow {
  section: string;
  flag: unknown | null;
  explanation: { stale: boolean } | null;
}

export type RowState = "none" | "to_explain" | "explained" | "reconfirm";

/** A flagged line is to explain (no explanation), re-confirm (one whose figures have changed since) or explained. An unflagged line has no state. */
export function rowState(r: Pick<ReviewRow, "flag" | "explanation">): RowState {
  if (!r.flag) return "none";
  if (!r.explanation) return "to_explain";
  return r.explanation.stale ? "reconfirm" : "explained";
}

export interface StatePill {
  label: string;
  tone: Tone;
}

/** The pill for a state, in words: the state is never shown by colour alone. */
export function statePill(state: RowState): StatePill | null {
  switch (state) {
    case "to_explain":
      return { label: "To explain", tone: "warning" };
    case "reconfirm":
      return { label: "Re-confirm", tone: "warning" };
    case "explained":
      return { label: "Explained", tone: "success" };
    default:
      return null;
  }
}

export interface ReviewCounts {
  flagged: number;
  explained: number;
  /** Flagged with no explanation that still stands: to explain, plus those to re-confirm. */
  toExplain: number;
  reconfirm: number;
}

export function reviewCounts(rows: Pick<ReviewRow, "flag" | "explanation">[]): ReviewCounts {
  const states = rows.map(rowState);
  return {
    flagged: states.filter((s) => s !== "none").length,
    explained: states.filter((s) => s === "explained").length,
    toExplain: states.filter((s) => s === "to_explain" || s === "reconfirm").length,
    reconfirm: states.filter((s) => s === "reconfirm").length,
  };
}

/** "17 movements flagged: 2 explained, 15 to explain." and the other states of the page. */
export function analyticsSentence(s: { hasComparatives: boolean; hasThresholds: boolean } & ReviewCounts): string {
  if (!s.hasComparatives) return "No prior year, so nothing is compared.";
  if (!s.hasThresholds) return "Materiality is not set, so nothing is flagged yet.";
  if (s.flagged === 0) return "No movement is flagged.";
  if (s.toExplain === 0) return "Every flagged movement is explained.";
  const base = `${count(s.flagged, "movement")} flagged: ${s.explained} explained, ${s.toExplain} to explain.`;
  if (s.reconfirm === 0) return base;
  return `${base} ${count(s.reconfirm, "explanation")} ${s.reconfirm === 1 ? "needs" : "need"} re-confirming.`;
}

export type Show = "all" | "flagged" | "unexplained";

/** The ?show= value; anything else, or none, is All. */
export function parseShow(v: string | string[] | undefined): Show {
  const one = Array.isArray(v) ? v[0] : v;
  return one === "flagged" || one === "unexplained" ? one : "all";
}

/** The lines to show. All keeps every line, subtotals and totals included; the others keep only the lines that match. */
export function filterRows<T extends Pick<ReviewRow, "flag" | "explanation">>(rows: T[], show: Show): T[] {
  if (show === "flagged") return rows.filter((r) => rowState(r) !== "none");
  if (show === "unexplained") return rows.filter((r) => rowState(r) === "to_explain" || rowState(r) === "reconfirm");
  return rows;
}

/** The statements in the order the page shows them, each with its lines; a section with no line left is left out, so its heading goes too. */
export const SECTION_ORDER = ["Statement of comprehensive income", "Statement of financial position"] as const;
export function groupBySection<T extends Pick<ReviewRow, "section">>(rows: T[]): { section: string; rows: T[] }[] {
  return SECTION_ORDER.map((section) => ({ section, rows: rows.filter((r) => r.section === section) })).filter((g) => g.rows.length > 0);
}

export interface Chip {
  show: Show;
  label: string;
  count: number;
}

/** The three filter chips with their counts. */
export function chips(rows: Pick<ReviewRow, "flag" | "explanation">[]): Chip[] {
  const c = reviewCounts(rows);
  return [
    { show: "all", label: "All lines", count: rows.length },
    { show: "flagged", label: "Flagged", count: c.flagged },
    { show: "unexplained", label: "To explain", count: c.toExplain },
  ];
}

export const showHref = (base: string, show: Show): string => (show === "all" ? base : `${base}?show=${show}`);
