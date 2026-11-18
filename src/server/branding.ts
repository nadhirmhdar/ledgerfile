import { createHash, randomUUID } from "node:crypto";
import { withAuth, type Db, type Queryable, type Tx } from "./db";
import { AuthError, requireAdmin, type AuthSession } from "./auth";
import type { FileStore } from "./file-store";
import { checkLogo, cleanBrandingText, hasBranding, type Branding, type LogoImage, detectImage } from "../domain/branding";

/**
 * Firm branding: the address, contact and registration lines and the logo shown on the letters, statements and auditor's report.
 *
 * Reading goes through withFirm like any tenant data. Writing goes through withAuth, as user management does, and only for an administrator
 * whose role is re-read from the database; it acts only on the administrator's own firm. The logo is kept in the private file store under a
 * server-chosen key and is never given a public URL: the only way to see it is the authenticated route /firm/logo, and the outputs read it
 * here on the server.
 */

export interface BrandingView {
  firmName: string;
  address: string | null;
  contactLine: string | null;
  registrationLine: string | null;
  hasLogo: boolean;
  logoContentType: string | null;
  logoBytes: number | null;
  updatedAt: string | null;
}

/** The firm's branding settings, for the Firm page. The signed-in firm's own row only (row-level security). */
export async function getBranding(tx: Tx): Promise<BrandingView | null> {
  const { rows } = await tx.query<BrandingView>(
    `select name as "firmName", address, contact_line as "contactLine", registration_line as "registrationLine", logo_key is not null as "hasLogo",
            logo_content_type as "logoContentType", logo_bytes as "logoBytes", to_char(branding_updated_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as "updatedAt"
     from firms`,
  );
  return rows[0] ?? null;
}

async function logBranding(q: Queryable, admin: AuthSession, action: string, detail: unknown) {
  await q.query("insert into audit_log (firm_id, user_id, action, entity, entity_id, detail) values ($1, $2, $3, 'firm', $4, $5)", [admin.firmId, admin.userId, action, admin.firmId, JSON.stringify(detail)]);
}

export interface BrandingInput {
  address: string;
  contactLine: string;
  registrationLine: string;
}

/** Save the address, contact line and registration line. Administrator only. Blank clears a line. */
export async function updateBranding(db: Db, admin: AuthSession, input: BrandingInput): Promise<void> {
  const cleaned = cleanBrandingText(input);
  await withAuth(db, async (q) => {
    await requireAdmin(q, admin);
    if (!cleaned.ok) throw new AuthError(cleaned.message);
    const { address, contactLine, registrationLine } = cleaned.value;
    await q.query(
      "update firms set address = $2, contact_line = $3, registration_line = $4, branding_updated_at = clock_timestamp() where id = $1",
      [admin.firmId, address, contactLine, registrationLine],
    );
    await logBranding(q, admin, "update_branding", { address: address !== null, contactLine: contactLine !== null, registrationLine: registrationLine !== null });
  });
}

/**
 * Replace the firm's logo. Administrator only. The bytes are checked first (a real PNG or JPEG, at most 1 MB, 32 to 2000 pixels), stored under a
 * new server key (a put never overwrites), recorded with their sha256, and only then is the old logo removed. If recording fails the new file is
 * removed again, so nothing is left unreferenced.
 */
export async function uploadLogo(db: Db, admin: AuthSession, bytes: Uint8Array, store: FileStore): Promise<{ contentType: string; bytes: number; width: number; height: number }> {
  await withAuth(db, (q) => requireAdmin(q, admin));
  const checked = checkLogo(bytes);
  if (!checked.ok) throw new AuthError(checked.message);
  const key = `${admin.firmId}/${randomUUID()}`;
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await store.put(key, bytes);
  let previous: string | null = null;
  try {
    await withAuth(db, async (q) => {
      await requireAdmin(q, admin);
      const old = await q.query<{ key: string | null }>("select logo_key as key from firms where id = $1 for update", [admin.firmId]);
      previous = old.rows[0]?.key ?? null;
      await q.query(
        "update firms set logo_key = $2, logo_content_type = $3, logo_bytes = $4, logo_sha256 = $5, branding_updated_at = clock_timestamp() where id = $1",
        [admin.firmId, key, checked.contentType, bytes.length, sha256],
      );
      await logBranding(q, admin, "upload_logo", { contentType: checked.contentType, bytes: bytes.length, width: checked.width, height: checked.height, sha256 });
    });
  } catch (e) {
    await store.remove(key).catch(() => undefined);
    throw e;
  }
  // The new logo is recorded and committed; now the old file can go.
  if (previous) await store.remove(previous).catch(() => console.error("branding: the previous logo file could not be removed"));
  return { contentType: checked.contentType, bytes: bytes.length, width: checked.width, height: checked.height };
}

/** Remove the firm's logo. Administrator only. */
export async function removeLogo(db: Db, admin: AuthSession, store: FileStore): Promise<void> {
  const previous = await withAuth(db, async (q) => {
    await requireAdmin(q, admin);
    const old = await q.query<{ key: string | null }>("select logo_key as key from firms where id = $1 for update", [admin.firmId]);
    const key = old.rows[0]?.key ?? null;
    if (!key) throw new AuthError("There is no logo to remove.");
    await q.query("update firms set logo_key = null, logo_content_type = null, logo_bytes = null, logo_sha256 = null, branding_updated_at = clock_timestamp() where id = $1", [admin.firmId]);
    await logBranding(q, admin, "remove_logo", {});
    return key;
  });
  await store.remove(previous).catch(() => console.error("branding: the removed logo file could not be deleted"));
}

/** The logo's bytes and type for the signed-in firm, checked against the recorded sha256. Null when there is none or it cannot be read as recorded. */
export async function readLogo(tx: Tx, store: () => FileStore): Promise<{ data: Uint8Array; contentType: string } | null> {
  const { rows } = await tx.query<{ key: string | null; contentType: string | null; sha256: string | null }>("select logo_key as key, logo_content_type as \"contentType\", logo_sha256 as sha256 from firms");
  const row = rows[0];
  if (!row?.key || !row.contentType || !row.sha256) return null;
  const data = await store().get(row.key);
  if (!data) return null;
  if (createHash("sha256").update(data).digest("hex") !== row.sha256) return null;
  return { data, contentType: row.contentType };
}

/**
 * The firm's branding for the downloads, with the logo read from the store (and checked against its hash). A logo that cannot be read, or that
 * the document libraries could not embed, is left out rather than failing the download. `store` is only asked for when a logo is recorded.
 */
export async function loadBrandingForOutputs(tx: Tx, store: () => FileStore): Promise<Branding> {
  const { rows } = await tx.query<{ firmName: string; address: string | null; contactLine: string | null; registrationLine: string | null }>(
    'select name as "firmName", address, contact_line as "contactLine", registration_line as "registrationLine" from firms',
  );
  const row = rows[0] ?? { firmName: "", address: null, contactLine: null, registrationLine: null };
  let logo: LogoImage | null = null;
  try {
    const stored = await readLogo(tx, store);
    const facts = stored ? detectImage(stored.data) : null;
    if (stored && facts && !facts.interlaced) logo = { data: stored.data, contentType: facts.contentType, width: facts.width, height: facts.height };
  } catch {
    console.error("branding: the logo could not be read, so it is left off the download");
  }
  return { ...row, logo };
}

export { hasBranding };
