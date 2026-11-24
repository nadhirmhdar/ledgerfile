import { BENCHMARKS, PERFORMANCE_RANGE, TRIVIAL_MAX, type Benchmark, type GuideRanges } from "./audit";

/**
 * A firm's materiality and planning settings. Pure.
 *
 * The percentage ranges, the performance guide range and the trivial maximum are today's constants (see audit.ts), so a firm that has not edited its
 * settings sees exactly what materiality has always done. The rest (the default and reduced performance percentages, the trivial percentage, and the
 * thresholds the planning assistant uses to flag indicators) are DRAFT defaults: unreviewed, for the firm's own policy to replace.
 */

export const BENCHMARK_ORDER: Benchmark[] = ["pbt", "revenue", "expenses", "assets", "equity"];

export interface PlanningSettings {
  /** The percentage of each benchmark that is the guide range for overall materiality, in basis points (500 = 5%). */
  percentages: Record<Benchmark, { minBp: number; maxBp: number }>;
  /** Performance materiality: the guide range (outside it a warning is shown), the default, and the reduced range used for higher risk. */
  performance: { guideMinPct: number; guideMaxPct: number; defaultPct: number; reducedMinPct: number; reducedMaxPct: number };
  /** The clearly-trivial threshold as a percentage of overall materiality, and the most the guide allows before a warning. */
  trivial: { pct: number; maxPct: number };
  /** The thresholds the planning assistant uses. */
  thresholds: {
    /** A line that moved by more than this percentage (and by more than performance materiality) is an indicator. */
    movementPct: number;
    /** Revenue that fell by more than this percentage is an indicator. */
    revenueDropPct: number;
    /** A gross margin that moved by more than this many percentage points is an indicator. */
    marginSwingPoints: number;
    /** Profit before tax that moved by more than this percentage on the prior year is not "stable". */
    pbtMovementPct: number;
    /** Profit before tax below this percentage of revenue, either way, is "near break-even". */
    nearBreakEvenPct: number;
  };
}

export const DEFAULT_PLANNING_SETTINGS: PlanningSettings = {
  percentages: Object.fromEntries(BENCHMARK_ORDER.map((b) => [b, { minBp: BENCHMARKS[b].minBp, maxBp: BENCHMARKS[b].maxBp }])) as PlanningSettings["percentages"],
  performance: { guideMinPct: PERFORMANCE_RANGE.min, guideMaxPct: PERFORMANCE_RANGE.max, defaultPct: 75, reducedMinPct: 50, reducedMaxPct: 60 },
  trivial: { pct: 5, maxPct: TRIVIAL_MAX },
  thresholds: { movementPct: 25, revenueDropPct: 20, marginSwingPoints: 5, pbtMovementPct: 50, nearBreakEvenPct: 2 },
};

/** The guide ranges computeMateriality warns against, from a firm's settings. With the default settings they are exactly DEFAULT_GUIDE. */
export function guideRangesOf(settings: PlanningSettings): GuideRanges {
  return {
    benchmarks: Object.fromEntries(BENCHMARK_ORDER.map((b) => [b, { minBp: settings.percentages[b].minBp, maxBp: settings.percentages[b].maxBp }])) as GuideRanges["benchmarks"],
    performance: { min: settings.performance.guideMinPct, max: settings.performance.guideMaxPct },
    trivialMax: settings.trivial.maxPct,
  };
}

const isInt = (n: unknown, min: number, max: number): n is number => typeof n === "number" && Number.isInteger(n) && n >= min && n <= max;

/**
 * The settings as stored or typed, checked and completed: anything missing takes its default, and every number is checked against its limits. A message in
 * plain words for the first thing that is wrong.
 */
export function checkPlanningSettings(input: unknown): { ok: true; value: PlanningSettings } | { ok: false; message: string } {
  const raw = (input && typeof input === "object" ? input : {}) as Partial<Record<keyof PlanningSettings, Record<string, unknown>>>;
  const d = DEFAULT_PLANNING_SETTINGS;
  const out: PlanningSettings = JSON.parse(JSON.stringify(d));

  for (const b of BENCHMARK_ORDER) {
    const given = (raw.percentages?.[b] ?? {}) as { minBp?: unknown; maxBp?: unknown };
    const minBp = given.minBp ?? d.percentages[b].minBp;
    const maxBp = given.maxBp ?? d.percentages[b].maxBp;
    if (!isInt(minBp, 1, 2000) || !isInt(maxBp, 1, 2000)) return { ok: false, message: `The percentage range for ${BENCHMARKS[b].label.toLowerCase()} must be between 0.01% and 20%.` };
    if (minBp > maxBp) return { ok: false, message: `The lowest percentage for ${BENCHMARKS[b].label.toLowerCase()} is above the highest.` };
    out.percentages[b] = { minBp, maxBp };
  }

  const p = (raw.performance ?? {}) as Record<string, unknown>;
  const perf = { guideMinPct: p.guideMinPct ?? d.performance.guideMinPct, guideMaxPct: p.guideMaxPct ?? d.performance.guideMaxPct, defaultPct: p.defaultPct ?? d.performance.defaultPct, reducedMinPct: p.reducedMinPct ?? d.performance.reducedMinPct, reducedMaxPct: p.reducedMaxPct ?? d.performance.reducedMaxPct };
  for (const value of Object.values(perf)) if (!isInt(value, 1, 100)) return { ok: false, message: "Performance materiality percentages must be whole numbers from 1 to 100." };
  const pp = perf as { [K in keyof typeof perf]: number };
  if (pp.guideMinPct > pp.guideMaxPct) return { ok: false, message: "The lowest performance materiality in the guide range is above the highest." };
  if (pp.reducedMinPct > pp.reducedMaxPct) return { ok: false, message: "The lowest reduced performance materiality is above the highest." };
  out.performance = pp;

  const t = (raw.trivial ?? {}) as Record<string, unknown>;
  const trivial = { pct: t.pct ?? d.trivial.pct, maxPct: t.maxPct ?? d.trivial.maxPct };
  if (!isInt(trivial.pct, 1, 100) || !isInt(trivial.maxPct, 1, 100)) return { ok: false, message: "The trivial percentages must be whole numbers from 1 to 100." };
  out.trivial = trivial as { pct: number; maxPct: number };

  const h = (raw.thresholds ?? {}) as Record<string, unknown>;
  const thresholds = {
    movementPct: h.movementPct ?? d.thresholds.movementPct,
    revenueDropPct: h.revenueDropPct ?? d.thresholds.revenueDropPct,
    marginSwingPoints: h.marginSwingPoints ?? d.thresholds.marginSwingPoints,
    pbtMovementPct: h.pbtMovementPct ?? d.thresholds.pbtMovementPct,
    nearBreakEvenPct: h.nearBreakEvenPct ?? d.thresholds.nearBreakEvenPct,
  };
  for (const [key, value] of Object.entries(thresholds)) if (!isInt(value, 1, 1000)) return { ok: false, message: `The threshold "${THRESHOLD_LABEL[key as keyof typeof THRESHOLD_LABEL]}" must be a whole number from 1 to 1,000.` };
  out.thresholds = thresholds as PlanningSettings["thresholds"];
  return { ok: true, value: out };
}

export const THRESHOLD_LABEL = {
  movementPct: "line movement (%)",
  revenueDropPct: "revenue fall (%)",
  marginSwingPoints: "gross margin swing (points)",
  pbtMovementPct: "profit movement that is not stable (%)",
  nearBreakEvenPct: "near break-even (% of revenue)",
} as const;

/** Whether the settings are exactly the defaults. */
export const isDefault = (s: PlanningSettings): boolean => JSON.stringify(s) === JSON.stringify(DEFAULT_PLANNING_SETTINGS);
