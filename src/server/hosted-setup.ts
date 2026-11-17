import pg from "pg";
import { APP_ROLE } from "./config";
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

/**
 * Run a statement whose text contains the password (or its verifier). Whatever goes wrong, the error that leaves here carries no
 * pg field: not the message, detail, where, internalQuery or position, any of which can quote the statement. Only the SQLSTATE
 * does, and for permission errors the message too, because those never contain the statement.
 */
async function runSecretStatement(db: Db, sql: string): Promise<void> {
  try {
    await db.exec(sql);
  } catch (e) {
    if (isPlaintextOnlyRefusal(e)) throw e;
    const code = e && typeof e === "object" && typeof (e as { code?: unknown }).code === "string" ? (e as { code: string }).code : undefined;
    const message = e && typeof e === "object" && typeof (e as { message?: unknown }).message === "string" ? (e as { message: string }).message : undefined;
    throw new SecretStatementError(code, code && SAFE_CODES.has(code) && message ? message : undefined);
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
  // The attributes are set when the role is created. A later ALTER ROLE by a non-superuser owner (Neon's, CI's) may not restate them: it
  // changes only the password, and the attributes are checked after.
  const statement = (secret: string) =>
    exists ? `alter role ${appRole} with password ${secret}` : `create role ${appRole} login nosuperuser nocreatedb nocreaterole noinherit nobypassrls password ${secret}`;
  let usedPlaintext = false;
  try {
    await runSecretStatement(db, statement(`'${password.verifier}'`));
  } catch (e) {
    if (!isPlaintextOnlyRefusal(e) || !password.plaintext) {
      if (isPlaintextOnlyRefusal(e)) throw new Error("This database only accepts a plaintext password for a role, and none was given.");
      throw e;
    }
    usedPlaintext = true;
    await runSecretStatement(db, statement(quoteLiteral(password.plaintext)));
  }
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
