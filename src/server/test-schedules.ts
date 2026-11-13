import type { Tx } from "./db";
import { audit as log, listAccounts, type Session } from "./repo";
import { assertMayReview, requireAudit } from "./audit";
import { AREA_BY_CODE } from "../domain/audit";
import { canReview } from "../domain/signoff";
import { GROUP_BY_CODE } from "../domain/groups";
import { normaliseTickmarks } from "../domain/tickmarks";
import {
  coverage,
  difference,
  isCreditGroup,
  MAX_SCHEDULE_LINES,
  needsFinishing,
  presentationBalance,
  scheduleTotal,
  THRESHOLD_CODES,
  thresholdAmount,
  thresholdAmounts,
  type Coverage,
  type ThresholdCode,
} from "../domain/test-schedule";
import type { ListingLine } from "../domain/listing-parse";

export interface LineView {
  id: string;
  position: number;
  description: string;
  docRef: string | null;
  amountMinor: number;
  tested: boolean;
  tickmarks: string[];
  workingPaperId: string | null;
  remarks: string | null;
}

export interface ScheduleSummary {
  id: string;
  reference: string;
  title: string;
  groupCode: string | null;
  totalMinor: number;
  balanceMinor: number | null;
  differenceMinor: number | null;
  hasConclusion: boolean;
  reviewed: boolean;
  selfReviewed: boolean;
  /** Still needs a conclusion, a review or an explanation of a difference. */
  toFinish: boolean;
}

export interface ScheduleView {
  id: string;
  engagementId: string;
  areaCode: string;
  areaTitle: string;
  groupCode: string | null;
  groupName: string | null;
  reference: string;
  title: string;
  objective: string | null;
  workDone: string | null;
  conclusion: string | null;
  explanation: string | null;
  threshold: ThresholdCode;
  preparedByName: string | null;
  preparedAt: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  /** The reviewer is the person who recorded the conclusion: only where the firm has no other reviewer. */
  selfReviewed: boolean;
  lines: LineView[];
  totalMinor: number;
  balanceMinor: number | null;
  differenceMinor: number | null;
  materiality: { overallMinor: number; performanceMinor: number } | null;
  thresholdMinor: number;
  thresholds: ReturnType<typeof thresholdAmounts> | null;
  coverage: Coverage;
  /** The engagement is open, the audit is on and the schedule has not been reviewed. */
  editable: boolean;
  reviewed: boolean;
  /** The audit is on for the engagement. */
  auditOn: boolean;
  /** Files uploaded to this engagement that a line can cite as evidence. */
  files: { id: string; fileName: string }[];
}

interface Row {
  id: string;
  engagementId: string;
  areaCode: string;
  groupCode: string | null;
  reference: string;
  title: string;
  objective: string | null;
  workDone: string | null;
  conclusion: string | null;
  explanation: string | null;
  threshold: ThresholdCode;
  preparedBy: string | null;
  reviewedBy: string | null;
}

const COLUMNS = `s.id, s.engagement_id as "engagementId", s.area_code as "areaCode", s.group_code as "groupCode", s.reference, s.title, s.objective,
  s.work_done as "workDone", s.conclusion, s.explanation_of_difference as explanation, s.threshold, s.prepared_by as "preparedBy", s.reviewed_by as "reviewedBy"`;

async function load(tx: Tx, scheduleId: string): Promise<Row> {
  const { rows } = await tx.query<Row>(`select ${COLUMNS} from test_schedules s where s.id::text = $1`, [scheduleId]);
  if (rows.length === 0) throw new Error("Schedule not found.");
  return rows[0];
}

/** Writes need the audit on and the engagement open, and a schedule nobody has reviewed: reviewed work is changed only after the review is withdrawn. */
async function loadForEdit(tx: Tx, scheduleId: string): Promise<Row> {
  const row = await load(tx, scheduleId);
  await requireAudit(tx, row.engagementId);
  if (row.reviewedBy) throw new Error("This schedule has been reviewed. Ask the reviewer to withdraw the review before changing it.");
  return row;
}

const clean = (value: string | null | undefined, max: number, what: string): string | null => {
  const t = (value ?? "").trim();
  if (t.length > max) throw new Error(`${what} is too long.`);
  return t === "" ? null : t;
};

interface LineInput {
  description: string;
  docRef: string | null;
  amountMinor: number;
  tested: boolean;
  tickmarks: string[];
  workingPaperId: string | null;
  remarks: string | null;
}

function checkLine(input: { description: string; docRef?: string | null; amountMinor: number; tested?: boolean; tickmarks?: unknown; workingPaperId?: string | null; remarks?: string | null }, n: number): LineInput {
  const description = (input.description ?? "").trim();
  if (description === "") throw new Error(`Line ${n}: enter a description.`);
  if (description.length > 500) throw new Error(`Line ${n}: the description is too long.`);
  if (!Number.isSafeInteger(input.amountMinor) || Math.abs(input.amountMinor) > 1e13) throw new Error(`Line ${n}: the amount is not valid.`);
  return {
    description,
    docRef: clean(input.docRef, 100, `Line ${n}: the reference`),
    amountMinor: input.amountMinor,
    tested: input.tested === true,
    tickmarks: normaliseTickmarks(input.tickmarks),
    workingPaperId: input.workingPaperId || null,
    remarks: clean(input.remarks, 1000, `Line ${n}: the remarks`),
  };
}

async function requireEvidenceOnEngagement(tx: Tx, engagementId: string, lines: LineInput[]) {
  const ids = [...new Set(lines.map((l) => l.workingPaperId).filter((x): x is string => !!x))];
  if (ids.length === 0) return;
  const found = await tx.query<{ id: string }>("select id::text as id from working_papers where engagement_id = $1 and id::text = any($2::text[])", [engagementId, ids]);
  if (found.rows.length !== ids.length) throw new Error("Evidence must be a file uploaded to this engagement.");
}

async function lineCount(tx: Tx, scheduleId: string): Promise<number> {
  const { rows } = await tx.query<{ n: number }>("select count(*)::int as n from test_schedule_lines where schedule_id::text = $1", [scheduleId]);
  return rows[0].n;
}

async function adjustedAccounts(tx: Tx, engagementId: string) {
  return (await listAccounts(tx, engagementId)).map((a) => ({ ...a, closingMinor: a.closingMinor + a.adjustmentMinor }));
}

function groupFor(areaCode: string, groupCode: string | null): string | null {
  const area = AREA_BY_CODE.get(areaCode);
  if (!area) throw new Error("Choose an audit area.");
  if (groupCode === null || groupCode === "") return null;
  if (!area.groups.includes(groupCode)) throw new Error("That lead sheet is not part of this area.");
  return groupCode;
}

/**
 * Start a schedule on an area. With `fromTrialBalance`, its lines are the trial balance accounts mapped to the chosen
 * lead-sheet group, at their adjusted balances. The reference is the area code and a running number, such as C5-1.
 */
export async function createSchedule(
  tx: Tx,
  s: Session,
  engagementId: string,
  input: { areaCode: string; groupCode: string | null; title: string; objective?: string; fromTrialBalance?: boolean },
): Promise<string> {
  await requireAudit(tx, engagementId);
  const groupCode = groupFor(input.areaCode, input.groupCode);
  const title = clean(input.title, 200, "The title");
  if (!title || title.length < 3) throw new Error("Give the schedule a title.");
  const objective = clean(input.objective, 2000, "The objective");
  if (input.fromTrialBalance && !groupCode) throw new Error("Choose the lead sheet whose accounts the schedule should start from.");

  const next = await tx.query<{ n: number }>("select coalesce(max(seq), 0)::int + 1 as n from test_schedules where engagement_id = $1 and area_code = $2", [engagementId, input.areaCode]);
  const seq = next.rows[0].n;
  const { rows } = await tx.query<{ id: string }>(
    `insert into test_schedules (firm_id, engagement_id, area_code, group_code, seq, reference, title, objective, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
    [s.firmId, engagementId, input.areaCode, groupCode, seq, `${input.areaCode}-${seq}`, title, objective, s.userId],
  );
  const id = rows[0].id;

  let imported = 0;
  if (input.fromTrialBalance && groupCode) {
    const sign = isCreditGroup(groupCode) ? -1 : 1;
    const accounts = (await adjustedAccounts(tx, engagementId)).filter((a) => a.groupCode === groupCode && a.closingMinor !== 0);
    if (accounts.length > MAX_SCHEDULE_LINES) throw new Error(`The lead sheet has more than ${MAX_SCHEDULE_LINES.toLocaleString("en-US")} accounts.`);
    for (const [i, a] of accounts.entries()) {
      await tx.query(
        "insert into test_schedule_lines (firm_id, schedule_id, position, description, doc_ref, amount_minor) values ($1, $2, $3, $4, $5, $6)",
        [s.firmId, id, i + 1, a.name.slice(0, 500), a.code.slice(0, 100), sign * a.closingMinor + 0],
      );
      imported++;
    }
  }
  await log(tx, s, "create", "test_schedule", id, { engagementId, reference: `${input.areaCode}-${seq}`, groupCode, fromTrialBalance: !!input.fromTrialBalance, lines: imported });
  return id;
}

export async function getScheduleEngagement(tx: Tx, scheduleId: string): Promise<{ engagementId: string; areaCode: string } | null> {
  const { rows } = await tx.query<{ engagementId: string; areaCode: string }>('select engagement_id as "engagementId", area_code as "areaCode" from test_schedules where id::text = $1', [scheduleId]);
  return rows[0] ?? null;
}

export async function listSchedules(tx: Tx, engagementId: string, areaCode: string): Promise<ScheduleSummary[]> {
  const { rows } = await tx.query<Row & { total: number; preparedBy: string | null }>(
    `select ${COLUMNS}, coalesce((select sum(l.amount_minor) from test_schedule_lines l where l.schedule_id = s.id), 0)::float8 as total
     from test_schedules s where s.engagement_id = $1 and s.area_code = $2 order by s.seq`,
    [engagementId, areaCode],
  );
  const accounts = rows.some((r) => r.groupCode) ? await adjustedAccounts(tx, engagementId) : [];
  return rows.map((r) => {
    const balanceMinor = r.groupCode ? presentationBalance(accounts, r.groupCode) : null;
    const state = { reference: r.reference, hasConclusion: !!r.conclusion?.trim(), reviewed: !!r.reviewedBy, balanceMinor, totalMinor: r.total, explanation: r.explanation };
    return {
      id: r.id,
      reference: r.reference,
      title: r.title,
      groupCode: r.groupCode,
      totalMinor: r.total,
      balanceMinor,
      differenceMinor: balanceMinor === null ? null : difference(r.total, balanceMinor),
      hasConclusion: state.hasConclusion,
      reviewed: state.reviewed,
      selfReviewed: !!r.reviewedBy && r.reviewedBy === r.preparedBy,
      toFinish: needsFinishing(state),
    };
  });
}

export async function getSchedule(tx: Tx, scheduleId: string): Promise<ScheduleView | null> {
  if (!/^[0-9a-f-]{36}$/i.test(scheduleId)) return null;
  const found = await tx.query<Row>(`select ${COLUMNS} from test_schedules s where s.id = $1`, [scheduleId]);
  const r = found.rows[0];
  if (!r) return null;
  const names = await tx.query<{ prepared: string | null; preparedAt: string | null; reviewer: string | null; reviewedAt: string | null; status: string; on: boolean }>(
    `select p.name as prepared, to_char(s.prepared_at, 'YYYY-MM-DD') as "preparedAt", v.name as reviewer, to_char(s.reviewed_at, 'YYYY-MM-DD') as "reviewedAt",
            e.status, e.audit_enabled as "on"
     from test_schedules s join engagements e on e.id = s.engagement_id
     left join users p on p.id = s.prepared_by left join users v on v.id = s.reviewed_by where s.id = $1`,
    [scheduleId],
  );
  const n = names.rows[0];
  const lines = await tx.query<LineView>(
    `select id, position, description, doc_ref as "docRef", amount_minor::float8 as "amountMinor", tested, tickmarks,
            working_paper_id as "workingPaperId", remarks from test_schedule_lines where schedule_id = $1 order by position, id`,
    [scheduleId],
  );
  const mat = await tx.query<{ overallMinor: number; performanceMinor: number }>(
    `select overall_minor::float8 as "overallMinor", performance_minor::float8 as "performanceMinor" from materiality
     where engagement_id = $1 order by created_at desc, id desc limit 1`,
    [r.engagementId],
  );
  const materiality = mat.rows[0] ?? null;
  const accounts = r.groupCode ? await adjustedAccounts(tx, r.engagementId) : [];
  const totalMinor = scheduleTotal(lines.rows);
  const balanceMinor = r.groupCode ? presentationBalance(accounts, r.groupCode) : null;
  const thresholdMinor = thresholdAmount(materiality, r.threshold);
  const files = await tx.query<{ id: string; fileName: string }>('select id, file_name as "fileName" from working_papers where engagement_id = $1 order by uploaded_at, file_name', [r.engagementId]);
  return {
    id: r.id,
    engagementId: r.engagementId,
    areaCode: r.areaCode,
    areaTitle: AREA_BY_CODE.get(r.areaCode)?.title ?? r.areaCode,
    groupCode: r.groupCode,
    groupName: r.groupCode ? (GROUP_BY_CODE.get(r.groupCode)?.name ?? r.groupCode) : null,
    reference: r.reference,
    title: r.title,
    objective: r.objective,
    workDone: r.workDone,
    conclusion: r.conclusion,
    explanation: r.explanation,
    threshold: r.threshold,
    preparedByName: n.prepared,
    preparedAt: n.preparedAt,
    reviewedByName: n.reviewer,
    reviewedAt: n.reviewedAt,
    selfReviewed: !!r.reviewedBy && r.reviewedBy === r.preparedBy,
    lines: lines.rows,
    totalMinor,
    balanceMinor,
    differenceMinor: balanceMinor === null ? null : difference(totalMinor, balanceMinor),
    materiality,
    thresholdMinor,
    thresholds: materiality ? thresholdAmounts(materiality) : null,
    coverage: coverage(lines.rows, thresholdMinor),
    editable: n.status === "open" && n.on && !r.reviewedBy,
    reviewed: !!r.reviewedBy,
    auditOn: n.on,
    files: files.rows,
  };
}

/** Save the header: title, objective, work done, conclusion, explanation of any difference and the threshold for key items. */
export async function updateHeader(
  tx: Tx,
  s: Session,
  scheduleId: string,
  input: { title: string; objective: string; workDone: string; conclusion: string; explanation: string; threshold: string },
): Promise<string> {
  const row = await loadForEdit(tx, scheduleId);
  const title = clean(input.title, 200, "The title");
  if (!title || title.length < 3) throw new Error("Give the schedule a title.");
  if (!THRESHOLD_CODES.has(input.threshold)) throw new Error("Choose a threshold for key items.");
  const objective = clean(input.objective, 2000, "The objective");
  const workDone = clean(input.workDone, 5000, "Work done");
  const conclusion = clean(input.conclusion, 5000, "The conclusion");
  const explanation = clean(input.explanation, 3000, "The explanation of the difference");
  // Whoever records the conclusion is the preparer a reviewer must differ from. Saving the same conclusion again keeps them.
  const newlyConcluded = conclusion !== null && (conclusion !== row.conclusion || row.preparedBy === null);
  await tx.query(
    `update test_schedules set title = $2, objective = $3, work_done = $4, conclusion = $5, explanation_of_difference = $6, threshold = $7,
            prepared_by = case when $5::text is null then null when $9::boolean then $8::uuid else prepared_by end,
            prepared_at = case when $5::text is null then null when $9::boolean then now() else prepared_at end
     where id = $1`,
    [scheduleId, title, objective, workDone, conclusion, explanation, input.threshold, s.userId, newlyConcluded],
  );
  await log(tx, s, "update", "test_schedule", scheduleId, { engagementId: row.engagementId, reference: row.reference, concluded: conclusion !== null });
  return row.engagementId;
}

/**
 * Save changes to the lines in one go: the rows that changed or are new (an id of null adds a line at the end), and the ids
 * of lines to remove. The whole batch is checked first, so a bad row saves nothing.
 */
export async function saveLines(
  tx: Tx,
  s: Session,
  scheduleId: string,
  input: { rows: { id: string | null; description: string; docRef?: string | null; amountMinor: number; tested?: boolean; tickmarks?: unknown; workingPaperId?: string | null; remarks?: string | null }[]; removeIds?: string[] },
): Promise<{ saved: number; removed: number }> {
  const row = await loadForEdit(tx, scheduleId);
  const checked = input.rows.map((r, i) => ({ id: r.id, line: checkLine(r, i + 1) }));
  await requireEvidenceOnEngagement(tx, row.engagementId, checked.map((c) => c.line));

  const removeIds = [...new Set(input.removeIds ?? [])];
  let removed = 0;
  if (removeIds.length > 0) {
    const gone = await tx.query("delete from test_schedule_lines where schedule_id = $1 and id::text = any($2::text[]) returning id", [scheduleId, removeIds]);
    removed = gone.rows.length;
  }
  let position = (await tx.query<{ p: number }>("select coalesce(max(position), 0)::int as p from test_schedule_lines where schedule_id = $1", [scheduleId])).rows[0].p;
  const adding = checked.filter((c) => c.id === null).length;
  if ((await lineCount(tx, scheduleId)) + adding > MAX_SCHEDULE_LINES) throw new Error(`A schedule holds at most ${MAX_SCHEDULE_LINES.toLocaleString("en-US")} lines.`);
  for (const { id, line } of checked) {
    if (id === null) {
      position++;
      await tx.query(
        `insert into test_schedule_lines (firm_id, schedule_id, position, description, doc_ref, amount_minor, tested, tickmarks, working_paper_id, remarks)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [s.firmId, scheduleId, position, line.description, line.docRef, line.amountMinor, line.tested, line.tickmarks, line.workingPaperId, line.remarks],
      );
    } else {
      const done = await tx.query(
        `update test_schedule_lines set description = $3, doc_ref = $4, amount_minor = $5, tested = $6, tickmarks = $7, working_paper_id = $8, remarks = $9
         where schedule_id = $1 and id::text = $2 returning id`,
        [scheduleId, id, line.description, line.docRef, line.amountMinor, line.tested, line.tickmarks, line.workingPaperId, line.remarks],
      );
      if (done.rows.length === 0) throw new Error("A line you changed is no longer on this schedule. Reload the page.");
    }
  }
  await log(tx, s, "save_lines", "test_schedule", scheduleId, { engagementId: row.engagementId, reference: row.reference, saved: checked.length, removed });
  return { saved: checked.length, removed };
}

/** Add a pasted or uploaded listing to the schedule, after the lines already there, or in place of them. */
export async function importLines(tx: Tx, s: Session, scheduleId: string, lines: ListingLine[], mode: "append" | "replace"): Promise<{ imported: number; replaced: number }> {
  const row = await loadForEdit(tx, scheduleId);
  if (lines.length === 0) throw new Error("There are no lines to import.");
  const checked = lines.map((l, i) => checkLine({ description: l.description, docRef: l.docRef, amountMinor: l.amountMinor }, i + 1));
  const existing = await lineCount(tx, scheduleId);
  if ((mode === "replace" ? 0 : existing) + checked.length > MAX_SCHEDULE_LINES) throw new Error(`A schedule holds at most ${MAX_SCHEDULE_LINES.toLocaleString("en-US")} lines.`);
  let replaced = 0;
  if (mode === "replace") {
    replaced = (await tx.query("delete from test_schedule_lines where schedule_id = $1 returning id", [scheduleId])).rows.length;
  }
  let position = mode === "replace" ? 0 : (await tx.query<{ p: number }>("select coalesce(max(position), 0)::int as p from test_schedule_lines where schedule_id = $1", [scheduleId])).rows[0].p;
  for (const l of checked) {
    position++;
    await tx.query("insert into test_schedule_lines (firm_id, schedule_id, position, description, doc_ref, amount_minor) values ($1, $2, $3, $4, $5, $6)", [s.firmId, scheduleId, position, l.description, l.docRef, l.amountMinor]);
  }
  await log(tx, s, "import_lines", "test_schedule", scheduleId, { engagementId: row.engagementId, reference: row.reference, imported: checked.length, replaced, mode });
  return { imported: checked.length, replaced };
}

/** Sign off a schedule that has a conclusion. The shared review rule applies: a different person unless the firm has no other reviewer. */
export async function reviewSchedule(tx: Tx, s: Session, scheduleId: string): Promise<string> {
  const row = await load(tx, scheduleId);
  await requireAudit(tx, row.engagementId);
  const { selfReview } = await assertMayReview(tx, s, row.preparedBy);
  if (!row.conclusion?.trim() || !row.preparedBy) throw new Error("Record the conclusion before the schedule is reviewed.");
  if (row.reviewedBy) throw new Error("This schedule has already been reviewed.");
  await tx.query("update test_schedules set reviewed_by = $2, reviewed_at = now() where id = $1", [scheduleId, s.userId]);
  await log(tx, s, "schedule_review", "test_schedule", scheduleId, { engagementId: row.engagementId, reference: row.reference, selfReview });
  return row.engagementId;
}

/** Withdraw a review so the schedule can be changed. Any reviewer or partner may. */
export async function unreviewSchedule(tx: Tx, s: Session, scheduleId: string): Promise<string> {
  const row = await load(tx, scheduleId);
  await requireAudit(tx, row.engagementId);
  if (!canReview(s.role)) throw new Error("Only a reviewer or partner can withdraw a review.");
  if (!row.reviewedBy) throw new Error("This schedule has not been reviewed.");
  await tx.query("update test_schedules set reviewed_by = null, reviewed_at = null where id = $1", [scheduleId]);
  await log(tx, s, "schedule_unreview", "test_schedule", scheduleId, { engagementId: row.engagementId, reference: row.reference, reviewedBy: row.reviewedBy });
  return row.engagementId;
}

/** Delete a schedule that has not been reviewed, with its lines. The reference is not reused. */
export async function deleteSchedule(tx: Tx, s: Session, scheduleId: string): Promise<{ engagementId: string; areaCode: string }> {
  const row = await loadForEdit(tx, scheduleId);
  const lines = await lineCount(tx, scheduleId);
  await tx.query("delete from test_schedules where id = $1", [scheduleId]);
  await log(tx, s, "delete", "test_schedule", scheduleId, { engagementId: row.engagementId, reference: row.reference, lines });
  return { engagementId: row.engagementId, areaCode: row.areaCode };
}
