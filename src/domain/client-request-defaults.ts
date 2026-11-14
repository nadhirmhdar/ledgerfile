/**
 * The standard requests offered by "Add the standard requests".
 *
 * STATUS: AI draft v0.1. Written by an AI model in plain words, NOT reviewed and NOT approved for use on any engagement. It is
 * a starting list for a person at the firm to read, correct and approve, in the same way as the methodology content. It is not
 * taken from any third-party or published checklist. Change the wording here and nowhere else.
 */
export const REQUEST_DEFAULTS_STATUS = "AI draft v0.1: not reviewed, not approved for use on any engagement";

export interface DefaultRequest {
  /** An audit area code, or null for a general request. */
  areaCode: string | null;
  description: string;
}

/** Requests every engagement needs, whatever is in the trial balance. */
export const GENERAL_REQUESTS: DefaultRequest[] = [
  { areaCode: null, description: "Trade licence, current and valid for the whole period" },
  { areaCode: null, description: "Signed financial statements for the prior year" },
  { areaCode: null, description: "Trial balance at the period end, agreed to the accounting system" },
  { areaCode: null, description: "General ledger for the period, in Excel" },
  { areaCode: null, description: "Minutes of owners' and board meetings held during the period and up to the signing date" },
  { areaCode: null, description: "List of related parties, and of the transactions and balances with each" },
  { areaCode: null, description: "Contact details of the client's lawyers and any other advisers we may need to write to" },
];

/** Requests for one audit area, asked only when the area is in scope. */
export const AREA_REQUESTS: DefaultRequest[] = [
  { areaCode: "C1", description: "Fixed asset register at the period end, with cost, depreciation and net book value for each asset" },
  { areaCode: "C1", description: "Purchase invoices and delivery documents for additions during the period" },
  { areaCode: "C1", description: "Sale or disposal documents for any asset sold or scrapped" },
  { areaCode: "C2", description: "Schedule of intangible assets, with cost, amortisation and the basis for each useful life" },
  { areaCode: "C2", description: "Agreements or licences supporting each intangible asset" },
  { areaCode: "C3", description: "List of investments and other financial assets, with the holding, cost and carrying value of each" },
  { areaCode: "C3", description: "Statements or certificates from the custodian or issuer at the period end" },
  { areaCode: "C4", description: "Stock listing at the period end, with quantity, unit cost and value of each item" },
  { areaCode: "C4", description: "Count sheets from the year-end stock count, and the count instructions given to staff" },
  { areaCode: "C4", description: "Details of slow-moving, damaged or obsolete stock and the provision held against it" },
  { areaCode: "C5", description: "Receivables ageing at the period end, by customer, agreed to the ledger" },
  { areaCode: "C5", description: "Customer statements or balance confirmations for the larger balances" },
  { areaCode: "C5", description: "Cash received from customers after the period end" },
  { areaCode: "C5", description: "Basis of the provision for doubtful debts, and the list of balances written off" },
  { areaCode: "C6", description: "Bank statements for every account for the whole period, and for one month after" },
  { areaCode: "C6", description: "Bank reconciliations at the period end, with the supporting lists of unpresented items" },
  { areaCode: "C6", description: "Bank confirmation letters, or authority for us to request them" },
  { areaCode: "C6", description: "Petty cash count sheet at the period end" },
  { areaCode: "C7", description: "Agreements and invoices for transactions with related parties" },
  { areaCode: "C7", description: "Balance confirmations or statements from each related party at the period end" },
  { areaCode: "C8", description: "Payables ageing at the period end, by supplier, agreed to the ledger" },
  { areaCode: "C8", description: "Supplier statements for the larger balances" },
  { areaCode: "C8", description: "Payments made after the period end, and invoices received after the period end not yet recorded" },
  { areaCode: "C8", description: "Schedule of accruals at the period end, with the basis for each" },
  { areaCode: "C9", description: "Loan and finance agreements, including any amendments during the period" },
  { areaCode: "C9", description: "Lender statements or confirmations of the balance at the period end" },
  { areaCode: "C9", description: "Repayment schedules, and evidence that any loan conditions were met" },
  { areaCode: "C9", description: "Lease agreements, with a schedule of lease payments and terms" },
  { areaCode: "C10", description: "Schedule of provisions, with the basis and the movement during the period" },
  { areaCode: "C10", description: "Details of claims, disputes and guarantees given, and of capital commitments at the period end" },
  { areaCode: "C11", description: "Staff list at the period end with joining date, salary and length of service" },
  { areaCode: "C11", description: "Calculation of the end-of-service provision, with the supporting staff records" },
  { areaCode: "C12", description: "Constitutional documents and any changes to share capital or owners' accounts during the period" },
  { areaCode: "C12", description: "Details of dividends or drawings declared and paid, with the approval for each" },
  { areaCode: "C13", description: "Sales listing for the period, by customer and month, agreed to the ledger" },
  { areaCode: "C13", description: "Contracts and price lists for the main customers" },
  { areaCode: "C13", description: "Sales invoices and delivery or completion documents for the last weeks before and the first weeks after the period end" },
  { areaCode: "C13", description: "Credit notes issued after the period end" },
  { areaCode: "C14", description: "Payroll records for the period, with the monthly payroll summaries" },
  { areaCode: "C14", description: "Expense listing for the period, with supporting invoices for the larger items" },
  { areaCode: "C14", description: "Purchase listing, by supplier, agreed to the ledger" },
  { areaCode: "C15", description: "Corporate tax returns and assessments for the current and prior year, and the tax computation" },
  { areaCode: "C15", description: "VAT returns for the period, with the reconciliation of the returns to the ledger" },
  { areaCode: "C16", description: "List of journal entries posted for the period, with who posted and approved each" },
];

export const DEFAULT_REQUESTS: DefaultRequest[] = [...GENERAL_REQUESTS, ...AREA_REQUESTS];
