import pg from "pg";
import { APP_ROLE, redact } from "./config";
import type { Db } from "./db";

/**
 * What the runtime role's password is, in the two forms setup may send it. The verifier is tried first, so that plaintext reaches SQL
 * only where it must. `plaintext` is optional: without it there is no fallback.
 */
export interface RolePassword {
  verifier: string;
  plaintext?: string;
}

/** Neon's refusal of a hashed password: SQLSTATE XX000 from its control plane, and this sentence. Nothing else is treated as that. */
export function isPlaintextOnlyRefusal(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const { code, message } = e as { code?: unknown; message?: unknown };
  return code === "XX000" && typeof message === "string" && /only supports being given plaintext passwords/i.test(message);
}

/** A Postgres error that is safe to show. These SQLSTATEs describe who may do what, not the statement, so their text is kept. */
const SAFE_CODES = new Set(["42501", "42704", "42710", "28000", "28P01"]);

class SecretStatementError extends Error {
  constructor(public readonly code: string | undefined, text?: string) {
    super(text ?? `A role statement failed${code ? ` [${code}]` : ""}.`);
  }
}

/** The secret a statement carries, as it appears in the SQL text: the literal, and the pieces to look for in anything the server says back. */
export interface StatementSecret {
  /** The whole statement text. */
  sql: string;
  /** Where the secret literal starts and ends within `sql`. */
  start: number;
  end: number;
  /** What was sent: the plaintext (if the plaintext went), and the verifier (if the verifier went). */
  plaintext?: string;
  verifier?: string;
}

const MAX_SHOWN = 300;

/** Every form of a password that can appear in a server's reply: as typed, quote-doubled, as node-postgres writes a literal, and URL-encoded. */
function passwordForms(p: string): string[] {
  return [p, p.replace(/'/g, "''"), p.replace(/\\/g, "\\\\").replace(/'/g, "''"), encodeURIComponent(p), pg.escapeLiteral(p)];
}

/** Does the text contain any run of `n` characters of `of`? Used to catch a partial quote of a secret. */
function sharesRun(text: string, of: string, n: number): boolean {
  for (let i = 0; i + n <= of.length; i++) if (text.includes(of.slice(i, i + n))) return true;
  return false;
}

/**
 * A control-plane error that is safe to show, or null. It is shown only when it provably quotes none of the secret: not the
 * password in any form, not the verifier or its salt and keys, not any 6-character run of either, and not any 12-character run of the
 * statement that overlaps the secret literal (a run wholly in the fixed text, such as the role name, is harmless and is allowed).
 * Then it is redacted, stripped of control characters and capped. If it has Neon's `{"request_id","error"}` shape only those two
 * fields are shown.
 */
export function safeControlPlaneText(message: string, secret: StatementSecret): string | null {
  if (!/control plane/i.test(message)) return null;
  const secrets: string[] = [];
  if (secret.plaintext) secrets.push(...passwordForms(secret.plaintext));
  if (secret.verifier) {
    secrets.push(secret.verifier);
    const m = /^SCRAM-SHA-256\$\d+:([^$]+)\$([^:]+):(.+)$/.exec(secret.verifier);
    if (m) secrets.push(m[1], m[2], m[3]);
  }
  for (const s of secrets) if (s && message.includes(s)) return null;
  for (const s of [secret.plaintext, secret.verifier]) if (s && sharesRun(message, s, 6)) return null;
  for (let i = 0; i + 12 <= secret.sql.length; i++) {
    if (i < secret.end && i + 12 > secret.start && message.includes(secret.sql.slice(i, i + 12))) return null;
  }

  let text = message;
  const json = /control plane:\s*(\{[\s\S]*\})\s*$/.exec(message);
  if (json) {
    try {
      const body = JSON.parse(json[1]) as { error?: unknown; request_id?: unknown };
      if (typeof body.error === "string") {
        text = body.error + (typeof body.request_id === "string" ? ` (request ${body.request_id})` : "");
      }
    } catch {
      // Not JSON after all: fall back to the whole message, which has passed the same checks.
    }
  }
  const clean = redact(text).replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return clean.length > MAX_SHOWN ? `${clean.slice(0, MAX_SHOWN)}...` : clean;
}

/**
 * Run a statement whose text contains the password (or its verifier). Whatever goes wrong, the error that leaves here carries no
 * pg field: not the message, detail, where, internalQuery or position, any of which can quote the statement. Only the SQLSTATE
 * does, and: for permission errors the message too (those never contain the statement); for a control-plane error from Neon, its
 * own reason, but only after safeControlPlaneText has shown it quotes none of the secret.
 */
async function runSecretStatement(db: Db, secret: StatementSecret, passRefusal: boolean): Promise<void> {
  try {
    await db.exec(secret.sql);
  } catch (e) {
    // Only the verifier attempt may hand the raw refusal up, so the caller can fall back. The plaintext attempt never does.
    if (passRefusal && isPlaintextOnlyRefusal(e)) throw e;
    const code = e && typeof e === "object" && typeof (e as { code?: unknown }).code === "string" ? (e as { code: string }).code : undefined;
    const message = e && typeof e === "object" && typeof (e as { message?: unknown }).message === "string" ? (e as { message: string }).message : undefined;
    const tag = code ? ` [${code}]` : "";
    if (isPlaintextOnlyRefusal(e)) throw new SecretStatementError(code, `A role statement failed${tag}: the database refused the plaintext password too.`);
    if (code && SAFE_CODES.has(code) && message) throw new SecretStatementError(code, message);
    if (code === "XX000" && message) {
      const reason = safeControlPlaneText(message, secret);
      throw new SecretStatementError(code, reason ? `A role statement failed${tag}. The database says: ${reason}` : `A role statement failed${tag}. The database's message was withheld because it could contain the password.`);
    }
    throw new SecretStatementError(code);
  }
}

/** `'...'` written by node-postgres's own escaper: quotes doubled, and an E prefix with backslashes doubled when there are any. */
export const quoteLiteral = (value: string): string => pg.escapeLiteral(value);

/**
 * Create or update the runtime login role, exactly as docs/hosted-roles.sql does: it owns nothing, cannot be a superuser, create
 * databases or roles, bypass row-level security, or inherit privileges. It can only SET ROLE to app_user (tenant work) and app_auth
 * (sign-in and sessions), and read schema_migrations for the start-time version check.
 *
 * The password goes in as a SCRAM-SHA-256 verifier first: CREATE and ALTER ROLE take no bind parameters, so the value is part of the
 * SQL text, and a verifier is safe in a server log where a password is not. Neon refuses a verifier ("only supports being given
 * plaintext passwords", SQLSTATE XX000); only on exactly that refusal the same statement is sent again with the plaintext, quoted
 * by node-postgres's escapeLiteral. Any other error is not retried. Safe to run again.
 */
export async function ensureAppRole(db: Db, password: RolePassword, appRole: string = APP_ROLE): Promise<{ created: boolean; usedPlaintext: boolean }> {
  // The name is part of the SQL text, so it must be a plain lower-case identifier. Only tests pass anything but the default.
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(appRole)) throw new Error("The role name is not a plain lower-case identifier.");
  if (!/^SCRAM-SHA-256\$[0-9A-Za-z+/=:$]+$/.test(password.verifier)) throw new Error("The password verifier is not in SCRAM-SHA-256 form.");
  const exists = (await db.query("select 1 from pg_roles where rolname = $1", [appRole])).rows.length > 0;
  if (exists) {
    // On Postgres 16 and later a non-superuser may alter a role only with the ADMIN option on it, which the creating role gets on create.
    // If the owner lacks it (the role was made by someone else), say what to grant instead of failing with a bare permission error.
    const me = (await db.query<{ super: boolean; admin: boolean; v: string }>(
      `select r.rolsuper as super, current_setting('server_version_num') as v,
         exists (select 1 from pg_auth_members m join pg_roles g on g.oid = m.roleid where g.rolname = $1 and m.member = r.oid and m.admin_option) as admin
       from pg_roles r where r.rolname = current_user`,
      [appRole],
    )).rows[0];
    if (me && !me.super && Number(me.v) >= 160000 && !me.admin) {
      throw new Error(`The setup role has no ADMIN option on ${appRole}, so it cannot change its password. As a superuser, run: grant ${appRole} to <the setup role> with admin option`);
    }
  }
  // Only the password goes through a statement that may reach Neon's control plane, so that statement says as little as it can: a new role
  // is created with LOGIN and the password alone. NOSUPERUSER, NOCREATEDB, NOCREATEROLE and NOBYPASSRLS are what a new role gets by
  // default; NOINHERIT is set next in a statement with no secret (the owner holds ADMIN on a role it created), and the read-back check
  // below proves every attribute or setup fails. A later ALTER ROLE by a non-superuser owner may not restate SUPERUSER or BYPASSRLS, so
  // an existing role has its password changed and nothing else.
  const statement = (literal: string, extra: Pick<StatementSecret, "plaintext" | "verifier">): StatementSecret => {
    const head = exists ? `alter role ${appRole} with password ` : `create role ${appRole} login password `;
    return { sql: head + literal, start: head.length, end: head.length + literal.length, ...extra };
  };
  let usedPlaintext = false;
  try {
    await runSecretStatement(db, statement(`'${password.verifier}'`, { verifier: password.verifier }), true);
  } catch (e) {
    if (!isPlaintextOnlyRefusal(e) || !password.plaintext) {
      if (isPlaintextOnlyRefusal(e)) throw new Error("This database only accepts a plaintext password for a role, and none was given.");
      throw e;
    }
    usedPlaintext = true;
    await runSecretStatement(db, statement(quoteLiteral(password.plaintext), { plaintext: password.plaintext, verifier: password.verifier }), false);
  }
  await db.exec(`alter role ${appRole} with noinherit`);
  const attrs = (await db.query<{ rolsuper: boolean; rolbypassrls: boolean; rolcreatedb: boolean; rolcreaterole: boolean; rolinherit: boolean; rolcanlogin: boolean }>(
    "select rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolinherit, rolcanlogin from pg_roles where rolname = $1",
    [appRole],
  )).rows[0];
  if (!attrs || attrs.rolsuper || attrs.rolbypassrls || attrs.rolcreatedb || attrs.rolcreaterole || attrs.rolinherit || !attrs.rolcanlogin) {
    throw new Error(`The ${appRole} role does not have the expected restrictions. Drop it and run setup again.`);
  }

  // Postgres 16 and later name the membership options; earlier versions have the one form (and the role has NOINHERIT either way).
  const version = Number((await db.query<{ v: string }>("show server_version_num")).rows[0].v);
  for (const role of ["app_user", "app_auth"]) {
    await db.exec(version >= 160000 ? `grant ${role} to ${appRole} with inherit false, set true` : `grant ${role} to ${appRole}`);
  }
  await db.exec(`grant select on schema_migrations to ${appRole}`);

  // Supabase only: its API roles can read new public tables by default. Close that where those roles exist; elsewhere this does nothing.
  for (const r of (await db.query<{ rolname: string }>("select rolname from pg_roles where rolname in ('anon', 'authenticated')")).rows) {
    await db.exec(`revoke all on all tables in schema public from ${r.rolname}`);
    await db.exec(`revoke all on all sequences in schema public from ${r.rolname}`);
  }
  return { created: !exists, usedPlaintext };
}

/**
 * The setup role must itself be able to switch to app_user and app_auth: seeding the sample firm signs users in and out as them. Migration
 * 0019 grants that, but it carries on after a failed grant (a NOTICE), so check, try the grant once, and say plainly what is missing.
 */
export async function ensureSetupRoleCanSwitch(db: Db): Promise<void> {
  const can = async (role: string): Promise<boolean> => {
    try {
      await db.transaction(async (tx) => {
        await tx.exec(`set local role ${role}`);
      });
      return true;
    } catch {
      return false;
    }
  };
  for (const role of ["app_user", "app_auth"]) {
    if (await can(role)) continue;
    const version = Number((await db.query<{ v: string }>("show server_version_num")).rows[0].v);
    try {
      await db.exec(version >= 160000 ? `grant ${role} to current_user with inherit false, set true` : `grant ${role} to current_user`);
    } catch {
      // Fall through to the check below, which gives the one clear message.
    }
    if (!(await can(role))) {
      throw new Error(`The setup role cannot switch to ${role}. As a superuser, run: grant ${role} to <the setup role> with set true`);
    }
  }
}

/**
 * What the app does on every request, done once as the runtime role through the connection it will really use (on Neon, the pooled
 * host): sign in as app_auth, and as app_user with the firm set for the transaction. It turns the questions the docs leave open (does
 * the pooler let a role made by SQL log in, and does SET LOCAL ROLE and set_config(..., true) hold in its transaction mode) into a
 * clear error at setup instead of one at the first sign-in. The error names no host, user or secret.
 */
export async function verifyRuntimeConnection(db: Db): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await tx.exec("set local role app_auth");
      const who = (await tx.query<{ u: string }>("select current_user as u")).rows[0].u;
      if (who !== "app_auth") throw new Error("role did not switch");
    });
    await db.transaction(async (tx) => {
      await tx.exec("set local role app_user");
      await tx.query("select set_config('app.firm_id', $1, true)", ["00000000-0000-4000-8000-0000000000ff"]);
      const row = (await tx.query<{ u: string; f: string }>("select current_user as u, current_setting('app.firm_id', true) as f")).rows[0];
      if (row.u !== "app_user" || row.f !== "00000000-0000-4000-8000-0000000000ff") throw new Error("role or firm setting did not hold inside the transaction");
    });
    await db.query("select name from schema_migrations order by name desc limit 1");
  } catch (e) {
    const code = e && typeof e === "object" && typeof (e as { code?: unknown }).code === "string" ? ` [${(e as { code: string }).code}]` : "";
    throw new Error(`The runtime role could not log in and switch roles through the runtime connection${code}. Check that ${APP_ROLE} exists with its password, and that the pooler accepts it.`);
  }
}
