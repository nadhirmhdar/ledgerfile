import { APP_ROLE } from "./config";
import type { Db } from "./db";

/**
 * Create or update the runtime login role, exactly as docs/hosted-roles.sql does: it owns nothing, cannot be a superuser, create
 * databases or roles, bypass row-level security, or inherit privileges. It can only SET ROLE to app_user (tenant work) and app_auth
 * (sign-in and sessions), and read schema_migrations for the start-time version check.
 *
 * The password arrives as a SCRAM-SHA-256 verifier, never as plaintext: CREATE and ALTER ROLE take no bind parameters, so the
 * value is part of the SQL text, and a verifier is safe in a server log where a password is not. Safe to run again.
 */
export async function ensureAppRole(db: Db, verifier: string): Promise<{ created: boolean }> {
  if (!/^SCRAM-SHA-256\$[0-9A-Za-z+/=:$]+$/.test(verifier)) throw new Error("The password verifier is not in SCRAM-SHA-256 form.");
  const exists = (await db.query("select 1 from pg_roles where rolname = $1", [APP_ROLE])).rows.length > 0;
  // BYPASSRLS defaults to off when the role is created. ALTER ROLE may not name it (even as NOBYPASSRLS) unless the caller itself has
  // BYPASSRLS, which a non-superuser owner like Neon's may lack, so it is only named on create and checked after.
  await db.exec(
    exists
      ? `alter role ${APP_ROLE} with login nosuperuser nocreatedb nocreaterole noinherit password '${verifier}'`
      : `create role ${APP_ROLE} login nosuperuser nocreatedb nocreaterole noinherit nobypassrls password '${verifier}'`,
  );
  const attrs = (await db.query<{ rolsuper: boolean; rolbypassrls: boolean; rolcreatedb: boolean; rolcreaterole: boolean; rolinherit: boolean; rolcanlogin: boolean }>(
    "select rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolinherit, rolcanlogin from pg_roles where rolname = $1",
    [APP_ROLE],
  )).rows[0];
  if (!attrs || attrs.rolsuper || attrs.rolbypassrls || attrs.rolcreatedb || attrs.rolcreaterole || attrs.rolinherit || !attrs.rolcanlogin) {
    throw new Error(`The ${APP_ROLE} role does not have the expected restrictions. Drop it and run setup again.`);
  }

  // Postgres 16 and later name the membership options; earlier versions have the one form (and the role has NOINHERIT either way).
  const version = Number((await db.query<{ v: string }>("show server_version_num")).rows[0].v);
  for (const role of ["app_user", "app_auth"]) {
    await db.exec(version >= 160000 ? `grant ${role} to ${APP_ROLE} with inherit false, set true` : `grant ${role} to ${APP_ROLE}`);
  }
  await db.exec(`grant select on schema_migrations to ${APP_ROLE}`);

  // Supabase only: its API roles can read new public tables by default. Close that where those roles exist; elsewhere this does nothing.
  for (const r of (await db.query<{ rolname: string }>("select rolname from pg_roles where rolname in ('anon', 'authenticated')")).rows) {
    await db.exec(`revoke all on all tables in schema public from ${r.rolname}`);
    await db.exec(`revoke all on all sequences in schema public from ${r.rolname}`);
  }
  return { created: !exists };
}
