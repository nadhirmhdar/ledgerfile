import library from "./methodology-library.json";

/**
 * The audit engine's rules: which areas an engagement covers, how materiality is
 * calculated, and which procedures the assessed risks load.
 *
 * The procedures come from the methodology library, generated from the documents in
 * docs/. That content is an unreviewed draft; LIBRARY_STATUS says so wherever it is shown.
 */
export type Tier = "core" | "extended" | "significant";
export type Assertion = "E" | "C" | "A" | "V" | "R" | "CO" | "CL" | "P";
/** "significant" is a high risk that also needs special audit consideration. */
export type RiskLevel = "low" | "moderate" | "high" | "significant";

export const ASSERTIONS: { code: Assertion; label: string }[] = [
  { code: "E", label: "Existence / occurrence" },
  { code: "C", label: "Completeness" },
  { code: "A", label: "Accuracy" },
  { code: "V", label: "Valuation" },
  { code: "R", label: "Rights and obligations" },
  { code: "CO", label: "Cut-off" },
  { code: "CL", label: "Classification" },
  { code: "P", label: "Presentation" },
];
export const RISK_LEVELS: { code: RiskLevel; label: string }[] = [
  { code: "low", label: "Low" },
  { code: "moderate", label: "Moderate" },
  { code: "high", label: "High" },
  { code: "significant", label: "Significant risk" },
];

export interface ProcedureTemplate {
  id: string;
  tier: Tier;
  assertions: Assertion[];
  text: string;
  evidence: string;
  reference: string;
}
export interface Area {
  code: string;
  title: string;
  objective: string;
  /** Lead sheet groups the area covers. The area is in scope when any of them has a balance. */
  groups: string[];
  /** Areas where the concern is what is missing are in scope whatever the recorded balances. */
  always: boolean;
  /** Management override is a significant risk on every audit, so its rating is fixed. */
  fixedRisk?: RiskLevel;
  procedures: ProcedureTemplate[];
}

export const LIBRARY_STATUS: string = library.status;

const SCOPE: Record<string, { groups: string[]; always?: boolean; fixedRisk?: RiskLevel }> = {
  C1: { groups: ["PPE"] },
  C2: { groups: ["INTANG"] },
  C3: { groups: ["INVEST"] },
  C4: { groups: ["INVENT"] },
  C5: { groups: ["TRADEREC"] },
  C6: { groups: ["CASH"] },
  C7: { groups: ["RPREC", "RPPAY"], always: true },
  C8: { groups: ["TRADEPAY"], always: true },
  C9: { groups: ["BORROW", "FINCOST"] },
  C10: { groups: [], always: true },
  C11: { groups: ["EOSB"] },
  C12: { groups: ["CAPITAL", "RESERVES", "RETAINED", "OWNERCA"] },
  C13: { groups: ["REVENUE", "OTHERINC"], always: true },
  C14: { groups: ["COS", "STAFF", "DEPN", "ADMIN"] },
  C15: { groups: ["TAXLIAB", "TAXEXP"], always: true },
  C16: { groups: [], always: true, fixedRisk: "significant" },
};

export const AREAS: Area[] = library.areas.map((a) => {
  const scope = SCOPE[a.code];
  if (!scope) throw new Error(`Methodology area ${a.code} has no scope mapping.`);
  return { ...a, groups: scope.groups, always: scope.always ?? false, fixedRisk: scope.fixedRisk, procedures: a.procedures as ProcedureTemplate[] };
});
export const AREA_BY_CODE = new Map(AREAS.map((a) => [a.code, a]));

/** The areas an engagement must cover, given which groups have a balance in either year. */
export function areasInScope(usedGroups: Set<string>): Area[] {
  return AREAS.filter((a) => a.always || a.groups.some((g) => usedGroups.has(g)));
}

/** The assertions an area's procedures address, in the standard order. */
export function assertionsOf(area: Area): Assertion[] {
  const present = new Set(area.procedures.flatMap((p) => p.assertions));
  return ASSERTIONS.map((a) => a.code).filter((a) => present.has(a));
}

export type AreaRisks = Partial<Record<Assertion, RiskLevel>>;

/** True when every assertion of the area has been rated. */
export function isAssessed(area: Area, risks: AreaRisks): boolean {
  return area.fixedRisk !== undefined || assertionsOf(area).every((a) => risks[a] !== undefined);
}

/**
 * The procedures an area's programme contains for the assessed risks.
 * Core procedures always load. An extended procedure loads when any assertion it
 * addresses is rated moderate or above; a significant-risk procedure when any is
 * flagged significant.
 */
export function selectProcedures(area: Area, risks: AreaRisks): ProcedureTemplate[] {
  const level = (a: Assertion): RiskLevel => area.fixedRisk ?? risks[a] ?? "low";
  return area.procedures.filter((p) => {
    if (p.tier === "core") return true;
    if (p.tier === "extended") return p.assertions.some((a) => level(a) !== "low");
    return p.assertions.some((a) => level(a) === "significant");
  });
}

// --- Materiality -------------------------------------------------------------

export type Benchmark = "pbt" | "revenue" | "assets" | "equity";

/** Guide ranges in basis points of the benchmark. Common practice, not a requirement of any standard. */
export const BENCHMARKS: Record<Benchmark, { label: string; minBp: number; maxBp: number }> = {
  pbt: { label: "Profit before tax", minBp: 500, maxBp: 1000 },
  revenue: { label: "Revenue", minBp: 50, maxBp: 200 },
  assets: { label: "Total assets", minBp: 100, maxBp: 200 },
  equity: { label: "Total equity", minBp: 200, maxBp: 500 },
};
export const PERFORMANCE_RANGE = { min: 50, max: 75 };
export const TRIVIAL_MAX = 5;

export interface MaterialityInput {
  benchmark: Benchmark;
  /** The benchmark figure, in minor units, as a positive amount. */
  benchmarkAmountMinor: number;
  /** Percentage of the benchmark, in basis points (150 = 1.5%). */
  percentageBp: number;
  /** Performance materiality as a whole percentage of overall materiality. */
  performancePct: number;
  /** Clearly-trivial threshold as a whole percentage of overall materiality. */
  trivialPct: number;
}

export interface MaterialityResult {
  overallMinor: number;
  performanceMinor: number;
  trivialMinor: number;
  /** Choices outside the guide ranges. They are allowed, but the rationale must explain them. */
  warnings: string[];
  /** Reasons the input cannot be used at all. */
  errors: string[];
}

export function computeMateriality(input: MaterialityInput): MaterialityResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const guide = BENCHMARKS[input.benchmark];
  if (!guide) errors.push("Choose a benchmark.");
  if (!Number.isInteger(input.benchmarkAmountMinor) || input.benchmarkAmountMinor <= 0) errors.push("The benchmark amount must be greater than zero. Choose a different benchmark.");
  if (!Number.isInteger(input.percentageBp) || input.percentageBp <= 0 || input.percentageBp > 2000) errors.push("Enter the percentage of the benchmark, between 0.01% and 20%.");
  if (!Number.isInteger(input.performancePct) || input.performancePct < 1 || input.performancePct > 100) errors.push("Enter performance materiality as a percentage of overall materiality, from 1 to 100.");
  if (!Number.isInteger(input.trivialPct) || input.trivialPct < 1 || input.trivialPct > 100) errors.push("Enter the trivial threshold as a percentage of overall materiality, from 1 to 100.");
  if (errors.length > 0) return { overallMinor: 0, performanceMinor: 0, trivialMinor: 0, warnings, errors };

  if (input.percentageBp < guide.minBp || input.percentageBp > guide.maxBp) {
    warnings.push(`${input.percentageBp / 100}% of ${guide.label.toLowerCase()} is outside the guide range of ${guide.minBp / 100}% to ${guide.maxBp / 100}%.`);
  }
  if (input.performancePct < PERFORMANCE_RANGE.min || input.performancePct > PERFORMANCE_RANGE.max) {
    warnings.push(`Performance materiality of ${input.performancePct}% is outside the guide range of ${PERFORMANCE_RANGE.min}% to ${PERFORMANCE_RANGE.max}%.`);
  }
  if (input.trivialPct > TRIVIAL_MAX) warnings.push(`A trivial threshold of ${input.trivialPct}% is above the guide maximum of ${TRIVIAL_MAX}%.`);

  const overallMinor = Math.round((input.benchmarkAmountMinor * input.percentageBp) / 10000);
  return {
    overallMinor,
    performanceMinor: Math.round((overallMinor * input.performancePct) / 100),
    trivialMinor: Math.round((overallMinor * input.trivialPct) / 100),
    warnings,
    errors,
  };
}
