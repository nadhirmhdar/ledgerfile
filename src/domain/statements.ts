import { GROUPS } from "./groups";

/**
 * Financial statements built from adjusted, mapped balances.
 *
 * Inputs use the ledger convention (debit positive, credit negative). Every amount
 * in the output is in presentation sign: assets, liabilities, equity, income and
 * expenses are all positive when they have their normal balance.
 */
export interface StatementAccount {
  groupCode: string | null;
  /** Adjusted closing balance: trial balance plus journals. */
  closingMinor: number;
  priorMinor: number | null;
  approved: boolean;
}

export interface StatementLine {
  key: string;
  label: string;
  current: number;
  prior: number;
  kind: "line" | "subtotal" | "total";
  /** Group behind the line, for drilling down to its lead sheet. */
  groupCode?: string;
}

export interface StatementSection {
  title: string;
  lines: StatementLine[];
}

export interface Check {
  label: string;
  passed: boolean;
  detail?: string;
}

export interface Statements {
  financialPosition: StatementSection[];
  comprehensiveIncome: StatementLine[];
  checks: Check[];
  /** True when every check passes; statements should not be issued otherwise. */
  clean: boolean;
  hasComparatives: boolean;
}

const ASSET_SECTIONS = ["Non-current assets", "Current assets"];
const EQUITY_SECTION = "Equity";
const LIABILITY_SECTIONS = ["Non-current liabilities", "Current liabilities"];
const EXPENSE_GROUPS = ["STAFF", "DEPN", "ADMIN", "FINCOST"];

function fmt(minor: number): string {
  return (Math.abs(minor) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export interface StatementOptions {
  /**
   * The amount of total borrowings due within twelve months, in presentation sign, for each
   * year. It is shown under current liabilities and deducted from the non-current line.
   */
  borrowingsCurrent?: { current: number; prior: number };
}

export function buildStatements(accounts: StatementAccount[], options: StatementOptions = {}): Statements {
  // Ledger-sign totals per group for each year.
  const current = new Map<string, number>();
  const prior = new Map<string, number>();
  for (const a of accounts) {
    if (!a.groupCode) continue;
    current.set(a.groupCode, (current.get(a.groupCode) ?? 0) + a.closingMinor);
    prior.set(a.groupCode, (prior.get(a.groupCode) ?? 0) + (a.priorMinor ?? 0));
  }
  const hasComparatives = accounts.some((a) => a.priorMinor !== null);
  const ordered = [...GROUPS].sort((a, b) => a.sort - b.sort);
  const used = (code: string) => (current.get(code) ?? 0) !== 0 || (prior.get(code) ?? 0) !== 0;

  // sign = 1 keeps debits positive (assets, expenses); sign = -1 shows credits positive.
  const line = (code: string, label: string, sign: 1 | -1): StatementLine => ({
    key: code,
    label,
    // "+ 0" turns a negative zero into zero, so an empty credit line never prints as (0.00).
    current: sign * (current.get(code) ?? 0) + 0,
    prior: sign * (prior.get(code) ?? 0) + 0,
    kind: "line",
    groupCode: code,
  });
  const sum = (key: string, label: string, lines: StatementLine[], kind: "subtotal" | "total" = "subtotal"): StatementLine => ({
    key,
    label,
    current: lines.reduce((s, l) => s + l.current, 0),
    prior: lines.reduce((s, l) => s + l.prior, 0),
    kind,
  });

  // --- Statement of comprehensive income ---------------------------------
  const revenue = line("REVENUE", "Revenue", -1);
  const costOfSales = line("COS", "Cost of sales", 1);
  const grossProfit: StatementLine = {
    key: "GROSS",
    label: "Gross profit",
    current: revenue.current - costOfSales.current,
    prior: revenue.prior - costOfSales.prior,
    kind: "subtotal",
  };
  const otherIncome = line("OTHERINC", "Other income", -1);
  const expenses = ordered.filter((g) => EXPENSE_GROUPS.includes(g.code) && used(g.code)).map((g) => line(g.code, g.name, 1));
  const totalExpenses = sum("EXPENSES", "Total expenses", expenses);
  const beforeTax: StatementLine = {
    key: "PBT",
    label: "Profit before tax",
    current: grossProfit.current + otherIncome.current - totalExpenses.current,
    prior: grossProfit.prior + otherIncome.prior - totalExpenses.prior,
    kind: "subtotal",
  };
  const tax = line("TAXEXP", "Income tax expense", 1);
  const profit: StatementLine = {
    key: "PROFIT",
    label: "Profit for the year",
    current: beforeTax.current - tax.current,
    prior: beforeTax.prior - tax.prior,
    kind: "total",
  };
  const comprehensiveIncome: StatementLine[] = [
    revenue,
    costOfSales,
    grossProfit,
    ...(used("OTHERINC") ? [otherIncome] : []),
    ...expenses,
    beforeTax,
    ...(used("TAXEXP") ? [tax] : []),
    profit,
  ];

  // --- Statement of financial position -----------------------------------
  const sectionLines = (section: string, sign: 1 | -1) =>
    ordered.filter((g) => g.statement === "SFP" && g.section === section && used(g.code)).map((g) => line(g.code, g.name, sign));

  const assetSections = ASSET_SECTIONS.map((title) => {
    const lines = sectionLines(title, 1);
    return { title, lines: [...lines, sum(`T:${title}`, `Total ${title.toLowerCase()}`, lines)] };
  });
  const totalAssets = sum("TOTAL_ASSETS", "Total assets", assetSections.map((s) => s.lines[s.lines.length - 1]), "total");

  // The trial balance is taken before closing entries, so the year's result is still in
  // income and expense accounts. It is shown within equity as its own line.
  const equityLines = sectionLines(EQUITY_SECTION, -1);
  const result: StatementLine = { key: "RESULT", label: "Profit for the year", current: profit.current, prior: profit.prior, kind: "line" };
  const equityAll = [...equityLines, result];
  const totalEquity = sum("TOTAL_EQUITY", "Total equity", equityAll);

  const split = options.borrowingsCurrent ?? { current: 0, prior: 0 };
  const liabilitySections = LIABILITY_SECTIONS.map((title) => {
    let lines = sectionLines(title, -1);
    if (title === "Non-current liabilities") {
      lines = lines
        .map((l) => (l.key === "BORROW" ? { ...l, current: l.current - split.current, prior: l.prior - split.prior } : l))
        .filter((l) => l.key !== "BORROW" || l.current !== 0 || l.prior !== 0);
    }
    if (title === "Current liabilities" && (split.current !== 0 || split.prior !== 0)) {
      lines = [{ key: "BORROW_CUR", label: "Borrowings: current portion", current: split.current, prior: split.prior, kind: "line", groupCode: "BORROW" }, ...lines];
    }
    return { title, lines: [...lines, sum(`T:${title}`, `Total ${title.toLowerCase()}`, lines)] };
  });
  const totalLiabilities = sum("TOTAL_LIABILITIES", "Total liabilities", liabilitySections.map((s) => s.lines[s.lines.length - 1]));
  const totalEquityAndLiabilities = sum("TOTAL_EL", "Total equity and liabilities", [totalEquity, totalLiabilities], "total");

  // A section with nothing in it (only its zero subtotal) is left off the face of the statement.
  const nonEmpty = (s: StatementSection) => s.lines.length > 1;
  const financialPosition: StatementSection[] = [
    ...assetSections.filter(nonEmpty),
    { title: "", lines: [totalAssets] },
    { title: EQUITY_SECTION, lines: [...equityAll, totalEquity] },
    ...liabilitySections.filter(nonEmpty),
    { title: "", lines: [totalLiabilities, totalEquityAndLiabilities] },
  ];

  // --- Checks -------------------------------------------------------------
  const unmapped = accounts.filter((a) => !a.groupCode).length;
  const unapproved = accounts.filter((a) => a.groupCode && !a.approved).length;
  const tbTotal = accounts.reduce((s, a) => s + a.closingMinor, 0);
  const priorTotal = accounts.reduce((s, a) => s + (a.priorMinor ?? 0), 0);
  const diff = totalAssets.current - totalEquityAndLiabilities.current;
  const priorDiff = totalAssets.prior - totalEquityAndLiabilities.prior;

  const checks: Check[] = [
    { label: "Adjusted trial balance adds to zero", passed: tbTotal === 0, detail: tbTotal === 0 ? undefined : `Out by ${fmt(tbTotal)}.` },
    { label: "Every account is mapped to a group", passed: unmapped === 0, detail: unmapped === 0 ? undefined : `${unmapped} account(s) are unmapped and are missing from the statements.` },
    { label: "Every mapping has been reviewed", passed: unapproved === 0, detail: unapproved === 0 ? undefined : `${unapproved} suggested mapping(s) are not yet accepted.` },
    { label: "Total assets equal total equity and liabilities", passed: diff === 0, detail: diff === 0 ? undefined : `Difference of ${fmt(diff)}.` },
  ];
  if (split.current !== 0 || split.prior !== 0) {
    const totalCurrent = -(current.get("BORROW") ?? 0);
    const totalPrior = -(prior.get("BORROW") ?? 0);
    const within = split.current >= 0 && split.prior >= 0 && split.current <= totalCurrent && split.prior <= totalPrior;
    checks.push({
      label: "Current portion of borrowings is within total borrowings",
      passed: within,
      detail: within ? undefined : "The amount entered as due within twelve months is more than the borrowings in the trial balance.",
    });
  }
  if (hasComparatives) {
    checks.push({
      label: "Comparative figures balance",
      passed: priorTotal === 0 && priorDiff === 0,
      detail: priorTotal === 0 && priorDiff === 0 ? undefined : `Prior-year balances are out by ${fmt(priorTotal !== 0 ? priorTotal : priorDiff)}.`,
    });
  }

  return { financialPosition, comprehensiveIncome, checks, clean: checks.every((c) => c.passed), hasComparatives };
}
