/**
 * Standard grouping structure for IFRS for SMEs financial statements.
 * Each trial balance account maps to exactly one group; groups become lead sheets
 * and feed statement lines. Keywords drive the rule-based mapping suggestion.
 */
export type Statement = "SFP" | "SCI";

/** The statements in words, as the statements page names them. The one map, for anything that shows a statement's code to a reader. */
export const STATEMENT_NAME: Record<Statement, string> = { SFP: "Statement of financial position", SCI: "Statement of comprehensive income" };

export interface Group {
  code: string;
  name: string;
  statement: Statement;
  section: string;
  sort: number;
  /** Lower-case fragments; an account name containing one suggests this group. */
  keywords: string[];
}

export const GROUPS: Group[] = [
  { code: "PPE", name: "Property, plant and equipment", statement: "SFP", section: "Non-current assets", sort: 10, keywords: ["property, plant", "plant and", "equipment", "furniture", "fixtures", "vehicle", "machinery", "building", "leasehold improvement", "computer", "accumulated depreciation", "acc. dep", "acc dep"] },
  { code: "INTANG", name: "Intangible assets", statement: "SFP", section: "Non-current assets", sort: 20, keywords: ["intangible", "software", "goodwill", "trademark", "licence", "license", "accumulated amortisation", "accumulated amortization"] },
  { code: "INVEST", name: "Investments", statement: "SFP", section: "Non-current assets", sort: 30, keywords: ["investment in", "investments", "shares in", "subsidiary", "associate"] },
  { code: "INVENT", name: "Inventories", statement: "SFP", section: "Current assets", sort: 40, keywords: ["inventor", "stock in trade", "stock on hand", "raw material", "finished goods", "work in progress", "goods in transit"] },
  { code: "TRADEREC", name: "Trade and other receivables", statement: "SFP", section: "Current assets", sort: 50, keywords: ["receivable", "debtors", "prepaid", "prepayment", "deposit paid", "refundable deposit", "advance to supplier", "allowance for doubtful", "provision for doubtful", "staff advance", "vat recoverable", "input vat"] },
  { code: "RPREC", name: "Due from related parties", statement: "SFP", section: "Current assets", sort: 60, keywords: ["due from related", "due from shareholder", "due from director", "due from affiliate", "due from sister"] },
  { code: "CASH", name: "Cash and bank balances", statement: "SFP", section: "Current assets", sort: 70, keywords: ["cash", "bank", "petty cash", "current account -", "call account", "fixed deposit"] },
  { code: "CAPITAL", name: "Share capital", statement: "SFP", section: "Equity", sort: 80, keywords: ["share capital", "paid up capital", "paid-up capital", "capital account", "owner's capital", "owners capital"] },
  { code: "RESERVES", name: "Reserves", statement: "SFP", section: "Equity", sort: 90, keywords: ["statutory reserve", "legal reserve", "general reserve", "revaluation reserve"] },
  { code: "RETAINED", name: "Retained earnings", statement: "SFP", section: "Equity", sort: 100, keywords: ["retained earning", "accumulated profit", "accumulated loss", "profit and loss account", "dividend"] },
  { code: "OWNERCA", name: "Owner current accounts", statement: "SFP", section: "Equity", sort: 110, keywords: ["owner current", "owner's current", "shareholder current", "partner current", "drawings"] },
  { code: "EOSB", name: "Employees' end-of-service benefits", statement: "SFP", section: "Non-current liabilities", sort: 120, keywords: ["end of service", "end-of-service", "gratuity", "eosb"] },
  { code: "BORROW", name: "Borrowings", statement: "SFP", section: "Non-current liabilities", sort: 130, keywords: ["bank loan", "bank borrowing", "bank facility", "loan", "borrowing", "overdraft", "finance lease", "lease liabil", "trust receipt", "term facility"] },
  { code: "TRADEPAY", name: "Trade and other payables", statement: "SFP", section: "Current liabilities", sort: 140, keywords: ["payable", "creditors", "accrual", "accrued", "advance from customer", "customer advance", "deferred income", "unearned", "output vat", "vat payable", "retention", "provision for leave", "leave salary"] },
  { code: "RPPAY", name: "Due to related parties", statement: "SFP", section: "Current liabilities", sort: 150, keywords: ["due to related", "due to shareholder", "due to director", "due to affiliate", "due to sister"] },
  { code: "TAXLIAB", name: "Current tax liability", statement: "SFP", section: "Current liabilities", sort: 160, keywords: ["corporate tax payable", "income tax payable", "current tax liabil", "tax provision"] },
  { code: "REVENUE", name: "Revenue", statement: "SCI", section: "Income", sort: 200, keywords: ["revenue", "sales", "service income", "contract income", "fees earned"] },
  { code: "COS", name: "Cost of sales", statement: "SCI", section: "Cost of sales", sort: 210, keywords: ["cost of sales", "cost of goods", "cost of revenue", "purchases", "direct cost", "direct labour", "direct labor", "subcontract", "freight inward"] },
  { code: "OTHERINC", name: "Other income", statement: "SCI", section: "Income", sort: 220, keywords: ["other income", "interest income", "gain on", "miscellaneous income", "dividend income", "exchange gain"] },
  { code: "STAFF", name: "Staff costs", statement: "SCI", section: "Expenses", sort: 230, keywords: ["salar", "wages", "staff", "payroll", "bonus", "visa", "medical insurance", "employee", "air ticket", "pension"] },
  { code: "DEPN", name: "Depreciation and amortisation", statement: "SCI", section: "Expenses", sort: 240, keywords: ["depreciation expense", "depreciation charge", "depreciation -", "amortisation expense", "amortization expense", "depreciation"] },
  { code: "ADMIN", name: "General and administrative expenses", statement: "SCI", section: "Expenses", sort: 250, keywords: ["rent", "utilit", "telephone", "internet", "office", "professional fee", "legal", "audit fee", "insurance", "repairs", "maintenance", "travel", "marketing", "advertis", "licence fee", "license fee", "bank charges", "printing", "stationery", "entertainment", "miscellaneous expense", "bad debt", "expense"] },
  { code: "FINCOST", name: "Finance costs", statement: "SCI", section: "Expenses", sort: 260, keywords: ["interest expense", "finance cost", "finance charge", "interest on loan", "interest on"] },
  { code: "TAXEXP", name: "Income tax expense", statement: "SCI", section: "Tax", sort: 270, keywords: ["corporate tax expense", "income tax expense", "tax expense", "deferred tax"] },
];

export const GROUP_BY_CODE = new Map(GROUPS.map((g) => [g.code, g]));
