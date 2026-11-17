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

export const MATERIALITY_WARNING =
  "[The uncorrected misstatements in the attachment reach overall materiality on this audit file. Paragraph 5 below says they are immaterial: do not issue this letter until they are corrected or the position is resolved.]";

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
  /** The firm's letterhead lines under its name (address, contact, registration), when it has set them. None leaves the letter as it was. */
  letterhead?: string[];
}

export const ENGAGEMENT = {
  title: "Audit of the financial statements for the year ending {period end}",
  intro:
    'You have asked us to audit the financial statements of {Client legal name} ("the Company") for the year ending {period end}. This letter sets out what the engagement covers and what each of us is responsible for. Please read it and sign the copy to confirm your agreement.',
  what: {
    heading: "What we will do",
    paras: [
      "The financial statements we will audit are the Company's statement of financial position at {period end}, its statements of comprehensive income, changes in equity and cash flows for the year, and the notes with the accounting policies. We will report whether, in all material respects, those statements are prepared in accordance with {framework}.",
    ],
  },
  how: {
    heading: "How we will do it",
    paras: [
      "We will carry out the audit under International Standards on Auditing. We will keep to the ethical rules that apply, including those on independence, and we will plan and perform the work so that we can obtain reasonable assurance that the statements as a whole contain no material misstatement, whether from fraud or error.",
      "Reasonable assurance is a high degree of comfort, not a promise. We test and we use judgement, and every system of internal control has limits, so a material misstatement can stay undetected even in an audit that is properly planned and carried out. The risk is greater for fraud than for error, since fraud can involve collusion, forgery or deliberate concealment.",
    ],
    listIntro: "In doing the audit we will:",
    list: [
      "identify and assess where the statements could be materially misstated, and design our procedures in response;",
      "learn enough about the Company's internal control to choose suitable procedures. We will not be examining that control in order to give an opinion on it;",
      "consider the accounting policies, whether the estimates are reasonable, and how the statements are presented as a whole;",
      "decide whether it is appropriate for the statements to be prepared on the going concern basis.",
    ],
    after: "If we find significant weaknesses in internal control during the audit, we will tell you about them in writing.",
  },
  you: {
    heading: "What you are responsible for",
    intro: "Signing this letter confirms that management and, where applicable, those charged with governance accept the following.",
    items: [
      "Management prepares the financial statements, and they must present fairly, in all material respects, under {framework}.",
      "Management keeps the internal control it judges necessary so that the statements contain no material misstatement from fraud or error.",
      "Management judges whether the Company can continue as a going concern, and makes the disclosures that requires.",
    ],
    access: "Management also gives us what the audit needs: free access to the people in the Company, the records and documents that bear on the statements, and anything else we ask for.",
    after: "At the end of the audit we will ask you to confirm in writing the statements you have made to us during it.",
  },
  otherServices: {
    heading: "Other services",
    para: "We also provide {description of other services} to the Company. Those services are covered by a separate letter. In providing them we do not take management decisions; you remain responsible for the accounting records, for reviewing and approving anything we prepare, and for the financial statements.",
  },
  report: {
    heading: "Our report",
    para: "We expect to issue a report that gives our opinion on the financial statements. What we find may change the form or content of that report. If it does, we will talk to you about the reasons before the report is issued.",
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
    ...(input.letterhead ?? []).map((text): Block => ({ kind: "para", text })),
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
  for (const item of ENGAGEMENT.you.items) blocks.push({ kind: "bullet", text: f(item) });
  blocks.push({ kind: "para", text: ENGAGEMENT.you.access });
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
  /** True when the uncorrected misstatements reach materiality, so the letter's statement that they are immaterial is not supportable. */
  exceedsMateriality?: boolean;
}

export const REPRESENTATION = {
  title: "Financial statements for the year ended {period end}",
  intro:
    "This letter goes with your audit of the financial statements of {Client legal name} for the year ended {period end}. We confirm the statements below. They are true to the best of our knowledge and belief, and we made the enquiries we thought necessary to be sure of them.",
  statements: {
    heading: "Financial statements",
    items: [
      "As the engagement letter dated {engagement letter date} sets out, the financial statements are our responsibility, and we have prepared them so that they are fairly presented in accordance with {framework}.",
      "The methods, data and significant assumptions behind our accounting estimates, and the disclosures about them, are reasonable and fit {framework}.",
      "We have accounted for and disclosed all related-party relationships and transactions properly.",
      "Events that have happened since {period end} and call for adjustment or disclosure have been adjusted or disclosed in the statements.",
    ],
    uncorrected: "In our view the uncorrected misstatements listed in the attachment are immaterial to the financial statements as a whole, taken one by one and taken together.",
    noneUncorrected: "There are no uncorrected misstatements.",
    policies: "We have applied the accounting policies consistently, and they suit the Company's circumstances.",
  },
  information: {
    heading: "Information provided",
    items: [
      "You have had access to everything we know to be relevant to the financial statements, everything further you asked for, and free access to the people in the Company.",
      "Every transaction is in the accounting records and shows in the financial statements.",
      "We have given you our own assessment of the risk that fraud has caused a material misstatement in the financial statements.",
      "We have told you all we know about fraud, or suspected fraud, at the Company that involves management, employees with significant roles in internal control, or anyone else where the fraud could have a material effect on the statements.",
      "We have told you of every allegation of fraud, or suspected fraud, affecting the financial statements that employees, former employees, regulators or others have made to us.",
      "We have told you about every instance of non-compliance with laws and regulations, known or suspected, whose effects should be taken into account in preparing the financial statements.",
      "We have given you the names of all the Company's related parties and told you of every related-party relationship and transaction we know about.",
      "We have told you about all litigation and claims, actual or possible, that should be taken into account in the financial statements, and we have accounted for and disclosed them in accordance with {framework}.",
    ],
  },
  assets: {
    heading: "Assets, liabilities and commitments",
    items: [
      "The Company owns its assets outright. Nothing is charged or pledged against them except what has been disclosed.",
      "Every liability, actual or contingent, is recorded or disclosed, and so is every guarantee we have given to others.",
      "We have no plans that would materially change what assets and liabilities are carried at, or how they are classified.",
    ],
  },
  goingConcern: {
    heading: "Going concern",
    item: "We have looked at whether the Company can continue as a going concern for at least twelve months from {period end}. In our view the going concern basis is appropriate, and we have given you all relevant information, including our plans for the future.",
    support:
      "{Supporter name} has confirmed that it will provide the financial support the Company needs for at least twelve months from the date the financial statements are approved, and we are satisfied that it can do so.",
  },
  specificHeading: "Specific matters",
  inventory: "Inventories are carried at the lower of cost and {the framework's measure}, with adequate allowance for slow-moving, damaged and obsolete items. Goods held for others are left out.",
  receivables: "The allowance for doubtful debts is adequate. Receivables are valid claims against customers for goods or services supplied on or before {period end}.",
  tax: "We have filed every tax return that was due, shown you all our correspondence with the tax authority, and made adequate provision for all tax liabilities, including penalties.",
  signed: "Signed on behalf of {Client legal name}:",
  attachment: "Attachment: schedule of uncorrected misstatements",
} as const;

export function buildRepresentationLetter(input: RepresentationLetterInput): Block[] {
  const f = (text: string) => fill(text, input.values);
  const blocks: Block[] = [
    { kind: "para", text: LETTER_NOTICE },
    ...(input.exceedsMateriality && input.uncorrected.length > 0 ? [{ kind: "para" as const, text: MATERIALITY_WARNING }] : []),
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
    blocks.push({ kind: "heading", text: REPRESENTATION.specificHeading });
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
