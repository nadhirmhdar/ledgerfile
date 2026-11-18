import type { Tx } from "./db";
import { audit as log, type Session } from "./repo";
import { AREAS, type Area, type ProcedureTemplate } from "../domain/audit";
import { applyFirmChanges, changesWording, checkWording, isProtected, stateOf, type FirmChange, type ProcedureState, type WordingInput } from "../domain/firm-methodology";
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

/** The areas as this firm has them: the library with its changes applied. What new programmes are loaded from. */
export async function getFirmAreas(tx: Tx): Promise<Area[]> {
  return applyFirmChanges(AREAS, await loadFirmChanges(tx));
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
export interface MethodologyArea {
  code: string;
  title: string;
  procedures: MethodologyProcedure[];
}

/** Every area and procedure with the library's wording, the firm's current wording and the state, for the methodology page. */
export async function listFirmMethodology(tx: Tx): Promise<MethodologyArea[]> {
  const changes = new Map((await loadFirmChanges(tx)).map((c) => [c.templateId, c]));
  return AREAS.map((a) => ({
    code: a.code,
    title: a.title,
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
