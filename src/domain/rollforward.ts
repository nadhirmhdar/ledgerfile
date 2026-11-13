import type { ListingLine } from "./listing-parse";
import { isKeyItem } from "./test-schedule";

/** Comparatives and matching for a test schedule brought forward from last year. Amounts are minor units. */

/** This year less last year; null when the line has no comparative. */
export const movement = (currentMinor: number, priorMinor: number | null): number | null => (priorMinor === null ? null : currentMinor - priorMinor);

/** A movement is highlighted like a key item when it is at or above the threshold in either direction. */
export const isKeyMovement = (currentMinor: number, priorMinor: number | null, thresholdMinor: number): boolean => {
  const m = movement(currentMinor, priorMinor);
  return m !== null && isKeyItem(m, thresholdMinor);
};

export interface ComparativeTotals {
  currentMinor: number;
  /** Total of last year's amounts; lines with no comparative count as nothing. */
  priorMinor: number;
  movementMinor: number;
  /** Lines carrying a comparative. */
  withComparative: number;
}

export function comparativeTotals(lines: { amountMinor: number; priorAmountMinor: number | null }[]): ComparativeTotals {
  const currentMinor = lines.reduce((s, l) => s + l.amountMinor, 0);
  const priorMinor = lines.reduce((s, l) => s + (l.priorAmountMinor ?? 0), 0);
  return { currentMinor, priorMinor, movementMinor: currentMinor - priorMinor, withComparative: lines.filter((l) => l.priorAmountMinor !== null).length };
}

// --- Matching an imported listing to the lines brought forward ----------------------------------------------------

export interface ExistingLine {
  id: string;
  docRef: string | null;
  description: string;
}

export interface Match {
  existingId: string;
  /** Index into the imported lines. */
  importedIndex: number;
  by: "reference" | "description";
}

export interface MatchResult {
  matches: Match[];
  /** Imported lines with no existing line to go against; added as new lines with no comparative. */
  unmatchedImported: number[];
  /** Existing lines nothing was imported against; they keep their comparative and a zero current amount. */
  unmatchedExisting: string[];
  byReference: number;
  byDescription: number;
}

const norm = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Match an imported listing to the existing lines: first by reference, then, for what is left, by exact description (ignoring
 * case and extra spaces). Each existing line is matched at most once, and each imported line goes to at most one. When several
 * existing lines share a reference or description, they are matched in order.
 */
export function matchListing(existing: ExistingLine[], imported: ListingLine[]): MatchResult {
  const taken = new Set<string>();
  const done = new Set<number>();
  const matches: Match[] = [];

  const pass = (by: Match["by"], key: (e: { docRef: string | null; description: string }) => string) => {
    const pool = new Map<string, ExistingLine[]>();
    for (const e of existing) {
      const k = key(e);
      if (k === "") continue;
      pool.set(k, [...(pool.get(k) ?? []), e]);
    }
    imported.forEach((l, i) => {
      if (done.has(i)) return;
      const k = key(l);
      if (k === "") return;
      const candidate = (pool.get(k) ?? []).find((e) => !taken.has(e.id));
      if (!candidate) return;
      taken.add(candidate.id);
      done.add(i);
      matches.push({ existingId: candidate.id, importedIndex: i, by });
    });
  };
  pass("reference", (x) => norm(x.docRef));
  pass("description", (x) => norm(x.description));

  return {
    matches,
    unmatchedImported: imported.map((_, i) => i).filter((i) => !done.has(i)),
    unmatchedExisting: existing.filter((e) => !taken.has(e.id)).map((e) => e.id),
    byReference: matches.filter((m) => m.by === "reference").length,
    byDescription: matches.filter((m) => m.by === "description").length,
  };
}
