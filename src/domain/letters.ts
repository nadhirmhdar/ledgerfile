/**
 * The engagement letter and the management representation letter.
 *
 * The wording is the draft in docs/methodology-templates-and-prompt-lists.md, held here
 * as structured blocks so that conditional paragraphs can be included or left out. A test
 * checks every sentence here against that document, so the two cannot drift apart.
 *
 * {Braces} mark values filled from the engagement or the form. A value that was not
 * supplied is left in the letter as [the field name], for completion in Word.
 */
export type Block =
  | { kind: "heading"; text: string }
  | { kind: "para"; text: string }
  | { kind: "bullet"; text: string; level?: 1 | 2 }
  | { kind: "numbered"; text: string }
  | { kind: "signature"; lines: string[] }
  | { kind: "table"; header: string[]; rows: string[][] };

export const LETTER_NOTICE =
  "[Draft template wording, not yet reviewed. Check it against the standards and your firm's own terms, complete the bracketed items, and delete this paragraph before use.]";

/** Replace {field} with its value, or with [field] when no value was given. */
export function fill(text: string, values: Record<string, string | undefined>): string {
  return text.replace(/\{([^}]+)\}/g, (_, key: string) => {
    const value = values[key]?.trim();
    return value ? value : `[${key}]`;
  });
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** 2025-12-31 becomes 31 December 2025. Anything that is not a real date in that form is returned as typed. */
export function longDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return value.trim();
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const real = new Date(Date.UTC(year, month - 1, day));
  if (real.getUTCMonth() !== month - 1 || real.getUTCDate() !== day) return value.trim();
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

// --- Engagement letter --------------------------------------------------------

export interface EngagementLetterInput {
  values: Record<string, string | undefined>;
  /** Include the section on other services the firm provides to the client. */
  otherServices: boolean;
  /** Include the sentence disclosing the use of artificial-intelligence tools. */
  aiFeatures: boolean;
}

export const ENGAGEMENT = {
  title: "Audit of the financial statements for the year ending {period end}",
  intro:
    'You have asked us to audit the financial statements of {Client legal name} ("the Company") for the year ending {period end}. This letter sets out what the engagement covers and what each of us is responsible for. Please read it and sign the copy to confirm your agreement.',
  what: {
    heading: "What we will do",
    paras: [
      "We will audit the Company's financial statements, which consist of the statement of financial position at {period end}, the statements of comprehensive income, changes in equity and cash flows for the year, and the notes, including the accounting policies. The purpose of the audit is for us to give an opinion on whether those statements are prepared, in all material respects, in accordance with {framework}.",
    ],
  },
  how: {
    heading: "How we will do it",
    paras: [
      "We will carry out the audit under International Standards on Auditing. Those standards require us to comply with ethical requirements, including independence, and to plan and perform our work so as to obtain reasonable assurance that the statements as a whole are free from material misstatement, whether caused by fraud or error.",
      "Reasonable assurance is a high level of assurance but not a guarantee. An audit works by testing and by judgement, and internal control has inherent limits, so there is an unavoidable risk that a material misstatement goes undetected even though the audit is properly planned and performed. That risk is higher for fraud than for error, because fraud may involve collusion, forgery or deliberate concealment.",
    ],
    listIntro: "As part of the audit we will:",
    list: [
      "assess the risks of material misstatement and design our work in response;",
      "obtain an understanding of the Company's internal control as it relates to the audit, in order to design suitable procedures, but not to give an opinion on how effective that control is;",
      "evaluate the accounting policies used, the reasonableness of estimates, and the overall presentation of the statements;",
      "conclude on whether it is appropriate for the statements to be prepared on a going-concern basis.",
    ],
    after: "We will tell you in writing about any significant weaknesses in internal control that we identify during the audit.",
  },
  you: {
    heading: "What you are responsible for",
    intro: "Our audit is carried out on the basis that management and, where applicable, those charged with governance acknowledge and understand that they are responsible for:",
    items: [
      "(a) preparing financial statements that are fairly presented in accordance with {framework};",
      "(b) the internal control that management considers necessary for the statements to be free from material misstatement, whether from fraud or error;",
      "(c) assessing the Company's ability to continue as a going concern and making the related disclosures;",
      "(d) giving us:",
    ],
    access: [
      "access to all information relevant to the statements, such as records, documents and other matters;",
      "any further information we ask for;",
      "unrestricted access to people in the Company from whom we need to obtain evidence.",
    ],
    after: "We will ask you to confirm in writing, at the end of the audit, the representations made to us during it.",
  },
  otherServices: {
    heading: "Other services",
    para: "We also provide {description of other services} to the Company. Those services are covered by a separate letter. In providing them we do not take management decisions; you remain responsible for the accounting records, for reviewing and approving anything we prepare, and for the financial statements.",
  },
  report: {
    heading: "Our report",
    para: "We expect to issue a report giving our opinion on the financial statements. The form and content of the report may need to change in the light of what we find. If so, we will discuss the reasons with you before issuing it.",
  },
  timing: {
    heading: "Timing and information",
    para: "We plan to carry out our work in {fieldwork period} and to issue our report by {target date}, provided we receive the information listed in our request list by {information date} and your staff are available to answer queries.",
  },
  fees: {
    heading: "Fees",
    para: "Our fee for the audit is {fee and basis}, plus applicable VAT, payable {payment terms}. It is based on the information you have given us and on the records being complete and available on time. If significant additional work proves necessary, we will discuss it with you before carrying it out.",
  },
  confidentiality: {
    heading: "Confidentiality and data",
    para: "We keep your information confidential, except where law, regulation or professional standards require disclosure. Your data is held in our audit system and stored in {data location}.",
    ai: "Our system uses artificial-intelligence tools to assist with drafting and analysis. All such output is reviewed by our staff, and your data is not used to train those tools.",
  },
  otherTerms: {
    heading: "Other terms",
    para: "{Firm standard terms: limitation of liability, retention of working papers, anti-money-laundering obligations, complaints, termination, governing law. To be supplied by the firm and reviewed by a lawyer.}",
  },
  agreement: {
    heading: "Agreement",
    para: "This letter remains in force for future years unless it is replaced or the engagement ends. Please sign and return the attached copy to confirm that it reflects your understanding.",
  },
  closing: "Yours faithfully,",
  acknowledged: "Acknowledged and agreed on behalf of {Client legal name}:",
} as const;

export function buildEngagementLetter(input: EngagementLetterInput): Block[] {
  const v = input.values;
  const f = (text: string) => fill(text, v);
  const blocks: Block[] = [
    { kind: "para", text: LETTER_NOTICE },
    { kind: "para", text: f("{Firm name}") },
    { kind: "para", text: f("{Date}") },
    { kind: "para", text: f("To: {Addressee}, {Client legal name}") },
    { kind: "heading", text: f(ENGAGEMENT.title) },
    { kind: "para", text: f(ENGAGEMENT.intro) },
  ];
  let n = 0;
  const section = (heading: string) => blocks.push({ kind: "heading", text: `${++n}. ${heading}` });

  section(ENGAGEMENT.what.heading);
  for (const p of ENGAGEMENT.what.paras) blocks.push({ kind: "para", text: f(p) });

  section(ENGAGEMENT.how.heading);
  for (const p of ENGAGEMENT.how.paras) blocks.push({ kind: "para", text: f(p) });
  blocks.push({ kind: "para", text: ENGAGEMENT.how.listIntro });
  for (const item of ENGAGEMENT.how.list) blocks.push({ kind: "bullet", text: item });
  blocks.push({ kind: "para", text: ENGAGEMENT.how.after });

  section(ENGAGEMENT.you.heading);
  blocks.push({ kind: "para", text: ENGAGEMENT.you.intro });
  for (const item of ENGAGEMENT.you.items) blocks.push({ kind: "para", text: f(item) });
  for (const item of ENGAGEMENT.you.access) blocks.push({ kind: "bullet", text: item, level: 2 });
  blocks.push({ kind: "para", text: ENGAGEMENT.you.after });

  if (input.otherServices) {
    section(ENGAGEMENT.otherServices.heading);
    blocks.push({ kind: "para", text: f(ENGAGEMENT.otherServices.para) });
  }
  section(ENGAGEMENT.report.heading);
  blocks.push({ kind: "para", text: ENGAGEMENT.report.para });
  section(ENGAGEMENT.timing.heading);
  blocks.push({ kind: "para", text: f(ENGAGEMENT.timing.para) });
  section(ENGAGEMENT.fees.heading);
  blocks.push({ kind: "para", text: f(ENGAGEMENT.fees.para) });
  section(ENGAGEMENT.confidentiality.heading);
  blocks.push({ kind: "para", text: f(ENGAGEMENT.confidentiality.para) + (input.aiFeatures ? " " + ENGAGEMENT.confidentiality.ai : "") });
  section(ENGAGEMENT.otherTerms.heading);
  blocks.push({ kind: "para", text: f(ENGAGEMENT.otherTerms.para) });
  section(ENGAGEMENT.agreement.heading);
  blocks.push({ kind: "para", text: ENGAGEMENT.agreement.para });

  blocks.push({ kind: "para", text: ENGAGEMENT.closing });
  blocks.push({ kind: "signature", lines: [f("{Partner name}, {Firm name}")] });
  blocks.push({ kind: "para", text: f(ENGAGEMENT.acknowledged) });
  blocks.push({ kind: "signature", lines: ["Name: ____________", "Position: ____________", "Signature: ____________", "Date: ____________"] });
  return blocks;
}

// --- Management representation letter ------------------------------------------

export interface RepresentationLetterInput {
  values: Record<string, string | undefined>;
  /** Uncorrected misstatements for the attached schedule: description and amount, already formatted. */
  uncorrected: { description: string; amount: string }[];
  /** Include the paragraph on support from an owner or related party. */
  ownerSupport: boolean;
  inventory: boolean;
  receivables: boolean;
  tax: boolean;
  /** Extra representations specific to this audit, one per line. */
  specific: string[];
}

export const REPRESENTATION = {
  title: "Financial statements for the year ended {period end}",
  intro:
    "We give you this letter in connection with your audit of the financial statements of {Client legal name} for the year ended {period end}. We confirm the following, to the best of our knowledge and belief, having made the inquiries we considered necessary to inform ourselves properly.",
  statements: {
    heading: "Financial statements",
    items: [
      "We have met our responsibilities, as set out in the engagement letter dated {engagement letter date}, for preparing financial statements that are fairly presented in accordance with {framework}.",
      "The methods, data and significant assumptions we used in making accounting estimates, and the related disclosures, are appropriate and reasonable under {framework}.",
      "Related-party relationships and transactions have been properly accounted for and disclosed.",
      "All events since {period end} that require adjustment or disclosure have been adjusted or disclosed.",
    ],
    uncorrected: "The uncorrected misstatements listed in the attachment are, in our view, immaterial to the financial statements as a whole, both individually and together.",
    noneUncorrected: "There are no uncorrected misstatements.",
    policies: "The accounting policies have been applied consistently, and are appropriate to the Company's circumstances.",
  },
  information: {
    heading: "Information provided",
    items: [
      "We have given you access to all information we know to be relevant to the financial statements, the further information you asked for, and unrestricted access to people in the Company.",
      "All transactions have been recorded in the accounting records and are reflected in the financial statements.",
      "We have told you the results of our assessment of the risk that the financial statements may be materially misstated because of fraud.",
      "We have told you everything we know about any fraud or suspected fraud affecting the Company that involves management, employees with significant roles in internal control, or others where the fraud could materially affect the financial statements.",
      "We have told you everything we know about any allegations of fraud, or suspected fraud, affecting the financial statements, made by employees, former employees, regulators or others.",
      "We have told you about all known or suspected instances of non-compliance with laws and regulations whose effects should be considered in preparing the financial statements.",
      "We have told you the identity of all the Company's related parties and all the related-party relationships and transactions we know of.",
      "We have told you about all known actual or possible litigation and claims whose effects should be considered in preparing the financial statements, and they have been accounted for and disclosed in accordance with {framework}.",
    ],
  },
  assets: {
    heading: "Assets, liabilities and commitments",
    items: [
      "The Company has good title to its assets. There are no charges or other security over them except as disclosed.",
      "All liabilities, actual and contingent, have been recorded or disclosed. We have disclosed all guarantees given to third parties.",
      "We have no plans or intentions that would materially change the carrying amount or classification of assets and liabilities.",
    ],
  },
  goingConcern: {
    heading: "Going concern",
    item: "We have assessed the Company's ability to continue as a going concern for at least twelve months from {period end}. We consider the going-concern basis appropriate, and we have disclosed to you all relevant information, including our future plans.",
    support:
      "{Supporter name} has confirmed that it will provide the financial support the Company needs for at least twelve months from the date of approval of the financial statements, and we are satisfied that it is able to do so.",
  },
  inventory: "Inventories are stated at the lower of cost and {the framework's measure}. Adequate allowance has been made for slow-moving, damaged and obsolete items. Goods held on behalf of others are excluded.",
  receivables: "The allowance for doubtful debts is adequate. Receivables represent valid claims against customers for sales or services made on or before {period end}.",
  tax: "We have filed all tax returns due, disclosed to you all correspondence with the tax authority, and made adequate provision for all tax liabilities, including any penalties.",
  signed: "Signed on behalf of {Client legal name}:",
  attachment: "Attachment: schedule of uncorrected misstatements",
} as const;

export function buildRepresentationLetter(input: RepresentationLetterInput): Block[] {
  const f = (text: string) => fill(text, input.values);
  const blocks: Block[] = [
    { kind: "para", text: LETTER_NOTICE },
    { kind: "para", text: f("{Client legal name}") },
    { kind: "para", text: f("{Date}") },
    { kind: "para", text: f("To: {Firm name}") },
    { kind: "heading", text: f(REPRESENTATION.title) },
    { kind: "para", text: f(REPRESENTATION.intro) },
  ];
  // Paragraphs are numbered in the order they appear, so leaving one out never leaves a gap.
  let n = 0;
  const item = (text: string) => blocks.push({ kind: "numbered", text: `${++n}. ${f(text)}` });

  blocks.push({ kind: "heading", text: REPRESENTATION.statements.heading });
  for (const t of REPRESENTATION.statements.items) item(t);
  item(input.uncorrected.length > 0 ? REPRESENTATION.statements.uncorrected : REPRESENTATION.statements.noneUncorrected);
  item(REPRESENTATION.statements.policies);

  blocks.push({ kind: "heading", text: REPRESENTATION.information.heading });
  for (const t of REPRESENTATION.information.items) item(t);

  blocks.push({ kind: "heading", text: REPRESENTATION.assets.heading });
  for (const t of REPRESENTATION.assets.items) item(t);

  blocks.push({ kind: "heading", text: REPRESENTATION.goingConcern.heading });
  item(REPRESENTATION.goingConcern.item);
  if (input.ownerSupport) item(REPRESENTATION.goingConcern.support);

  const specific = [...(input.inventory ? [REPRESENTATION.inventory] : []), ...(input.receivables ? [REPRESENTATION.receivables] : []), ...(input.tax ? [REPRESENTATION.tax] : [])];
  if (specific.length > 0 || input.specific.length > 0) {
    blocks.push({ kind: "heading", text: "Specific matters" });
    for (const t of specific) item(t);
    for (const t of input.specific) blocks.push({ kind: "numbered", text: `${++n}. ${t}` });
  }

  blocks.push({ kind: "para", text: f(REPRESENTATION.signed) });
  blocks.push({ kind: "signature", lines: ["Name: ____________", "Position: ____________", "Signature: ____________", "Date: ____________"] });

  if (input.uncorrected.length > 0) {
    blocks.push({ kind: "heading", text: REPRESENTATION.attachment });
    blocks.push({ kind: "table", header: ["Misstatement", "Profit overstated / (understated)"], rows: input.uncorrected.map((m) => [m.description, m.amount]) });
  }
  return blocks;
}
