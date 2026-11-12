import { GROUPS, GROUP_BY_CODE } from "./groups";
import { applicablePolicies, POLICY_REVIEW_NOTICE } from "./policies";
import { buildStatements, type Check, type StatementAccount, type StatementLine, type Statements } from "./statements";

/**
 * The full set of financial statements: the two primary statements from statements.ts
 * plus the statement of changes in equity, the statement of cash flows and the notes.
 *
 * Amounts are minor units. Inputs are in ledger sign (debit positive); outputs are in
 * presentation sign, with cash inflows positive in the cash flow statement.
 */
export interface PackAccount extends StatementAccount {
  code: string;
  name: string;
}

export interface EquityStatement {
  columns: { key: string; label: string }[];
  rows: { key: "opening" | "profit" | "other" | "closing"; label: string; values: number[]; total: number; kind: "line" | "total" }[];
}

export interface CashFlowStatement {
  sections: { title: string; lines: StatementLine[] }[];
  netChange: number;
  opening: number;
  closing: number;
}

export interface Note {
  number: number;
  title: string;
  /** Narrative paragraphs. Text in [square brackets] is for the preparer to complete. */
  paragraphs: string[];
  /** Titled passages within the note, used for the individual accounting policies. */
  subsections?: { title: string; text: string }[];
  table?: { rows: { label: string; current: number; prior: number | null }[]; totalCurrent: number; totalPrior: number };
  groupCode?: string;
}

export interface RoundingInfo {
  /** Minor units per presentation unit: 1 = exact, 100 = whole currency units. */
  unitMinor: number;
  /** Where the rounding difference was put, and how much, for each year. Null when none was needed. */
  current: { account: string; amountMinor: number } | null;
  prior: { account: string; amountMinor: number } | null;
}

export interface StatementPack {
  base: Statements;
  equity: EquityStatement | null;
  cashFlow: CashFlowStatement | null;
  notes: Note[];
  /** Note number for a group, for the reference shown on the statement line. */
  noteByGroup: Record<string, number>;
  rounding: RoundingInfo;
  checks: Check[];
  clean: boolean;
}

// --- Rounding -----------------------------------------------------------------

function roundTo(value: number, unit: number): number {
  // Round half away from zero, so a debit and an equal credit round to equal amounts.
  return Math.sign(value) * Math.round(Math.abs(value) / unit) * unit;
}

/**
 * Round every account to the presentation unit. Rounding each account separately can leave
 * the trial balance a few units out, so the difference is put through one nominated account:
 * the largest general expense account, or failing that the largest account. This keeps every
 * statement, note and lead sheet total in agreement with each other.
 */
export function roundAccounts(accounts: PackAccount[], unitMinor: number): { accounts: PackAccount[]; rounding: RoundingInfo } {
  const rounding: RoundingInfo = { unitMinor, current: null, prior: null };
  if (unitMinor <= 1) return { accounts, rounding };

  const rounded = accounts.map((a) => ({
    ...a,
    closingMinor: roundTo(a.closingMinor, unitMinor),
    priorMinor: a.priorMinor === null ? null : roundTo(a.priorMinor, unitMinor),
  }));
  const mapped = rounded.map((a, i) => ({ a, i })).filter(({ a }) => a.groupCode);
  const pick = (size: (a: PackAccount) => number) => {
    const admin = mapped.filter(({ a }) => a.groupCode === "ADMIN" && size(a) !== 0);
    const pool = admin.length > 0 ? admin : mapped.filter(({ a }) => size(a) !== 0);
    return pool.sort((x, y) => size(y.a) - size(x.a))[0]?.i;
  };

  // Only correct a difference that rounding itself created: an unbalanced trial balance stays unbalanced.
  const exactCurrent = accounts.reduce((s, a) => s + a.closingMinor, 0);
  const diffCurrent = rounded.reduce((s, a) => s + a.closingMinor, 0);
  if (exactCurrent === 0 && diffCurrent !== 0) {
    const i = pick((a) => Math.abs(a.closingMinor));
    if (i !== undefined) {
      rounded[i] = { ...rounded[i], closingMinor: rounded[i].closingMinor - diffCurrent };
      rounding.current = { account: rounded[i].name, amountMinor: -diffCurrent };
    }
  }
  const exactPrior = accounts.reduce((s, a) => s + (a.priorMinor ?? 0), 0);
  const diffPrior = rounded.reduce((s, a) => s + (a.priorMinor ?? 0), 0);
  if (exactPrior === 0 && diffPrior !== 0) {
    const i = pick((a) => Math.abs(a.priorMinor ?? 0));
    if (i !== undefined) {
      rounded[i] = { ...rounded[i], priorMinor: (rounded[i].priorMinor ?? 0) - diffPrior };
      rounding.prior = { account: rounded[i].name, amountMinor: -diffPrior };
    }
  }
  return { accounts: rounded, rounding };
}

// --- The pack -----------------------------------------------------------------

const EQUITY_COLUMNS = ["CAPITAL", "RESERVES", "RETAINED", "OWNERCA"];
const FRAMEWORK_NOTES = 3;

export function buildStatementPack(input: PackAccount[], options: { unitMinor?: number; framework?: string; currency?: string } = {}): StatementPack {
  const { accounts, rounding } = roundAccounts(input, options.unitMinor ?? 1);
  const base = buildStatements(accounts);
  const framework = options.framework ?? "IFRS for SMEs";

  // Ledger-sign totals per group.
  const cur = new Map<string, number>();
  const pri = new Map<string, number>();
  for (const a of accounts) {
    if (!a.groupCode) continue;
    cur.set(a.groupCode, (cur.get(a.groupCode) ?? 0) + a.closingMinor);
    pri.set(a.groupCode, (pri.get(a.groupCode) ?? 0) + (a.priorMinor ?? 0));
  }
  const c = (g: string) => cur.get(g) ?? 0;
  const p = (g: string) => pri.get(g) ?? 0;
  const sci = (key: string) => base.comprehensiveIncome.find((l) => l.key === key) ?? { current: 0, prior: 0 };
  const profit = sci("PROFIT");
  const used = (g: string) => c(g) !== 0 || p(g) !== 0;

  // --- Statement of changes in equity ---
  // Equity is shown in presentation sign; retained earnings include the result for each year.
  let equity: EquityStatement | null = null;
  let otherEquityMovements = 0;
  if (base.hasComparatives) {
    const cols = EQUITY_COLUMNS.filter((g) => used(g) || g === "RETAINED");
    const opening = cols.map((g) => -p(g) + (g === "RETAINED" ? profit.prior : 0));
    const closing = cols.map((g) => -c(g) + (g === "RETAINED" ? profit.current : 0));
    const profitRow = cols.map((g) => (g === "RETAINED" ? profit.current : 0));
    const other = cols.map((_, i) => closing[i] - opening[i] - profitRow[i]);
    const total = (v: number[]) => v.reduce((s, x) => s + x, 0);
    otherEquityMovements = total(other);
    equity = {
      columns: cols.map((g) => ({ key: g, label: GROUP_BY_CODE.get(g)!.name })),
      rows: [
        { key: "opening", label: "Balance at the start of the year", values: opening, total: total(opening), kind: "line" },
        { key: "profit", label: "Profit for the year", values: profitRow, total: total(profitRow), kind: "line" },
        { key: "other", label: "Other movements [analyse: contributions, distributions, transfers]", values: other, total: total(other), kind: "line" },
        { key: "closing", label: "Balance at the end of the year", values: closing, total: total(closing), kind: "total" },
      ],
    };
  }

  // --- Statement of cash flows (indirect method, derived from the movements) ---
  let cashFlow: CashFlowStatement | null = null;
  if (base.hasComparatives) {
    // Change in a group in presentation terms: positive when an asset (debit) or a liability (credit) grew.
    const assetChange = (...gs: string[]) => gs.reduce((s, g) => s + (c(g) - p(g)), 0);
    const liabilityChange = (...gs: string[]) => gs.reduce((s, g) => s - (c(g) - p(g)), 0);
    const line = (key: string, label: string, amount: number): StatementLine => ({ key, label, current: amount, prior: 0, kind: "line" });
    const subtotal = (key: string, label: string, lines: StatementLine[]): StatementLine => ({
      key,
      label,
      current: lines.reduce((s, l) => s + l.current, 0),
      prior: 0,
      kind: "subtotal",
    });
    const keep = (lines: StatementLine[]) => lines.filter((l) => l.current !== 0 || l.key === "PBT");

    const depreciation = c("DEPN");
    const financeCosts = c("FINCOST");
    const operating = keep([
      line("PBT", "Profit before tax", sci("PBT").current),
      line("CF_DEPN", "Depreciation and amortisation", depreciation),
      line("CF_FIN", "Finance costs", financeCosts),
      line("CF_INV", "(Increase)/decrease in inventories", -assetChange("INVENT")),
      line("CF_REC", "(Increase)/decrease in receivables", -assetChange("TRADEREC", "RPREC")),
      line("CF_PAY", "Increase/(decrease) in payables", liabilityChange("TRADEPAY", "RPPAY")),
      line("CF_EOSB", "Increase/(decrease) in end-of-service benefits", liabilityChange("EOSB")),
      line("CF_TAX", "Income tax paid", -c("TAXEXP") + liabilityChange("TAXLIAB")),
    ]);
    const investing = keep([
      // Net of disposals: additions less the carrying amount of anything disposed of.
      line("CF_CAPEX", "Purchase of property, plant, equipment and intangibles (net of disposals)", -(assetChange("PPE", "INTANG") + depreciation)),
      line("CF_INVEST", "(Purchase)/disposal of investments", -assetChange("INVEST")),
    ]);
    const financing = keep([
      line("CF_BORROW", "Proceeds from/(repayment of) borrowings", liabilityChange("BORROW")),
      line("CF_INTEREST", "Finance costs paid", -financeCosts),
      line("CF_EQUITY", "Contributions, distributions and other equity movements", otherEquityMovements),
    ]);
    const sections = [
      { title: "Operating activities", lines: [...operating, subtotal("CF_OP", "Net cash from operating activities", operating)] },
      { title: "Investing activities", lines: [...investing, subtotal("CF_IN", "Net cash used in investing activities", investing)] },
      { title: "Financing activities", lines: [...financing, subtotal("CF_FI", "Net cash from financing activities", financing)] },
    ];
    cashFlow = {
      sections,
      netChange: sections.reduce((s, sec) => s + sec.lines[sec.lines.length - 1].current, 0),
      opening: p("CASH"),
      closing: c("CASH"),
    };
  }

  // --- Notes ---
  const notes: Note[] = [
    {
      number: 1,
      title: "General information",
      paragraphs: ["[Legal form, country of incorporation, registered address, licence number and principal activities of the entity.]"],
    },
    {
      number: 2,
      title: "Basis of preparation",
      paragraphs: [
        `These financial statements have been prepared in accordance with ${framework}. They are presented in ${options.currency ?? "[currency]"}${
          rounding.unitMinor > 1 ? ", rounded to the nearest whole unit" : ""
        }, and have been prepared on the going-concern basis under the historical cost convention [amend if any item is measured on another basis].`,
      ],
    },
    {
      number: 3,
      title: "Significant accounting policies",
      paragraphs: [POLICY_REVIEW_NOTICE],
      subsections: applicablePolicies(new Set(GROUPS.map((g) => g.code).filter(used))).map((p) => ({ title: p.title, text: p.text })),
    },
  ];
  const noteByGroup: Record<string, number> = {};
  const byGroup = new Map<string, PackAccount[]>();
  for (const a of accounts) if (a.groupCode) byGroup.set(a.groupCode, [...(byGroup.get(a.groupCode) ?? []), a]);
  let next = FRAMEWORK_NOTES + 1;
  for (const group of [...GROUPS].sort((a, b) => a.sort - b.sort)) {
    const list = (byGroup.get(group.code) ?? []).filter((a) => a.closingMinor !== 0 || (a.priorMinor ?? 0) !== 0);
    // A line made of a single account needs no breakdown.
    if (list.length < 2) continue;
    // Credit-balance groups are shown positive, like the statement line they support.
    const sign = group.statement === "SFP" ? (["Non-current assets", "Current assets"].includes(group.section) ? 1 : -1) : ["REVENUE", "OTHERINC"].includes(group.code) ? -1 : 1;
    const rows = list
      .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
      .map((a) => ({ label: a.name, current: sign * a.closingMinor, prior: a.priorMinor === null ? null : sign * a.priorMinor }));
    notes.push({
      number: next,
      title: group.name,
      paragraphs: [],
      groupCode: group.code,
      table: { rows, totalCurrent: rows.reduce((s, r) => s + r.current, 0), totalPrior: rows.reduce((s, r) => s + (r.prior ?? 0), 0) },
    });
    noteByGroup[group.code] = next++;
  }

  // --- Checks ---
  const checks = [...base.checks];
  if (cashFlow) {
    const diff = cashFlow.netChange - (cashFlow.closing - cashFlow.opening);
    checks.push({
      label: "Cash flow statement agrees to the movement in cash",
      passed: diff === 0,
      detail: diff === 0 ? undefined : "The derived cash flows do not explain the change in cash; check that every account is mapped and both years balance.",
    });
  }
  if (equity) {
    const closing = equity.rows[3].total;
    const sfpEquity = base.financialPosition.flatMap((s) => s.lines).find((l) => l.key === "TOTAL_EQUITY")?.current ?? 0;
    checks.push({ label: "Statement of changes in equity agrees to total equity", passed: closing === sfpEquity });
  }

  return { base, equity, cashFlow, notes, noteByGroup, rounding, checks, clean: checks.every((x) => x.passed) };
}
