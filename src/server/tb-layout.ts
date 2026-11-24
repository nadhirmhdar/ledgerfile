import type { Tx } from "./db";
import { audit, getEngagement, type Session } from "./repo";
import { canReview } from "../domain/signoff";
import { ROLES, type SavedLayout } from "../domain/tb-layout";

/**
 * The trial balance columns remembered for a client (see domain/tb-layout.ts). Saved after an import has read a file, used before automatic detection
 * on the next upload for any engagement of the same client, and forgotten on request by a reviewer or partner. Each save and each forget is logged.
 */

export interface RememberedLayout {
  clientId: string;
  layout: SavedLayout | null;
  updatedAt: string | null;
}

/** What is remembered for the engagement's client. Null when the engagement does not exist (or is another firm's). */
export async function getRemembered(tx: Tx, engagementId: string): Promise<RememberedLayout | null> {
  const { rows } = await tx.query<{ clientId: string; layout: SavedLayout | null; updatedAt: string | null }>(
    `select c.id as "clientId", c.tb_layout as layout, to_char(c.tb_layout_updated_at at time zone 'UTC', 'YYYY-MM-DD') as "updatedAt"
     from engagements e join clients c on c.id = e.client_id where e.id = $1`,
    [engagementId],
  );
  const row = rows[0];
  if (!row) return null;
  const layout = row.layout && typeof row.layout === "object" && row.layout.headings && row.layout.columns ? row.layout : null;
  return { clientId: row.clientId, layout, updatedAt: row.updatedAt };
}

const same = (a: SavedLayout | null, b: SavedLayout) => a !== null && JSON.stringify(a) === JSON.stringify(b);

/** Remember a layout for the engagement's client. Nothing is written, or logged, when it is what is already remembered. */
export async function rememberLayout(tx: Tx, s: Session, engagementId: string, layout: SavedLayout): Promise<boolean> {
  const current = await getRemembered(tx, engagementId);
  if (!current) throw new Error("Engagement not found.");
  if (same(current.layout, layout)) return false;
  await tx.query("update clients set tb_layout = $2, tb_layout_updated_at = now() where id = $1", [current.clientId, JSON.stringify(layout)]);
  await audit(tx, s, "save_tb_layout", "client", current.clientId, { roles: ROLES.filter((r) => layout.headings[r] !== undefined) });
  return true;
}

/** Forget the columns remembered for the engagement's client. A reviewer or partner may; the role is read from the database now. */
export async function forgetLayout(tx: Tx, s: Session, engagementId: string): Promise<boolean> {
  const { rows } = await tx.query<{ role: string }>("select role from users where id = $1", [s.userId]);
  if (!canReview((rows[0]?.role ?? s.role) as Session["role"])) throw new Error("Only a reviewer or partner can forget the remembered columns.");
  const current = await getRemembered(tx, engagementId);
  if (!current) throw new Error("Engagement not found.");
  if (!current.layout) return false;
  await tx.query("update clients set tb_layout = null, tb_layout_updated_at = null where id = $1", [current.clientId]);
  await audit(tx, s, "forget_tb_layout", "client", current.clientId);
  return true;
}

/** How the latest import on the engagement found its columns, for the page. */
export async function latestImportSource(tx: Tx, engagementId: string): Promise<"remembered" | "detected" | "chosen" | "recognised" | "template" | null> {
  const engagement = await getEngagement(tx, engagementId);
  if (!engagement) return null;
  const { rows } = await tx.query<{ source: string | null }>("select layout->>'source' as source from tb_imports where engagement_id = $1 order by imported_at desc, id desc limit 1", [engagementId]);
  const source = rows[0]?.source;
  return source === "remembered" || source === "detected" || source === "chosen" || source === "recognised" || source === "template" ? source : null;
}
