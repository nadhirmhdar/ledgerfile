import type { Tx } from "./db";
import { audit as log, type Session } from "./repo";
import { AREAS, AREA_BY_CODE, assertionsOf, type Area, type Assertion, type ProcedureTemplate, type Tier } from "../domain/audit";
import { applyFirmChanges, changesWording, checkOwnProcedure, checkWording, isProtected, MAX_OWN_PER_AREA, nextOwnSeq, ownId, stateOf, type FirmChange, type FirmOwnProcedure, type OwnInput, type ProcedureState, type WordingInput } from "../domain/firm-methodology";
import { canLock } from "../domain/signoff";

/**
 * A firm's changes to the methodology library's procedures (edit the wording, hide, show, reset to the library). Partner-level only, the same rule as
 * locking (the firm administrator counts as partner-level), and the role is re-read from the database. Every change is kept in firm_procedure_history,
 * before and after, and written to the audit log.
 *
 * Changes apply to procedures loaded from now on. A procedure already on an engagement keeps the wording it was loaded with.
 */

export const NOT_PARTNER = "Only a partner can change the firm's methodology.";

const LIBRARY = new Map(AREAS.flatMap((a) => a.procedures.map((p) => [p.id, { area: a, procedure: p }] as const)));

interface Row {
  templateId: string;
  body: string | null;
  evidence: string | null;
  reference: string | null;
  hidden: boolean;
}

async function rows(tx: Tx): Promise<Row[]> {
  return (await tx.query<Row>('select template_id as "templateId", body, evidence, reference, hidden from firm_procedures')).rows;
}

/** The firm's changes, for the signed-in firm (row-level security). */
export async function loadFirmChanges(tx: Tx): Promise<FirmChange[]> {
  return (await rows(tx)).map((r) => ({ templateId: r.templateId, body: r.body, evidence: r.evidence, reference: r.reference, hidden: r.hidden }));
}

interface OwnRow {
  areaCode: string;
  seq: number;
  tier: Tier;
  assertions: string[];
  body: string;
  evidence: string;
  reference: string;
  retired: boolean;
}

const OWN_COLUMNS = 'area_code as "areaCode", seq, tier, assertions, body, evidence, reference, retired';

/** The firm's own procedures, retired ones too, for the signed-in firm (row-level security). */
export async function loadOwnProcedures(tx: Tx): Promise<FirmOwnProcedure[]> {
  const { rows } = await tx.query<OwnRow>(`select ${OWN_COLUMNS} from firm_own_procedures order by area_code, seq`);
  return rows.map((r) => ({ ...r, assertions: r.assertions as Assertion[] }));
}

/** The areas as this firm has them: the library with its changes applied and its own procedures added. What new programmes are loaded from. */
export async function getFirmAreas(tx: Tx): Promise<Area[]> {
  return applyFirmChanges(AREAS, await loadFirmChanges(tx), await loadOwnProcedures(tx));
}

export interface MethodologyProcedure {
  id: string;
  tier: ProcedureTemplate["tier"];
  assertions: string[];
  library: { text: string; evidence: string; reference: string };
  current: { text: string; evidence: string; reference: string };
  state: ProcedureState;
  /** A core procedure of an area with a fixed risk: its wording can be edited but it cannot be hidden. */
  protected: boolean;
}
export interface OwnProcedureView {
  id: string;
  seq: number;
  tier: Tier;
  assertions: string[];
  body: string;
  evidence: string;
  reference: string;
  retired: boolean;
}
export interface MethodologyArea {
  code: string;
  title: string;
  procedures: MethodologyProcedure[];
  /** The assertions the library's area covers: the only ones an own procedure may address. */
  assertionChoices: string[];
  /** The firm's own procedures for the area, retired ones too. */
  own: OwnProcedureView[];
  /** Whether another can be added (retired ones count toward the limit). */
  canAdd: boolean;
}

/** Every area and procedure with the library's wording, the firm's current wording and the state, for the methodology page. */
export async function listFirmMethodology(tx: Tx): Promise<MethodologyArea[]> {
  const changes = new Map((await loadFirmChanges(tx)).map((c) => [c.templateId, c]));
  const own = await loadOwnProcedures(tx);
  return AREAS.map((a) => ({
    code: a.code,
    title: a.title,
    assertionChoices: assertionsOf(a),
    own: own.filter((o) => o.areaCode === a.code).map((o) => ({ id: ownId(o.areaCode, o.seq), seq: o.seq, tier: o.tier, assertions: o.assertions, body: o.body, evidence: o.evidence, reference: o.reference, retired: o.retired })),
    canAdd: nextOwnSeq(own.filter((o) => o.areaCode === a.code).map((o) => o.seq)) !== null,
    procedures: a.procedures.map((p) => {
      const c = changes.get(p.id);
      return {
        id: p.id,
        tier: p.tier,
        assertions: p.assertions,
        library: { text: p.text, evidence: p.evidence, reference: p.reference },
        current: { text: c?.body ?? p.text, evidence: c?.evidence ?? p.evidence, reference: c?.reference ?? p.reference },
        state: stateOf(c),
        protected: isProtected(a, p),
      };
    }),
  }));
}

/** Partner-level only, from the role as the database has it now. */
async function requirePartner(tx: Tx, s: Session): Promise<void> {
  const { rows: found } = await tx.query<{ role: string }>("select role from users where id = $1", [s.userId]);
  if (!canLock((found[0]?.role ?? s.role) as Session["role"])) throw new Error(NOT_PARTNER);
}

function library(templateId: string) {
  const entry = LIBRARY.get(templateId);
  if (!entry) throw new Error("That procedure is not in the library.");
  return entry;
}

const snapshot = (r: Row | undefined) => (r ? { body: r.body, evidence: r.evidence, reference: r.reference, hidden: r.hidden } : null);

async function current(tx: Tx, templateId: string): Promise<Row | undefined> {
  const found = await tx.query<Row>('select template_id as "templateId", body, evidence, reference, hidden from firm_procedures where template_id = $1', [templateId]);
  return found.rows[0];
}

/** Save the change as one row, or remove the row when nothing differs from the library any more. Records the history and the audit entry. */
async function save(tx: Tx, s: Session, templateId: string, action: "edit" | "hide" | "show" | "reset", before: Row | undefined, next: Omit<Row, "templateId"> | null): Promise<void> {
  const keep = next && (changesWording(next) || next.hidden);
  if (keep) {
    await tx.query(
      `insert into firm_procedures (firm_id, template_id, body, evidence, reference, hidden, updated_by, updated_at) values ($1, $2, $3, $4, $5, $6, $7, clock_timestamp())
       on conflict (firm_id, template_id) do update set body = excluded.body, evidence = excluded.evidence, reference = excluded.reference, hidden = excluded.hidden,
         updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      [s.firmId, templateId, next.body, next.evidence, next.reference, next.hidden, s.userId],
    );
  } else {
    await tx.query("delete from firm_procedures where template_id = $1", [templateId]);
  }
  const after = keep ? { body: next.body, evidence: next.evidence, reference: next.reference, hidden: next.hidden } : null;
  await tx.query("insert into firm_procedure_history (firm_id, template_id, action, before_values, after_values, changed_by) values ($1, $2, $3, $4, $5, $6)", [
    s.firmId,
    templateId,
    action,
    JSON.stringify(snapshot(before)),
    JSON.stringify(after),
    s.userId,
  ]);
  await log(tx, s, `${action}_procedure_wording`, "methodology", null, { templateId, before: snapshot(before), after });
}

/** The firm's own wording for a library procedure. A field the same as the library's stays the library's. */
export async function editProcedure(tx: Tx, s: Session, templateId: string, input: WordingInput): Promise<void> {
  await requirePartner(tx, s);
  const { procedure } = library(templateId);
  const checked = checkWording(input, procedure);
  if (!checked.ok) throw new Error(checked.message);
  const before = await current(tx, templateId);
  await save(tx, s, templateId, "edit", before, { ...checked.value, hidden: before?.hidden ?? false });
}

/** Leave a procedure out of programmes loaded from now on. Not for a protected procedure. */
export async function hideProcedure(tx: Tx, s: Session, templateId: string): Promise<void> {
  await requirePartner(tx, s);
  const { area, procedure } = library(templateId);
  if (isProtected(area, procedure)) throw new Error("This procedure is part of the response to the risk of management override, which is a significant risk on every audit. It can be reworded but not hidden.");
  const before = await current(tx, templateId);
  if (before?.hidden) throw new Error("This procedure is already hidden.");
  await save(tx, s, templateId, "hide", before, { body: before?.body ?? null, evidence: before?.evidence ?? null, reference: before?.reference ?? null, hidden: true });
}

/** Load a hidden procedure into programmes again. */
export async function showProcedure(tx: Tx, s: Session, templateId: string): Promise<void> {
  await requirePartner(tx, s);
  library(templateId);
  const before = await current(tx, templateId);
  if (!before?.hidden) throw new Error("This procedure is not hidden.");
  await save(tx, s, templateId, "show", before, { body: before.body, evidence: before.evidence, reference: before.reference, hidden: false });
}

/** Back to the library's wording, and back in programmes if it was hidden. */
export async function resetProcedure(tx: Tx, s: Session, templateId: string): Promise<void> {
  await requirePartner(tx, s);
  library(templateId);
  const before = await current(tx, templateId);
  if (!before) throw new Error("This procedure already has the library wording.");
  await save(tx, s, templateId, "reset", before, null);
}

// --- The firm's own procedures ------------------------------------------------------------------------------------------------------------
// Added to an area after the library's, loaded into programmes from now on like any other. Retired, never deleted: retiring leaves a procedure out of
// programmes loaded from now on, and the wording already on engagements stays. Partner-level only, like the rest, with the role read from the database.

const ownSnapshot = (r: OwnRow | undefined) => (r ? { tier: r.tier, assertions: r.assertions, body: r.body, evidence: r.evidence, reference: r.reference, retired: r.retired } : null);

async function ownRows(tx: Tx, areaCode: string): Promise<OwnRow[]> {
  return (await tx.query<OwnRow>(`select ${OWN_COLUMNS} from firm_own_procedures where area_code = $1 order by seq`, [areaCode])).rows;
}

async function recordOwn(tx: Tx, s: Session, templateId: string, action: "add" | "edit" | "retire" | "restore", before: OwnRow | undefined, after: OwnRow): Promise<void> {
  await tx.query("insert into firm_own_procedure_history (firm_id, template_id, action, before_values, after_values, changed_by) values ($1, $2, $3, $4, $5, $6)", [
    s.firmId,
    templateId,
    action,
    JSON.stringify(ownSnapshot(before)),
    JSON.stringify(ownSnapshot(after)),
    s.userId,
  ]);
  await log(tx, s, `${action}_own_procedure`, "methodology", null, { templateId, before: ownSnapshot(before), after: ownSnapshot(after) });
}

/** The id of an own procedure, split into its area and sequence number. Anything else is refused. */
function parseOwnId(templateId: string): { areaCode: string; seq: number } {
  const m = /^(C[0-9]{1,2})\.F([0-9]{2})$/.exec(templateId);
  const seq = m ? Number(m[2]) : 0;
  if (!m || !AREA_BY_CODE.has(m[1]) || seq < 1 || seq > MAX_OWN_PER_AREA) throw new Error("That procedure was not added by your firm.");
  return { areaCode: m[1], seq };
}

/** Write a new procedure for an area. Returns its id, for example C1.F01. */
export async function addProcedure(tx: Tx, s: Session, areaCode: string, input: OwnInput): Promise<string> {
  await requirePartner(tx, s);
  const area = AREA_BY_CODE.get(areaCode);
  if (!area) throw new Error("Unknown audit area.");
  // Only the assertions the LIBRARY's area covers, so the area's risk assessment still asks for exactly the same ones.
  const checked = checkOwnProcedure(input, assertionsOf(area));
  if (!checked.ok) throw new Error(checked.message);
  // One add at a time for this firm and area: a second waits here until the first has committed, then reads the number it took and takes the next.
  await tx.query("select pg_advisory_xact_lock(hashtext($1))", [`own-procedures:${s.firmId}:${areaCode}`]);
  const seq = nextOwnSeq((await ownRows(tx, areaCode)).map((r) => r.seq));
  if (seq === null) throw new Error(`An area can have at most ${MAX_OWN_PER_AREA} procedures added by your firm, retired ones included.`);
  const v = checked.value;
  await tx.query(
    "insert into firm_own_procedures (firm_id, area_code, seq, tier, assertions, body, evidence, reference, created_by, updated_by) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)",
    [s.firmId, areaCode, seq, v.tier, v.assertions, v.body, v.evidence, v.reference, s.userId],
  );
  const id = ownId(areaCode, seq);
  await recordOwn(tx, s, id, "add", undefined, { areaCode, seq, ...v, retired: false });
  return id;
}

async function currentOwn(tx: Tx, templateId: string): Promise<{ row: OwnRow; areaCode: string; seq: number }> {
  const { areaCode, seq } = parseOwnId(templateId);
  const row = (await ownRows(tx, areaCode)).find((r) => r.seq === seq);
  if (!row) throw new Error("That procedure was not added by your firm.");
  return { row, areaCode, seq };
}

/** Change an own procedure's wording, tier and assertions. A retired one has to be restored first. */
export async function editOwnProcedure(tx: Tx, s: Session, templateId: string, input: OwnInput): Promise<void> {
  await requirePartner(tx, s);
  const { row, areaCode, seq } = await currentOwn(tx, templateId);
  if (row.retired) throw new Error("This procedure is retired. Restore it before changing it.");
  const checked = checkOwnProcedure(input, assertionsOf(AREA_BY_CODE.get(areaCode)!));
  if (!checked.ok) throw new Error(checked.message);
  const v = checked.value;
  await tx.query("update firm_own_procedures set tier = $4, assertions = $5, body = $6, evidence = $7, reference = $8, updated_by = $9, updated_at = clock_timestamp() where firm_id = $1 and area_code = $2 and seq = $3", [
    s.firmId,
    areaCode,
    seq,
    v.tier,
    v.assertions,
    v.body,
    v.evidence,
    v.reference,
    s.userId,
  ]);
  await recordOwn(tx, s, templateId, "edit", row, { areaCode, seq, ...v, retired: false });
}

async function setRetired(tx: Tx, s: Session, templateId: string, retired: boolean): Promise<void> {
  await requirePartner(tx, s);
  const { row, areaCode, seq } = await currentOwn(tx, templateId);
  if (row.retired === retired) throw new Error(retired ? "This procedure is already retired." : "This procedure is not retired.");
  await tx.query("update firm_own_procedures set retired = $4, updated_by = $5, updated_at = clock_timestamp() where firm_id = $1 and area_code = $2 and seq = $3", [s.firmId, areaCode, seq, retired, s.userId]);
  await recordOwn(tx, s, templateId, retired ? "retire" : "restore", row, { ...row, retired });
}

/** Leave an own procedure out of programmes loaded from now on. It is kept, and can be restored. */
export const retireOwnProcedure = (tx: Tx, s: Session, templateId: string) => setRetired(tx, s, templateId, true);
/** Load a retired own procedure into programmes again. */
export const restoreOwnProcedure = (tx: Tx, s: Session, templateId: string) => setRetired(tx, s, templateId, false);
