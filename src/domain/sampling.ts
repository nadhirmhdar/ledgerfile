/**
 * Sample-size calculator for tests of details, following the simplified method in the
 * methodology draft (reviewer decision R5). The factors are a proposal drawn from common
 * practice. ISA 530 does not prescribe sample sizes, so the firm must approve them.
 */
export type SamplingRisk = "low" | "moderate" | "high";

/** [no other substantive evidence, analytical or other procedures also give evidence] */
export const SAMPLING_FACTORS: Record<SamplingRisk, [number, number]> = {
  low: [1.0, 0.5],
  moderate: [2.0, 1.0],
  high: [3.0, 2.0],
};
export const MIN_SAMPLE = 5;
/** Above this, reconsider the approach (stratify, or use analytical procedures) instead of simply testing more. */
export const RECONSIDER_ABOVE = 60;

export interface SampleInput {
  /** Value of the population after removing items tested in full, in minor units. */
  populationMinor: number;
  performanceMaterialityMinor: number;
  risk: SamplingRisk;
  /** True when analytical or other substantive procedures also give evidence on the assertion. */
  otherEvidence: boolean;
}

export interface SampleResult {
  size: number;
  factor: number;
  /** What the formula gave before the minimum was applied. */
  calculated: number;
  notes: string[];
}

export function sampleSize(input: SampleInput): SampleResult | { error: string } {
  if (!(input.performanceMaterialityMinor > 0)) return { error: "Set materiality first: the calculation needs performance materiality." };
  if (!(input.populationMinor >= 0) || !Number.isFinite(input.populationMinor)) return { error: "Enter the value of the population as a positive number." };
  const factor = SAMPLING_FACTORS[input.risk]?.[input.otherEvidence ? 1 : 0];
  if (factor === undefined) return { error: "Choose the assessed risk." };

  const calculated = Math.ceil((input.populationMinor / input.performanceMaterialityMinor) * factor);
  const notes: string[] = [];
  if (input.populationMinor === 0) return { size: 0, factor, calculated: 0, notes: ["Nothing remains to sample once the items tested in full are removed."] };
  let size = calculated;
  if (size < MIN_SAMPLE) {
    size = MIN_SAMPLE;
    notes.push(`The minimum of ${MIN_SAMPLE} items applies.`);
  }
  if (size > RECONSIDER_ABOVE) {
    notes.push(`More than ${RECONSIDER_ABOVE} items: reconsider the approach, for example by stratifying the population or using analytical procedures, instead of simply testing more.`);
  }
  return { size, factor, calculated, notes };
}
