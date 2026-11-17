import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { withAuth, withFirm, type Db, type Queryable } from "./db";
import { isHosted, PUBLIC_DEMO_PASSWORD } from "./config";

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

async function emailTaken(db: Queryable, email: string): Promise<boolean> {
  return (await db.query("select 1 from users where lower(email) = $1", [normaliseEmail(email)])).rows.length > 0;
}

/** Register a new firm with its first user, who becomes the firm's administrator. */
async function signUpQ(db: Queryable, input: { firmName: string; name: string; email: string; password: string }): Promise<{ firmId: string; userId: string }> {
  if (input.firmName.trim().length < 2) throw new AuthError("Enter the firm's name.");
  checkNewUser(input.name, input.email, input.password);
  if (await emailTaken(db, input.email)) throw new AuthError("An account with this email address already exists.");
  const passwordHash = await hashPassword(input.password);
  {
    const tx = db;
    const firm = await tx.query<{ id: string }>("insert into firms (name) values ($1) returning id", [input.firmName.trim()]);
    const user = await tx.query<{ id: string }>(
      "insert into users (firm_id, email, name, role, password_hash) values ($1, $2, $3, 'admin', $4) returning id",
      [firm.rows[0].id, normaliseEmail(input.email), input.name.trim(), passwordHash],
    );
    await tx.query("insert into audit_log (firm_id, user_id, action, entity, entity_id) values ($1, $2, 'sign_up', 'firm', $3)", [firm.rows[0].id, user.rows[0].id, firm.rows[0].id]);
    return { firmId: firm.rows[0].id, userId: user.rows[0].id };
  }
}

/** Set or replace a user's password and clear any lockout. Used by the seed script and, later, password reset. */
async function setPasswordQ(db: Queryable, userId: string, password: string): Promise<void> {
  if (password.length < MIN_PASSWORD_LENGTH) throw new AuthError(`The password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  await db.query("update users set password_hash = $2, failed_attempts = 0, locked_until = null where id = $1", [userId, await hashPassword(password)]);
  await db.query("delete from sessions where user_id = $1", [userId]);
}

/**
 * Check the credentials and start a session. Returns the session token for the cookie.
 * The same error is given for an unknown email and a wrong password.
 */
async function signInQ(db: Queryable, email: string, password: string): Promise<string | AuthError> {
  const failure = new AuthError("The email address or password is incorrect.");
  // A hosted site never accepts the public demo password, whatever the account. Same answer and same timing as a wrong password.
  if (isHosted() && password === PUBLIC_DEMO_PASSWORD) {
    await verifyPassword(password, await decoy());
    return failure;
  }
  const { rows } = await db.query<{ id: string; firmId: string; passwordHash: string | null; locked: boolean; active: boolean }>(
    `select id, firm_id as "firmId", password_hash as "passwordHash", coalesce(locked_until > now(), false) as locked, active
     from users where lower(email) = $1`,
    [normaliseEmail(email)],
  );
  const user = rows[0];
  if (!user) {
    await verifyPassword(password, await decoy());
    return failure;
  }
  if (!user.active) {
    await verifyPassword(password, await decoy());
    return failure;
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
    return failure;
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
async function getSessionByTokenQ(db: Queryable, token: string | undefined): Promise<AuthSession | null> {
  if (!token) return null;
  const { rows } = await db.query<AuthSession>(
    `select u.firm_id as "firmId", u.id as "userId", u.name, u.email, u.role, f.name as "firmName"
     from sessions s join users u on u.id = s.user_id join firms f on f.id = u.firm_id
     where s.token_hash = $1 and s.expires_at > now() and u.active`,
    [hashToken(token)],
  );
  return rows[0] ?? null;
}

async function signOutQ(db: Queryable, token: string | undefined): Promise<void> {
  if (token) await db.query("delete from sessions where token_hash = $1", [hashToken(token)]);
}

/** An administrator adds a colleague to their own firm with an initial password. */
async function addUserQ(db: Queryable, admin: AuthSession, input: { name: string; email: string; role: string; password: string }): Promise<string> {
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
  active: boolean;
}

/** The firm's users, read through row-level security like any other tenant data. */
export async function listTeam(db: Db, firmId: string): Promise<TeamMember[]> {
  return withFirm(db, firmId, async (tx) => (await tx.query<TeamMember>("select id, name, email, role, active from users order by name")).rows);
}

// --- Managing existing users -------------------------------------------------

/** Confirm from the database that the acting user is an active administrator of their firm. */
async function requireAdmin(db: Queryable, admin: AuthSession): Promise<void> {
  const current = await db.query<{ role: string; active: boolean }>("select role, active from users where id = $1 and firm_id = $2", [admin.userId, admin.firmId]);
  if (current.rows[0]?.role !== "admin" || !current.rows[0].active) throw new AuthError("Only an administrator can manage users.");
}

/** Load a user of the administrator's own firm; a user of any other firm is reported as not found. */
async function targetUser(db: Queryable, admin: AuthSession, userId: string) {
  const { rows } = await db.query<{ id: string; role: Role; active: boolean; email: string }>(
    "select id, role, active, email from users where id = $1 and firm_id = $2",
    [userId, admin.firmId],
  );
  if (!rows[0]) throw new AuthError("User not found.");
  return rows[0];
}

/** A firm must always keep at least one active administrator, or nobody could manage it. */
async function otherActiveAdmins(db: Queryable, firmId: string, exceptUserId: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>("select count(*)::int as n from users where firm_id = $1 and role = 'admin' and active and id <> $2", [firmId, exceptUserId]);
  return rows[0].n;
}

async function logUserChange(db: Queryable, admin: AuthSession, action: string, userId: string, detail?: unknown) {
  await db.query("insert into audit_log (firm_id, user_id, action, entity, entity_id, detail) values ($1, $2, $3, 'user', $4, $5)", [
    admin.firmId,
    admin.userId,
    action,
    userId,
    detail === undefined ? null : JSON.stringify(detail),
  ]);
}

async function setUserRoleQ(db: Queryable, admin: AuthSession, userId: string, role: string): Promise<void> {
  await requireAdmin(db, admin);
  if (!ROLES.includes(role as Role)) throw new AuthError("Choose a role.");
  const user = await targetUser(db, admin, userId);
  if (user.role === role) return;
  if (user.role === "admin" && user.active && (await otherActiveAdmins(db, admin.firmId, userId)) === 0) {
    throw new AuthError("The firm must keep at least one administrator. Make someone else an administrator first.");
  }
  await db.query("update users set role = $2 where id = $1", [userId, role]);
  await logUserChange(db, admin, "set_role", userId, { from: user.role, to: role });
}

/** Deactivate or reactivate a user. A deactivated user is signed out and cannot sign in. */
async function setUserActiveQ(db: Queryable, admin: AuthSession, userId: string, active: boolean): Promise<void> {
  await requireAdmin(db, admin);
  const user = await targetUser(db, admin, userId);
  if (user.active === active) return;
  if (!active) {
    if (userId === admin.userId) throw new AuthError("You cannot deactivate your own account.");
    if (user.role === "admin" && (await otherActiveAdmins(db, admin.firmId, userId)) === 0) {
      throw new AuthError("The firm must keep at least one administrator.");
    }
  }
  await db.query("update users set active = $2 where id = $1", [userId, active]);
  if (!active) await db.query("delete from sessions where user_id = $1", [userId]);
  await logUserChange(db, admin, active ? "reactivate" : "deactivate", userId);
}

/** An administrator sets a new password for a colleague who has forgotten theirs. */
async function resetUserPasswordQ(db: Queryable, admin: AuthSession, userId: string, newPassword: string): Promise<void> {
  await requireAdmin(db, admin);
  if (newPassword.length > 200) throw new AuthError("The password is too long.");
  await targetUser(db, admin, userId);
  await setPasswordQ(db, userId, newPassword);
  await logUserChange(db, admin, "reset_password", userId);
}

/** A user changes their own password. Every session, including the current one, is ended. */
async function changeOwnPasswordQ(db: Queryable, session: AuthSession, currentPassword: string, newPassword: string): Promise<void> {
  const { rows } = await db.query<{ passwordHash: string | null }>('select password_hash as "passwordHash" from users where id = $1 and firm_id = $2 and active', [
    session.userId,
    session.firmId,
  ]);
  if (!rows[0] || !(await verifyPassword(currentPassword, rows[0].passwordHash))) throw new AuthError("Your current password is incorrect.");
  if (newPassword.length > 200) throw new AuthError("The password is too long.");
  if (newPassword === currentPassword) throw new AuthError("Choose a password different from your current one.");
  await setPasswordQ(db, session.userId, newPassword);
  await logUserChange(db, session, "change_password", session.userId);
}

// --- Entry points ---------------------------------------------------------------
// Each runs in one transaction as app_auth (see withAuth). Sign-in is the exception to "an error rolls back": a wrong password
// must keep its lockout count and audit entry, so signInQ returns the failure and it is thrown here, after the commit.

const asAuth = <A extends unknown[], R>(work: (q: Queryable, ...args: A) => Promise<R>) => (db: Db, ...args: A): Promise<R> => withAuth(db, (q) => work(q, ...args));

/** Register a new firm with its first user, who becomes the firm's administrator. */
export const signUp = asAuth(signUpQ);
/** Set or replace a user's password and clear any lockout. Used by the seed script and password reset. */
export const setPassword = asAuth(setPasswordQ);
export async function signIn(db: Db, email: string, password: string): Promise<string> {
  const result = await withAuth(db, (q) => signInQ(q, email, password));
  if (result instanceof AuthError) throw result;
  return result;
}
/** Resolve a cookie token to the signed-in user, or null if it is missing, unknown or expired. */
export const getSessionByToken = asAuth(getSessionByTokenQ);
export const signOut = asAuth(signOutQ);
/** An administrator adds a colleague to their own firm with an initial password. */
export const addUser = asAuth(addUserQ);
export const setUserRole = asAuth(setUserRoleQ);
/** Deactivate or reactivate a user. A deactivated user is signed out and cannot sign in. */
export const setUserActive = asAuth(setUserActiveQ);
/** An administrator sets a new password for a colleague who has forgotten theirs. */
export const resetUserPassword = asAuth(resetUserPasswordQ);
/** A user changes their own password. Every session, including the current one, is ended. */
export const changeOwnPassword = asAuth(changeOwnPasswordQ);
