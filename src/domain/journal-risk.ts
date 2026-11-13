import type { LedgerLine } from "./ledger-parse";
import { GROUP_BY_CODE } from "./groups";

/**
 * Risk characteristics used to pick journal entries for testing (management override
 * of controls). A flag is a reason to look at an entry, not a finding.
 */
export type Flag = "outside_period" | "period_end" | "weekend" | "round" | "no_description" | "revenue_pair" | "seldom_used" | "unknown_account";

export const FLAGS: { code: Flag; label: string; explanation: string }[] = [
  { code: "outside_period", label: "Outside the period", explanation: "Dated before the period starts or after it ends." },
  { code: "period_end", label: "Period end", explanation: "Dated in the last five days of the period." },
  { code: "weekend", label: "Weekend", explanation: "Dated on a Saturday or Sunday." },
  { code: "round", label: "Round amount", explanation: "A total that is an exact multiple of 1,000." },
  { code: "no_description", label: "No description", explanation: "No line of the entry has a description." },
  { code: "revenue_pair", label: "Unusual revenue pairing", explanation: "Revenue is posted against something other than receivables, cash, related parties or payables." },
  { code: "seldom_used", label: "Seldom-used account", explanation: "Touches an account used in no more than two entries in the listing." },
  { code: "unknown_account", label: "Account not in trial balance", explanation: "Touches an account code that is not in the imported trial balance." },
];
export const FLAG_LABEL = new Map(FLAGS.map((f) => [f.code, f.label]));

export interface EntrySummary {
  entryNo: string;
  date: string;
  postedBy: string | null;
  description: string | null;
  /** Sum of the entry's debits. */
  totalMinor: number;
  lineCount: number;
  flags: Flag[];
}

export interface RiskContext {
  periodStart: string;
  periodEnd: string;
  /** Group code for each trial balance account code; null when the account is unmapped. Codes not in the map are unknown. */
  groupByAccount: Map<string, string | null>;
  periodEndDays?: number;
}

const REVENUE_COUNTERPARTS = new Set(["REVENUE", "TRADEREC", "RPREC", "CASH", "TRADEPAY"]);

function addDays(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Summarise each entry in the listing and flag the risk characteristics it shows. */
export function flagEntries(lines: LedgerLine[], ctx: RiskContext): EntrySummary[] {
  const byEntry = new Map<string, LedgerLine[]>();
  for (const l of lines) {
    const list = byEntry.get(l.entryNo);
    if (list) list.push(l);
    else byEntry.set(l.entryNo, [l]);
  }

  // How many entries touch each account.
  const usage = new Map<string, number>();
  for (const entryLines of byEntry.values()) {
    for (const code of new Set(entryLines.map((l) => l.accountCode))) usage.set(code, (usage.get(code) ?? 0) + 1);
  }
  const periodEndFrom = addDays(ctx.periodEnd, -((ctx.periodEndDays ?? 5) - 1));

  const entries: EntrySummary[] = [];
  for (const [entryNo, entryLines] of byEntry) {
    // An entry is dated by its latest line; a mixed-date entry is judged on that date.
    const date = entryLines.reduce((latest, l) => (l.date > latest ? l.date : latest), entryLines[0].date);
    const total = entryLines.reduce((s, l) => s + (l.amountMinor > 0 ? l.amountMinor : 0), 0);
    const groups = entryLines.map((l) => (ctx.groupByAccount.has(l.accountCode) ? ctx.groupByAccount.get(l.accountCode) : undefined));
    const flags: Flag[] = [];

    if (date < ctx.periodStart || date > ctx.periodEnd) flags.push("outside_period");
    else if (date >= periodEndFrom) flags.push("period_end");
    const day = new Date(date + "T00:00:00Z").getUTCDay();
    if (day === 0 || day === 6) flags.push("weekend");
    if (total >= 100000 && total % 100000 === 0) flags.push("round");
    if (entryLines.every((l) => !l.description)) flags.push("no_description");
    if (groups.includes("REVENUE") && groups.some((g) => g !== undefined && (g === null || !REVENUE_COUNTERPARTS.has(g)))) flags.push("revenue_pair");
    if (entryLines.some((l) => (usage.get(l.accountCode) ?? 0) <= 2)) flags.push("seldom_used");
    if (groups.includes(undefined)) flags.push("unknown_account");

    entries.push({
      entryNo,
      date,
      postedBy: entryLines.find((l) => l.postedBy)?.postedBy ?? null,
      description: entryLines.find((l) => l.description)?.description ?? null,
      totalMinor: total,
      lineCount: entryLines.length,
      flags,
    });
  }
  return entries;
}

export interface ReconciliationRow {
  code: string;
  name: string;
  /** Movement the trial balance implies for the period. */
  expectedMinor: number;
  /** Movement the journal listing shows. */
  ledgerMinor: number;
  differenceMinor: number;
}

export interface Reconciliation {
  /** Accounts whose movement in the listing agrees with the trial balance. */
  agreed: number;
  differences: ReconciliationRow[];
  /** Accounts that could not be checked: unmapped, or a balance sheet account with no prior-year balance. */
  unchecked: number;
}

/**
 * Check the listing is complete by rolling each account forward: opening balance plus the
 * listing's movement should equal the closing balance. Income and expense accounts open at
 * zero; balance sheet accounts open at the prior-year balance.
 *
 * Only lines dated within the period count. Otherwise an entry booked just before the period
 * end and reversed just after it would cancel out and the listing would appear to agree.
 */
export function reconcileLedger(
  lines: LedgerLine[],
  accounts: { code: string; name: string; closingMinor: number; priorMinor: number | null; groupCode: string | null }[],
  period: { start: string; end: string },
): Reconciliation {
  const movement = new Map<string, number>();
  for (const l of lines) {
    if (l.date < period.start || l.date > period.end) continue;
    movement.set(l.accountCode, (movement.get(l.accountCode) ?? 0) + l.amountMinor);
  }

  const result: Reconciliation = { agreed: 0, differences: [], unchecked: 0 };
  for (const a of accounts) {
    const statement = a.groupCode ? GROUP_BY_CODE.get(a.groupCode)?.statement : undefined;
    if (!statement || (statement === "SFP" && a.priorMinor === null)) {
      result.unchecked++;
      continue;
    }
    const expected = statement === "SCI" ? a.closingMinor : a.closingMinor - (a.priorMinor ?? 0);
    const ledger = movement.get(a.code) ?? 0;
    if (expected === ledger) result.agreed++;
    else result.differences.push({ code: a.code, name: a.name, expectedMinor: expected, ledgerMinor: ledger, differenceMinor: ledger - expected });
  }
  result.differences.sort((x, y) => Math.abs(y.differenceMinor) - Math.abs(x.differenceMinor));
  return result;
}
