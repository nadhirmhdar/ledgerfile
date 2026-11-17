import type { Tx } from "./db";
import * as repo from "./repo";
import { getLetterContext } from "./letters";
import { getOpinion, type AuditOpinion } from "./opinion";
import { plainName } from "./http";
import { buildReport, reportProblems, type ReportInput } from "../domain/report";
import type { Block } from "../domain/letters";

/**
 * The auditor's report as a Word document, generated from the partner's recorded decision (audit_opinions). It is the unreviewed draft
 * wording in src/domain/report.ts; REPORT_NOTICE is the first paragraph. The engagement partner's name and the city come from a small
 * form and are used for the download only, as with the letters; nothing typed there is saved.
 */

export interface ReportForm {
  partner?: string;
  city?: string;
}

export interface ReportFacts {
  clientName: string;
  periodEnd: string;
  framework: string;
  firmName: string;
}

const MAX_FIELD = 200;
const clean = (v: string | undefined) => v?.replace(/\s+/g, " ").trim().slice(0, MAX_FIELD) ?? "";

export type Assembled = { ok: true; input: ReportInput } | { ok: false; message: string };

/**
 * The report's input from the engagement, the recorded opinion and the form. Pure. The partner defaults to whoever recorded the opinion;
 * a blank city is left as [city] in the report. Refused with a plain message when no opinion is recorded, or when the assembled input has
 * problems (which a stored row should never cause).
 */
export function assembleReportInput(facts: ReportFacts, opinion: AuditOpinion | null, form: ReportForm): Assembled {
  if (!opinion) return { ok: false, message: "No audit opinion is recorded yet. The report can be downloaded once the partner records the opinion." };
  const input: ReportInput = {
    clientName: facts.clientName,
    periodEnd: facts.periodEnd,
    framework: facts.framework,
    firmName: facts.firmName,
    partner: clean(form.partner) || opinion.decidedByName,
    city: clean(form.city),
    reportDate: opinion.reportDate ?? "",
    opinion: opinion.opinion,
    basisForModification: opinion.basisForModification ?? undefined,
    goingConcern: opinion.goingConcernNote ? { noteReference: opinion.goingConcernNote } : null,
    emphasisOfMatter: opinion.emphasisOfMatter ?? undefined,
    otherMatter: opinion.otherMatter ?? undefined,
  };
  const problems = reportProblems(input);
  if (problems.length > 0) return { ok: false, message: `The recorded opinion cannot be turned into a report yet. ${problems.join(" ")}` };
  return { ok: true, input };
}

/** The download's file name: plain characters only. */
export type ReportFormat = "docx" | "pdf";
export const reportFileName = (clientName: string, periodEnd: string, format: ReportFormat = "docx"): string => `Auditors-report-${plainName(clientName)}-${periodEnd}-draft.${format}`;

export type GeneratedReport = { kind: "ok"; title: string; /** The client and period, for the page header of the PDF. */ header: string; fileName: string; blocks: Block[] } | { kind: "not_found" } | { kind: "refused"; message: string };

/** Build the report for an engagement and record the download. Not found for another firm's engagement or one that is not being audited. */
export async function generateReport(tx: Tx, s: repo.Session, engagementId: string, form: ReportForm, format: ReportFormat = "docx"): Promise<GeneratedReport> {
  const context = await getLetterContext(tx, engagementId);
  if (!context) return { kind: "not_found" };
  const opinion = await getOpinion(tx, engagementId);
  const assembled = assembleReportInput(context, opinion, form);
  if (!assembled.ok) return { kind: "refused", message: assembled.message };
  await repo.audit(tx, s, "download_report", "engagement", engagementId, { opinion: assembled.input.opinion, format });
  return {
    kind: "ok",
    title: `${context.clientName} auditor's report ${context.periodEnd} (draft)`,
    header: `${context.clientName}, independent auditor's report, period ended ${context.periodEnd}`,
    fileName: reportFileName(context.clientName, context.periodEnd, format),
    blocks: buildReport(assembled.input),
  };
}
