import type { PGlite } from "@electric-sql/pglite";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { withFirm } from "./db";

/**
 * Authentication. These functions run as the table owner, not the tenant role,
 * because a sign-in has to find the user before the firm is known. Everything
 * else in the application goes through withFirm and row-level security.
 */

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 32;

export const SESSION_HOURS = 12;
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;
export const MIN_PASSWORD_LENGTH = 10;
export const ROLES = ["admin", "partner", "reviewer", "preparer"] as const;
export type Role = (typeof ROLES)[number];

export interface AuthSession {
  firmId: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  firmName: string;
}

export class AuthError extends Error {}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEY_LENGTH, SCRYPT);
  return `scrypt$${SCRYPT.N}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const parts = (stored ?? "").split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[2], "base64");
  const expected = Buffer.from(parts[3], "base64");
  const actual = await scryptAsync(password, salt, expected.length, { ...SCRYPT, N: Number(parts[1]) });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Verified against when the email is unknown, so that response time does not reveal which emails exist.
let decoyHash: Promise<string> | undefined;
const decoy = () => (decoyHash ??= hashPassword(randomBytes(16).toString("hex")));

const normaliseEmail = (email: string) => email.trim().toLowerCase();
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

function checkNewUser(name: string, email: string, password: string) {
  if (name.trim().length < 2) throw new AuthError("Enter a name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw new AuthError("Enter a valid email address.");
  if (password.length < MIN_PASSWORD_LENGTH) throw new AuthError(`The password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  if (password.length > 200) throw new AuthError("The password is too long.");
}

async function emailTaken(db: PGlite, email: string): Promise<boolean> {
  return (await db.query("select 1 from users where lower(email) = $1", [normaliseEmail(email)])).rows.length > 0;
}

/** Register a new firm with its first user, who becomes the firm's administrator. */
export async function signUp(db: PGlite, input: { firmName: string; name: string; email: string; password: string }): Promise<{ firmId: string; userId: string }> {
  if (input.firmName.trim().length < 2) throw new AuthError("Enter the firm's name.");
  checkNewUser(input.name, input.email, input.password);
  if (await emailTaken(db, input.email)) throw new AuthError("An account with this email address already exists.");
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    const firm = await tx.query<{ id: string }>("insert into firms (name) values ($1) returning id", [input.firmName.trim()]);
    const user = await tx.query<{ id: string }>(
      "insert into users (firm_id, email, name, role, password_hash) values ($1, $2, $3, 'admin', $4) returning id",
      [firm.rows[0].id, normaliseEmail(input.email), input.name.trim(), passwordHash],
    );
    await tx.query("insert into audit_log (firm_id, user_id, action, entity, entity_id) values ($1, $2, 'sign_up', 'firm', $3)", [firm.rows[0].id, user.rows[0].id, firm.rows[0].id]);
    return { firmId: firm.rows[0].id, userId: user.rows[0].id };
  });
}

/** Set or replace a user's password and clear any lockout. Used by the seed script and, later, password reset. */
export async function setPassword(db: PGlite, userId: string, password: string): Promise<void> {
  if (password.length < MIN_PASSWORD_LENGTH) throw new AuthError(`The password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  await db.query("update users set password_hash = $2, failed_attempts = 0, locked_until = null where id = $1", [userId, await hashPassword(password)]);
  await db.query("delete from sessions where user_id = $1", [userId]);
}

/**
 * Check the credentials and start a session. Returns the session token for the cookie.
 * The same error is given for an unknown email and a wrong password.
 */
export async function signIn(db: PGlite, email: string, password: string): Promise<string> {
  const failure = new AuthError("The email address or password is incorrect.");
  const { rows } = await db.query<{ id: string; firmId: string; passwordHash: string | null; locked: boolean }>(
    `select id, firm_id as "firmId", password_hash as "passwordHash", coalesce(locked_until > now(), false) as locked
     from users where lower(email) = $1`,
    [normaliseEmail(email)],
  );
  const user = rows[0];
  if (!user) {
    await verifyPassword(password, await decoy());
    throw failure;
  }
  if (user.locked) {
    throw new AuthError(`Too many failed attempts. This account is locked for up to ${LOCK_MINUTES} minutes.`);
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    await db.query(
      `update users set
         failed_attempts = case when failed_attempts + 1 >= $2 then 0 else failed_attempts + 1 end,
         locked_until = case when failed_attempts + 1 >= $2 then now() + make_interval(mins => $3) else locked_until end
       where id = $1`,
      [user.id, MAX_FAILED_ATTEMPTS, LOCK_MINUTES],
    );
    await db.query("insert into audit_log (firm_id, user_id, action, entity, entity_id) values ($1, $2, 'sign_in_failed', 'user', $3)", [user.firmId, user.id, user.id]);
    throw failure;
  }

  const token = randomBytes(32).toString("base64url");
  await db.query("update users set failed_attempts = 0, locked_until = null where id = $1", [user.id]);
  await db.query("delete from sessions where expires_at < now()");
  await db.query("insert into sessions (token_hash, user_id, firm_id, expires_at) values ($1, $2, $3, now() + make_interval(hours => $4))", [
    hashToken(token),
    user.id,
    user.firmId,
    SESSION_HOURS,
  ]);
  await db.query("insert into audit_log (firm_id, user_id, action, entity, entity_id) values ($1, $2, 'sign_in', 'user', $3)", [user.firmId, user.id, user.id]);
  return token;
}

/** Resolve a cookie token to the signed-in user, or null if it is missing, unknown or expired. */
export async function getSessionByToken(db: PGlite, token: string | undefined): Promise<AuthSession | null> {
  if (!token) return null;
  const { rows } = await db.query<AuthSession>(
    `select u.firm_id as "firmId", u.id as "userId", u.name, u.email, u.role, f.name as "firmName"
     from sessions s join users u on u.id = s.user_id join firms f on f.id = u.firm_id
     where s.token_hash = $1 and s.expires_at > now()`,
    [hashToken(token)],
  );
  return rows[0] ?? null;
}

export async function signOut(db: PGlite, token: string | undefined): Promise<void> {
  if (token) await db.query("delete from sessions where token_hash = $1", [hashToken(token)]);
}

/** An administrator adds a colleague to their own firm with an initial password. */
export async function addUser(db: PGlite, admin: AuthSession, input: { name: string; email: string; role: string; password: string }): Promise<string> {
  // Re-read the role: the session object may be stale if the administrator was demoted.
  const current = await db.query<{ role: string }>("select role from users where id = $1 and firm_id = $2", [admin.userId, admin.firmId]);
  if (current.rows[0]?.role !== "admin") throw new AuthError("Only an administrator can add users.");
  if (!ROLES.includes(input.role as Role)) throw new AuthError("Choose a role.");
  checkNewUser(input.name, input.email, input.password);
  if (await emailTaken(db, input.email)) throw new AuthError("An account with this email address already exists.");
  const { rows } = await db.query<{ id: string }>(
    "insert into users (firm_id, email, name, role, password_hash) values ($1, $2, $3, $4, $5) returning id",
    [admin.firmId, normaliseEmail(input.email), input.name.trim(), input.role, await hashPassword(input.password)],
  );
  await db.query("insert into audit_log (firm_id, user_id, action, entity, entity_id, detail) values ($1, $2, 'add_user', 'user', $3, $4)", [
    admin.firmId,
    admin.userId,
    rows[0].id,
    JSON.stringify({ email: normaliseEmail(input.email), role: input.role }),
  ]);
  return rows[0].id;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: Role;
}

/** The firm's users, read through row-level security like any other tenant data. */
export async function listTeam(db: PGlite, firmId: string): Promise<TeamMember[]> {
  return withFirm(db, firmId, async (tx) => (await tx.query<TeamMember>("select id, name, email, role from users order by name")).rows);
}
