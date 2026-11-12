export type JournalType = "adjusting" | "reclassification";

export interface JournalLineInput {
  accountId: string;
  /** Signed minor units: debit positive, credit negative. */
  amountMinor: number;
}

/** Returns the reasons a journal entry cannot be posted; empty when it is valid. */
export function validateJournal(description: string, lines: JournalLineInput[]): string[] {
  const problems: string[] = [];
  if (description.trim().length < 3) problems.push("Enter a description explaining the entry.");
  if (lines.length < 2) problems.push("An entry needs at least two lines.");
  if (lines.some((l) => !Number.isInteger(l.amountMinor) || l.amountMinor === 0)) {
    problems.push("Every line needs a debit or a credit amount.");
  }
  const total = lines.reduce((s, l) => s + l.amountMinor, 0);
  if (lines.length >= 2 && total !== 0) {
    problems.push(`Debits and credits differ by ${(Math.abs(total) / 100).toFixed(2)}.`);
  }
  return problems;
}
