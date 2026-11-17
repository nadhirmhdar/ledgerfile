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
export async function ensureAppRole(db: Db, verifier: string, appRole: string = APP_ROLE): Promise<{ created: boolean }> {
  // The name is part of the SQL text, so it must be a plain lower-case identifier. Only tests pass anything but the default.
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(appRole)) throw new Error("The role name is not a plain lower-case identifier.");
  if (!/^SCRAM-SHA-256\$[0-9A-Za-z+/=:$]+$/.test(verifier)) throw new Error("The password verifier is not in SCRAM-SHA-256 form.");
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
  await db.exec(
    exists
      ? `alter role ${appRole} with password '${verifier}'`
      : `create role ${appRole} login nosuperuser nocreatedb nocreaterole noinherit nobypassrls password '${verifier}'`,
  );
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
  return { created: !exists };
}
