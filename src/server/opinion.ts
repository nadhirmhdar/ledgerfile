import type { Tx } from "./db";
import { audit as log, type Session } from "./repo";
import { getAuditOverview, requireAudit } from "./audit";
import { canLock } from "../domain/signoff";
import { formatAmount } from "../domain/money";
import { OPINION_KINDS, reportProblems, type OpinionKind, type ReportInput } from "../domain/report";

/**
 * The partner's decision on the audit opinion: one row per engagement. It records the decision only; the words of the report come from
 * the draft wording (src/domain/report.ts, an unreviewed draft). Every call runs in withFirm, so row-level security keeps firms apart.
 */

export interface AuditOpinion {
  opinion: OpinionKind;
  basisForModification: string | null;
  /** The note that discloses a material uncertainty about going concern; null means no such section. */
  goingConcernNote: string | null;
  emphasisOfMatter: string | null;
  otherMatter: string | null;
  reportDate: string | null;
  decidedBy: string;
  decidedByName: string;
  decidedAt: string;
}

export interface OpinionInput {
  opinion: string;
  basisForModification: string;
  /** The partner ticked "there is a material uncertainty about going concern". */
  goingConcern: boolean;
  goingConcernNote: string;
  emphasisOfMatter: string;
  otherMatter: string;
  /** 2026-03-15, or empty. */
  reportDate: string;
}

export const PARTNER_ONLY = "Only a partner can record the audit opinion.";

export async function getOpinion(tx: Tx, engagementId: string): Promise<AuditOpinion | null> {
  const { rows } = await tx.query<AuditOpinion>(
    `select o.opinion, o.basis_for_modification as "basisForModification", o.going_concern_note as "goingConcernNote",
            o.emphasis_of_matter as "emphasisOfMatter", o.other_matter as "otherMatter", to_char(o.report_date, 'YYYY-MM-DD') as "reportDate",
            o.decided_by as "decidedBy", u.name as "decidedByName", to_char(o.decided_at, 'YYYY-MM-DD') as "decidedAt"
     from audit_opinions o join users u on u.id = o.decided_by where o.engagement_id = $1`,
    [engagementId],
  );
  return rows[0] ?? null;
}

const text = (s: string) => {
  const t = s.trim();
  return t === "" ? null : t;
};

const realDate = (value: string): boolean => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
};

/** The checks that need no database: the draft wording's own rules, a note reference when a going-concern section is asked for, and a real date. */
export function opinionInputProblems(input: OpinionInput): string[] {
  const note = text(input.goingConcernNote);
  const forReport: ReportInput = {
    clientName: "",
    periodEnd: "",
    framework: "",
    firmName: "",
    partner: "",
    city: "",
    reportDate: input.reportDate,
    opinion: input.opinion as OpinionKind,
    basisForModification: input.basisForModification,
    goingConcern: input.goingConcern ? { noteReference: note ?? undefined } : null,
    emphasisOfMatter: input.emphasisOfMatter,
    otherMatter: input.otherMatter,
  };
  const problems = reportProblems(forReport);
  if (input.goingConcern && !note) problems.push("Give the note where the going-concern uncertainty is disclosed.");
  if (input.reportDate.trim() !== "" && !realDate(input.reportDate.trim())) problems.push("Enter the report date as a real date.");
  for (const [label, value] of [
    ["basis for the modification", input.basisForModification],
    ["emphasis of matter", input.emphasisOfMatter],
    ["other matter", input.otherMatter],
  ] as const) {
    if (value.trim().length > 4000) problems.push(`The ${label} is too long.`);
  }
  if (note && note.length > 100) problems.push("The note reference is too long.");
  return problems;
}

/** Record or change the opinion. Partner (or admin) only, on an open engagement with the audit on. */
export async function recordOpinion(tx: Tx, s: Session, engagementId: string, input: OpinionInput): Promise<void> {
  await requireAudit(tx, engagementId);
  if (!canLock(s.role)) throw new Error(PARTNER_ONLY);
  if (!(OPINION_KINDS as readonly string[]).includes(input.opinion)) throw new Error("Choose the kind of opinion.");
  const problems = opinionInputProblems(input);
  if (problems.length > 0) throw new Error(problems.join(" "));
  const kind = input.opinion as OpinionKind;

  // An unmodified opinion cannot stand while the uncorrected misstatements reach materiality (the same test as the lock check).
  const overview = (await getAuditOverview(tx, engagementId))!;
  if (kind === "unmodified" && overview.misstatements.exceedsMateriality) {
    throw new Error(
      `The uncorrected misstatements reach overall materiality${overview.materiality ? ` of ${formatAmount(overview.materiality.overallMinor)}` : ""}, so an unmodified opinion cannot be recorded. Correct them, or record a modified opinion with its basis.`,
    );
  }

  const modified = kind !== "unmodified";
  const gc = kind !== "disclaimer" && input.goingConcern ? text(input.goingConcernNote) : null;
  const emphasis = kind === "disclaimer" ? null : text(input.emphasisOfMatter);
  const values = [engagementId, s.firmId, kind, modified ? text(input.basisForModification) : null, gc, emphasis, text(input.otherMatter), text(input.reportDate), s.userId];
  const before = await tx.query<{ opinion: string }>("select opinion from audit_opinions where engagement_id = $1", [engagementId]);
  await tx.query(
    `insert into audit_opinions (engagement_id, firm_id, opinion, basis_for_modification, going_concern_note, emphasis_of_matter, other_matter, report_date, decided_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8::date, $9)
     on conflict (engagement_id) do update set opinion = excluded.opinion, basis_for_modification = excluded.basis_for_modification,
       going_concern_note = excluded.going_concern_note, emphasis_of_matter = excluded.emphasis_of_matter, other_matter = excluded.other_matter,
       report_date = excluded.report_date, decided_by = excluded.decided_by, decided_at = clock_timestamp()`,
    values,
  );
  await log(tx, s, "record_opinion", "engagement", engagementId, {
    opinion: kind,
    previousOpinion: before.rows[0]?.opinion ?? null,
    goingConcernSection: gc !== null,
    emphasisOfMatter: emphasis !== null,
    otherMatter: text(input.otherMatter) !== null,
    reportDate: text(input.reportDate),
  });
}

/** Withdraw the recorded opinion. Partner (or admin) only, on an open engagement with the audit on. */
export async function clearOpinion(tx: Tx, s: Session, engagementId: string): Promise<void> {
  await requireAudit(tx, engagementId);
  if (!canLock(s.role)) throw new Error(PARTNER_ONLY);
  const had = await tx.query<{ opinion: string }>("delete from audit_opinions where engagement_id = $1 returning opinion", [engagementId]);
  if (had.rows.length === 0) throw new Error("No opinion is recorded.");
  await log(tx, s, "clear_opinion", "engagement", engagementId, { opinion: had.rows[0].opinion });
}

export interface OpinionPage {
  enabled: boolean;
  opinion: AuditOpinion | null;
  overallMinor: number | null;
  uncorrectedNetMinor: number;
  uncorrectedCount: number;
  exceedsMateriality: boolean;
  /** The lock blockers that are about the opinion or the misstatements it depends on. */
  blockers: string[];
}

export async function getOpinionPage(tx: Tx, engagementId: string): Promise<OpinionPage | null> {
  const overview = await getAuditOverview(tx, engagementId);
  if (!overview) return null;
  return {
    enabled: overview.enabled,
    opinion: await getOpinion(tx, engagementId),
    overallMinor: overview.materiality?.overallMinor ?? null,
    uncorrectedNetMinor: overview.misstatements.uncorrectedNetMinor,
    uncorrectedCount: overview.misstatements.items.filter((m) => !m.corrected).length,
    exceedsMateriality: overview.misstatements.exceedsMateriality,
    blockers: overview.blockers.filter(isOpinionBlocker),
  };
}

/** A lock blocker that the opinion page speaks to. */
export const isOpinionBlocker = (blocker: string): boolean => /audit opinion|uncorrected misstatements|date of the auditor's report/.test(blocker);
