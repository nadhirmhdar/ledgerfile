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

const SCOPE = "They consist of the statement of financial position at {period end}, the statements of comprehensive income, changes in equity and cash flows for the year then ended, and the notes with the accounting policies.";

export const REPORT = {
  title: "Independent auditor's report",
  addressee: "To the shareholders of {client name}",
  opinion: {
    headings: { unmodified: "Opinion", qualified: "Qualified opinion", adverse: "Adverse opinion", disclaimer: "Disclaimer of opinion" },
    audited: "We audited the financial statements of {client name}. " + SCOPE,
    engaged: "We were engaged to audit the financial statements of {client name}. " + SCOPE,
    unmodified: "In our opinion the financial statements present fairly, in all material respects, the financial position of {client name} at {period end} and its financial performance and cash flows for the year then ended, in accordance with {framework}.",
    qualified:
      "In our opinion, except for the effects of the matter described in the Basis for qualified opinion section, the financial statements present fairly, in all material respects, the financial position of {client name} at {period end} and its financial performance and cash flows for the year then ended, in accordance with {framework}.",
    adverse:
      "In our opinion the financial statements do not present fairly the financial position of {client name} at {period end}, or its financial performance and cash flows for the year then ended, in accordance with {framework}. The reason is the matter described in the Basis for adverse opinion section, which is of great significance to the statements.",
    disclaimer:
      "We do not express an opinion on the financial statements. The matter described in the Basis for disclaimer of opinion section is so significant that we could not gather enough appropriate audit evidence to base an opinion on.",
  },
  basis: {
    headings: { unmodified: "Basis for opinion", qualified: "Basis for qualified opinion", adverse: "Basis for adverse opinion", disclaimer: "Basis for disclaimer of opinion" },
    modification: "{basis for modification}",
    standards: "We carried out this audit under the International Standards on Auditing (ISA 700 and the related standards). The Auditor's responsibilities section of this report explains what those standards ask of us.",
    independence: "The firm is independent of the Company under the ethical rules that apply to this audit, and we have kept to the other ethical duties those rules place on us.",
    evidence: {
      unmodified: "In our judgement the evidence we gathered is sufficient and appropriate as a basis for our opinion.",
      qualified: "In our judgement the evidence we gathered is sufficient and appropriate as a basis for our qualified opinion.",
      adverse: "In our judgement the evidence we gathered is sufficient and appropriate as a basis for our adverse opinion.",
    },
    notObtained: "For the reason given above we could not gather enough appropriate audit evidence to form an opinion.",
  },
  goingConcern: {
    heading: "Material uncertainty related to going concern",
    para: "Note {note reference} to the financial statements describes a material uncertainty about whether the Company can continue as a going concern. This matter does not change our opinion.",
  },
  emphasis: { heading: "Emphasis of matter", para: "{emphasis of matter text}", after: "This matter does not change our opinion." },
  otherMatter: { heading: "Other matter", para: "{other matter text}" },
  management: {
    heading: "Responsibilities of management and those charged with governance",
    intro: "Management of the Company is responsible for:",
    list: [
      "preparing financial statements that present fairly, in all material respects, in accordance with {framework};",
      "the internal control it judges necessary so that the statements can be prepared without material misstatement, whether from fraud or error;",
      "assessing whether the Company can continue as a going concern, and disclosing the going concern matters that call for it.",
    ],
    goingConcernBasis: "Management prepares the statements on the going concern basis. It departs from that basis only if it plans to wind the Company up or to stop trading, or has no real alternative.",
    governance: "Overseeing how the Company reports its financial results is the responsibility of those charged with governance.",
  },
  auditor: {
    heading: "Auditor's responsibilities",
    intro: "Our job is to form an opinion on these financial statements and to report it. To do that we seek reasonable assurance that they contain no material misstatement, whether from fraud or error.",
    assurance: "Reasonable assurance is a high degree of comfort but not a promise: an audit that is properly carried out can still miss a material misstatement. We treat a misstatement as material when it is large enough to change what a reader of the statements would decide.",
    listIntro: "Throughout the audit we exercised professional judgement and kept a questioning mind. In particular:",
    list: [
      "we assessed where the statements might be materially misstated through fraud or error, then chose and carried out procedures aimed at those risks;",
      "we learned enough about the Company's internal control to choose suitable procedures, and we did not examine that control in order to give an opinion on it;",
      "we examined the accounting policies, management's estimates and the matching disclosures, and judged whether they are reasonable;",
      "we considered whether management is right to use the going concern basis, and whether the evidence shows a material uncertainty about going concern. Where we find one, this report must point to the disclosure of it or, if that disclosure falls short, our opinion must be modified;",
      "we looked at the statements as a whole, including the disclosures, and asked whether they show the underlying transactions and events fairly.",
    ],
    closing: "We also report to those charged with governance on the scope and timing we planned and on our significant findings, including any significant weaknesses in internal control that we found.",
    disclaimer:
      "We were engaged to audit under the International Standards on Auditing and to report on the result. For the reason given in the Basis for disclaimer of opinion section we could not gather enough appropriate audit evidence, so we cannot give an opinion on these financial statements.",
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
  blocks.push(para(R.management.intro));
  for (const item of R.management.list) blocks.push({ kind: "bullet", text: f(item) });
  blocks.push(para(R.management.goingConcernBasis), para(R.management.governance));

  blocks.push({ kind: "heading", text: R.auditor.heading });
  if (kind === "disclaimer") {
    blocks.push(para(R.auditor.disclaimer));
  } else {
    blocks.push(para(R.auditor.intro), para(R.auditor.assurance), para(R.auditor.listIntro));
    for (const item of R.auditor.list) blocks.push({ kind: "bullet", text: item });
    blocks.push(para(R.auditor.closing));
  }

  blocks.push({ kind: "heading", text: R.legal.heading }, para(R.legal.para));
  blocks.push({ kind: "signature", lines: R.signature.map(f) });
  return blocks;
}
