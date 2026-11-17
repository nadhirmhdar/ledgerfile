import { fill, longDate, type Block } from "./letters";

/**
 * The auditor's report: wording and a pure builder.
 *
 * THE WORDING IS AN UNREVIEWED DRAFT. It is LedgerFile's own plain wording, held as structured blocks so that the optional sections
 * can be included or left out. It is not the illustrative text of any standard-setter, software vendor or firm, and it has not been
 * checked against ISA 700, 705, 706 or 570 by a reviewer. It is the draft in section 5 of docs/methodology-templates-and-prompt-lists.md,
 * and a test checks every sentence here against that section, so the two cannot drift apart. Standards are cited by number only.
 *
 * {Braces} mark values filled from the engagement or the partner's decision. A value that was not supplied is left in the report as
 * [the field name], for completion in Word. Nothing here decides the opinion: the partner does, and buildReport only words it.
 */

/** The first paragraph of every generated report (the report is not to be issued until it has been reviewed and the notice deleted). */
export const REPORT_NOTICE =
  "[Draft report wording, not yet reviewed. Check it against ISA 700, 705, 706 and 570 and your firm's own requirements, complete the bracketed items, and delete this paragraph before the report is issued.]";

export const OPINION_KINDS = ["unmodified", "qualified", "adverse", "disclaimer"] as const;
export type OpinionKind = (typeof OPINION_KINDS)[number];

export const OPINION_LABEL: Record<OpinionKind, string> = {
  unmodified: "Unmodified opinion",
  qualified: "Qualified opinion",
  adverse: "Adverse opinion",
  disclaimer: "Disclaimer of opinion",
};

const SCOPE = "which consist of the statement of financial position at {period end}, the statements of comprehensive income, changes in equity and cash flows for the year then ended, and the notes, including the accounting policies.";

export const REPORT = {
  title: "Independent auditor's report",
  addressee: "To the shareholders of {client name}",
  opinion: {
    headings: { unmodified: "Opinion", qualified: "Qualified opinion", adverse: "Adverse opinion", disclaimer: "Disclaimer of opinion" },
    audited: "We have audited the financial statements of {client name}, " + SCOPE,
    engaged: "We were engaged to audit the financial statements of {client name}, " + SCOPE,
    unmodified: "In our opinion, the financial statements present fairly, in all material respects, the financial position of {client name} at {period end}, and its financial performance and cash flows for the year then ended, in accordance with {framework}.",
    qualified:
      "In our opinion, except for the effects of the matter described in the Basis for qualified opinion section, the financial statements present fairly, in all material respects, the financial position of {client name} at {period end}, and its financial performance and cash flows for the year then ended, in accordance with {framework}.",
    adverse:
      "In our opinion, because of the significance of the matter described in the Basis for adverse opinion section, the financial statements do not present fairly the financial position of {client name} at {period end}, or its financial performance and cash flows for the year then ended, in accordance with {framework}.",
    disclaimer:
      "We do not express an opinion on the financial statements. Because of the significance of the matter described in the Basis for disclaimer of opinion section, we were not able to obtain enough appropriate audit evidence to provide a basis for an opinion on them.",
  },
  basis: {
    headings: { unmodified: "Basis for opinion", qualified: "Basis for qualified opinion", adverse: "Basis for adverse opinion", disclaimer: "Basis for disclaimer of opinion" },
    modification: "{basis for modification}",
    standards: "We conducted our audit in accordance with International Standards on Auditing. Our responsibilities under those standards are described in the Auditor's responsibilities section of this report.",
    independence:
      "We are independent of the Company in accordance with the ethical requirements that apply to our audit of the financial statements, and we have met our other ethical responsibilities in accordance with those requirements.",
    evidence: {
      unmodified: "We believe that the audit evidence we have obtained is enough, and appropriate, to provide a basis for our opinion.",
      qualified: "We believe that the audit evidence we have obtained is enough, and appropriate, to provide a basis for our qualified opinion.",
      adverse: "We believe that the audit evidence we have obtained is enough, and appropriate, to provide a basis for our adverse opinion.",
    },
    notObtained: "We were not able to obtain enough appropriate audit evidence to provide a basis for an opinion, for the reason given above.",
  },
  goingConcern: {
    heading: "Material uncertainty related to going concern",
    para: "We draw attention to note {note reference} to the financial statements, which says there is a material uncertainty about the Company's ability to continue as a going concern. Our opinion is not modified in respect of this matter.",
  },
  emphasis: { heading: "Emphasis of matter", para: "{emphasis of matter text}", after: "Our opinion is not modified in respect of this matter." },
  otherMatter: { heading: "Other matter", para: "{other matter text}" },
  management: {
    heading: "Responsibilities of management and those charged with governance",
    paras: [
      "Management is responsible for preparing financial statements that present fairly in accordance with {framework}, and for the internal control that management decides is necessary for statements free from material misstatement, whether caused by fraud or error.",
      "In preparing the financial statements, management is responsible for assessing the Company's ability to continue as a going concern and for disclosing matters relating to going concern where applicable. Management uses the going-concern basis unless it intends to liquidate the Company or stop operating, or has no realistic alternative but to do so.",
      "Those charged with governance are responsible for overseeing the Company's financial reporting process.",
    ],
  },
  auditor: {
    heading: "Auditor's responsibilities",
    intro:
      "Our aim is to obtain reasonable assurance that the financial statements as a whole are free from material misstatement, whether caused by fraud or error, and to issue a report containing our opinion. Reasonable assurance is a high level of assurance, not a guarantee that an audit will always find a material misstatement. Misstatements are material if they could reasonably be expected to influence the decisions users make from these financial statements.",
    listIntro: "In an audit under International Standards on Auditing we use judgement and question what we are told throughout. We also:",
    list: [
      "identify and assess the risks of material misstatement, whether from fraud or error, and design and carry out procedures that respond to those risks;",
      "obtain an understanding of the internal control that matters to the audit, in order to design suitable procedures, but not to give an opinion on how effective that control is;",
      "evaluate the accounting policies used, the reasonableness of management's estimates and the related disclosures;",
      "conclude on whether management's use of the going-concern basis is appropriate and, from the evidence obtained, whether a material uncertainty exists about the Company's ability to continue as a going concern. If we conclude that one exists, we must draw attention in this report to the related disclosures or, if those are inadequate, modify our opinion;",
      "evaluate the overall presentation, structure and content of the financial statements, including the disclosures, and whether they show the underlying transactions and events fairly.",
    ],
    closing: "We tell those charged with governance about, among other things, the planned scope and timing of the audit and significant findings, including any significant weaknesses in internal control that we identify.",
    disclaimer:
      "Our responsibility is to carry out an audit of the Company's financial statements under International Standards on Auditing and to issue an auditor's report. Because of the matter described in the Basis for disclaimer of opinion section, however, we were not able to obtain enough appropriate audit evidence to provide a basis for an opinion on these financial statements.",
  },
  legal: { heading: "Report on other legal and regulatory requirements", para: "[Complete as required by local law]" },
  signature: ["{firm name}", "{engagement partner}", "{city}", "{report date}"],
} as const;

export interface ReportInput {
  clientName: string;
  /** The financial statements' date, 2025-12-31 or already in words. */
  periodEnd: string;
  framework: string;
  firmName: string;
  partner: string;
  city: string;
  reportDate: string;
  opinion: OpinionKind;
  /** What the matter is and what it affects. Required for any modified opinion; written by the partner. */
  basisForModification?: string;
  /** A material uncertainty about going concern that is adequately disclosed: the note that discloses it. null leaves the section out. */
  goingConcern?: { noteReference?: string } | null;
  emphasisOfMatter?: string;
  otherMatter?: string;
}

const isModified = (k: OpinionKind) => k !== "unmodified";
const given = (s: string | undefined) => !!s && s.trim().length > 0;

/**
 * Invalid combinations, as plain sentences for the partner. Conservative: this draft does not allow a disclaimer to carry a going-concern
 * uncertainty section or an emphasis of matter. Whether the standards would allow them is for the reviewer to decide.
 */
export function reportProblems(input: ReportInput): string[] {
  const problems: string[] = [];
  if (!(OPINION_KINDS as readonly string[]).includes(input.opinion)) problems.push("Choose the kind of opinion: unmodified, qualified, adverse or disclaimer.");
  if (isModified(input.opinion) && OPINION_KINDS.includes(input.opinion) && !given(input.basisForModification)) {
    problems.push(`A ${OPINION_LABEL[input.opinion].toLowerCase()} needs the basis for the modification: say what the matter is and what it affects.`);
  }
  if (input.opinion === "disclaimer" && input.goingConcern) {
    problems.push("This draft does not allow a disclaimer of opinion together with a going-concern material uncertainty section. Take one of them out. The reviewer decides whether the standards allow the combination.");
  }
  if (input.opinion === "disclaimer" && given(input.emphasisOfMatter)) {
    problems.push("This draft does not allow an emphasis of matter on a disclaimer of opinion. Take it out or change the opinion. The reviewer decides whether the standards allow it.");
  }
  if (!given(input.reportDate)) problems.push("Enter the date of the report.");
  return problems;
}

/** The report as blocks, the draft notice first. Missing values stay as [the field name]; problems are reported by reportProblems, not thrown here. */
export function buildReport(input: ReportInput): Block[] {
  const kind: OpinionKind = (OPINION_KINDS as readonly string[]).includes(input.opinion) ? input.opinion : "unmodified";
  const values: Record<string, string | undefined> = {
    "client name": input.clientName,
    "period end": longDate(input.periodEnd),
    framework: input.framework,
    "firm name": input.firmName,
    "engagement partner": input.partner,
    city: input.city,
    "report date": longDate(input.reportDate),
    "basis for modification": input.basisForModification,
    "note reference": input.goingConcern?.noteReference,
    "emphasis of matter text": input.emphasisOfMatter,
    "other matter text": input.otherMatter,
  };
  const f = (t: string) => fill(t, values);
  const para = (text: string): Block => ({ kind: "para", text });
  const R = REPORT;

  const blocks: Block[] = [para(REPORT_NOTICE), { kind: "heading", text: R.title }, para(f(R.addressee))];

  blocks.push({ kind: "heading", text: R.opinion.headings[kind] });
  blocks.push(para(f(kind === "disclaimer" ? R.opinion.engaged : R.opinion.audited)));
  blocks.push(para(f(R.opinion[kind])));

  blocks.push({ kind: "heading", text: R.basis.headings[kind] });
  if (isModified(kind)) blocks.push(para(f(R.basis.modification)));
  if (kind === "disclaimer") {
    blocks.push(para(R.basis.notObtained), para(R.basis.independence));
  } else {
    blocks.push(para(R.basis.standards), para(R.basis.independence), para(R.basis.evidence[kind]));
  }

  if (input.goingConcern) {
    blocks.push({ kind: "heading", text: R.goingConcern.heading }, para(f(R.goingConcern.para)));
  }
  if (given(input.emphasisOfMatter)) {
    blocks.push({ kind: "heading", text: R.emphasis.heading }, para(f(R.emphasis.para)), para(R.emphasis.after));
  }
  if (given(input.otherMatter)) {
    blocks.push({ kind: "heading", text: R.otherMatter.heading }, para(f(R.otherMatter.para)));
  }

  blocks.push({ kind: "heading", text: R.management.heading });
  for (const p of R.management.paras) blocks.push(para(f(p)));

  blocks.push({ kind: "heading", text: R.auditor.heading });
  if (kind === "disclaimer") {
    blocks.push(para(R.auditor.disclaimer));
  } else {
    blocks.push(para(R.auditor.intro), para(R.auditor.listIntro));
    for (const item of R.auditor.list) blocks.push({ kind: "bullet", text: item });
    blocks.push(para(R.auditor.closing));
  }

  blocks.push({ kind: "heading", text: R.legal.heading }, para(R.legal.para));
  blocks.push({ kind: "signature", lines: R.signature.map(f) });
  return blocks;
}
