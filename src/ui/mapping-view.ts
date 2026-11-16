import { count } from "./text";

/**
 * How the mapping list is shown: which accounts, in what order, and which controls the page offers. Pure, and worked out from the
 * accounts the page has already loaded; nothing here reads the database.
 */

export type MappingState = "to_map" | "to_check" | "mapped";
export type MappingShow = "all" | "unmapped" | "review" | "mapped";

export interface MappingAccount {
  code: string;
  name: string;
  groupCode: string | null;
  approved: boolean;
}

/** Not mapped yet; mapped but not yet accepted by a person; or mapped and accepted. */
export const mappingState = (a: Pick<MappingAccount, "groupCode" | "approved">): MappingState => (a.groupCode === null || a.groupCode === "" ? "to_map" : a.approved ? "mapped" : "to_check");

const STATE_OF_SHOW: Record<Exclude<MappingShow, "all">, MappingState> = { unmapped: "to_map", review: "to_check", mapped: "mapped" };
const RANK: Record<MappingState, number> = { to_map: 0, to_check: 1, mapped: 2 };

/** The ?show= value, tolerant of anything else: unknown or repeated values mean "all". */
export function parseShow(v: string | string[] | undefined): MappingShow {
  const one = Array.isArray(v) ? v[0] : v;
  return one === "unmapped" || one === "review" || one === "mapped" ? one : "all";
}

/** The ?q= value, trimmed and capped; repeated values use the first. */
export function parseQuery(v: string | string[] | undefined): string {
  const one = Array.isArray(v) ? v[0] : v;
  return (one ?? "").trim().slice(0, 100);
}

export interface MappingCounts {
  all: number;
  toMap: number;
  toCheck: number;
  mapped: number;
}

export function countMappings(rows: Pick<MappingAccount, "groupCode" | "approved">[]): MappingCounts {
  const c: MappingCounts = { all: rows.length, toMap: 0, toCheck: 0, mapped: 0 };
  for (const r of rows) {
    const s = mappingState(r);
    if (s === "to_map") c.toMap++;
    else if (s === "to_check") c.toCheck++;
    else c.mapped++;
  }
  return c;
}

const byCode = (a: { code: string }, b: { code: string }) => a.code.localeCompare(b.code, "en", { numeric: true });

/** Accounts to map first, then to check, then the rest, each in code order. */
export function orderMappings<T extends MappingAccount>(rows: T[]): T[] {
  return rows.slice().sort((a, b) => RANK[mappingState(a)] - RANK[mappingState(b)] || byCode(a, b));
}

/** The accounts a filter and a search leave, in display order. The search matches the code or the name, in any case. */
export function viewMappings<T extends MappingAccount>(rows: T[], opts: { show?: MappingShow; q?: string } = {}): { rows: T[]; shown: number; total: number; counts: MappingCounts } {
  const show = opts.show ?? "all";
  const q = (opts.q ?? "").trim().toLowerCase();
  const kept = rows.filter((r) => (show === "all" || mappingState(r) === STATE_OF_SHOW[show]) && (q === "" || r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)));
  return { rows: orderMappings(kept), shown: kept.length, total: rows.length, counts: countMappings(rows) };
}

/** "Showing 4 of 30 accounts." */
export const resultsText = (shown: number, total: number): string => `Showing ${shown} of ${count(total, "account")}.`;

/** The one sentence under the page title. */
export function mappingSentence(c: MappingCounts): string {
  if (c.all === 0) return "No trial balance yet.";
  const parts = [c.toMap > 0 && `${count(c.toMap, "account")} to map`, c.toCheck > 0 && `${count(c.toCheck, "suggested mapping")} to check`].filter(Boolean) as string[];
  if (parts.length === 0) return `${c.all === 1 ? "The account is" : `All ${c.all} accounts are`} mapped and checked.`;
  return `${parts.join(" and ")}.`;
}

/** What the page offers. A locked engagement is read-only: no upload, no accept button, no selects. */
export function mappingControls(o: { locked: boolean; accounts: number; toCheck: number }): { importFirst: boolean; replace: boolean; accept: boolean; selects: boolean } {
  return {
    importFirst: !o.locked && o.accounts === 0,
    replace: !o.locked && o.accounts > 0,
    accept: !o.locked && o.toCheck > 0,
    selects: !o.locked,
  };
}

/** The trial balance total: a balanced file adds up to nothing. */
export const isBalanced = (totalMinor: number): boolean => totalMinor === 0;
