import { withAuth, type Db, type Queryable } from "./db";
import { AuthError, LOCK_MINUTES, logUserChange, MAX_FAILED_ATTEMPTS, requireAdmin, targetUser, verifyPassword, type AuthSession } from "./auth";
import { decryptSecret, encryptSecret, mfaKey } from "./mfa-crypto";
import { base32Encode, generateSecret, normaliseCode, otpauthUri, verifyTotp } from "../domain/totp";
import { generateRecoveryCodes, hashRecoveryCode, normaliseRecoveryCode, verifyRecoveryCode } from "../domain/recovery-codes";

/**
 * Two-step sign-in: the foundations. Authenticator codes (TOTP) and single-use recovery codes. Nothing here changes how anyone signs in yet:
 * these are the functions the enrolment page, the sign-in step and the administrator's reset will call.
 *
 * Everything runs as app_auth through withAuth, like the other account changes (change password, reset password): the second step is
 * checked with no firm context, and the secret and hashes are readable only by that role. A wrong code must keep its failure count, so,
 * as signIn does, a failure is returned from the transaction and thrown after it commits.
 *
 * The secret is stored encrypted (see mfa-crypto.ts). Neither it, a code, a recovery code nor the key is ever written to an error, a log
 * or the audit log.
 */

export const ISSUER = "LedgerFile";
const MESSAGES = {
  invalid: "That code is not right. Check the code in your authenticator app, or use a recovery code, and try again.",
  locked: `Too many wrong codes. Two-step sign-in is locked for up to ${LOCK_MINUTES} minutes.`,
  notEnabled: "Two-step sign-in is not on for this account.",
} as const;

export interface MfaOptions {
  /** The encryption key; defaults to MFA_ENCRYPTION_KEY from the environment, read only when a secret has to be encrypted or decrypted. */
  key?: Buffer;
  /** The current time; defaults to now. */
  now?: Date;
}

const keyOf = (o: MfaOptions) => o.key ?? mfaKey();
const nowOf = (o: MfaOptions) => o.now ?? new Date();
const iso = (d: Date) => d.toISOString();

interface MfaRow {
  firmId: string;
  ciphertext: string;
  enabledAt: Date | null;
  lastStep: number | null;
  lockedUntil: Date | null;
}

async function loadRow(q: Queryable, userId: string): Promise<MfaRow | null> {
  const { rows } = await q.query<{ firmId: string; ciphertext: string; enabledAt: Date | string | null; lastStep: number | null; lockedUntil: Date | string | null }>(
    `select firm_id as "firmId", secret_ciphertext as ciphertext, enabled_at as "enabledAt", last_step::float8 as "lastStep", locked_until as "lockedUntil"
     from user_mfa where user_id = $1`,
    [userId],
  );
  const r = rows[0];
  return r ? { ...r, enabledAt: r.enabledAt ? new Date(r.enabledAt) : null, lockedUntil: r.lockedUntil ? new Date(r.lockedUntil) : null } : null;
}

export type SecondStep = { ok: true; method: "totp" | "recovery" } | { ok: false; reason: "invalid" | "locked" | "not_enabled" };

/** Count a wrong code. The fifth in a row locks the second step for 15 minutes and starts the count again. Returns whether it locked. */
async function recordFailure(q: Queryable, userId: string, firmId: string, now: Date): Promise<boolean> {
  const { rows } = await q.query<{ locked: boolean }>(
    `update user_mfa set
       failed_attempts = case when failed_attempts + 1 >= $2 then 0 else failed_attempts + 1 end,
       locked_until = case when failed_attempts + 1 >= $2 then $3::timestamptz else locked_until end
     where user_id = $1 returning (failed_attempts = 0) as locked`,
    [userId, MAX_FAILED_ATTEMPTS, iso(new Date(now.getTime() + LOCK_MINUTES * 60_000))],
  );
  const locked = rows[0]?.locked === true;
  if (locked) await q.query("insert into audit_log (firm_id, user_id, action, entity, entity_id) values ($1, $2, 'two_step_locked', 'user', $3)", [firmId, userId, userId]);
  return locked;
}

/**
 * Check a code for a user: an authenticator code (current step, one either side, never one already accepted) or, when allowed, an unused
 * recovery code. A right code resets the failure count; a wrong one counts, and the fifth locks for 15 minutes. While locked, nothing is
 * checked and nothing more is counted.
 */
async function checkSecondStep(q: Queryable, userId: string, code: string, o: MfaOptions, rules: { requireEnabled: boolean; recovery: boolean }): Promise<SecondStep> {
  const now = nowOf(o);
  const row = await loadRow(q, userId);
  if (!row || (rules.requireEnabled && !row.enabledAt)) return { ok: false, reason: "not_enabled" };
  if (row.lockedUntil && row.lockedUntil.getTime() > now.getTime()) return { ok: false, reason: "locked" };

  const typed = normaliseCode(code);
  if (typed) {
    const step = verifyTotp(decryptSecret(row.ciphertext, keyOf(o), userId), typed, now.getTime(), row.lastStep);
    if (step !== null) {
      // Claim the step in the same statement that checks it is newer, so two requests with the same code cannot both pass.
      const claimed = await q.query(
        "update user_mfa set last_step = $2, failed_attempts = 0, locked_until = null where user_id = $1 and (last_step is null or last_step < $2) returning user_id",
        [userId, step],
      );
      if (claimed.rows.length > 0) return { ok: true, method: "totp" };
    }
  } else if (rules.recovery && normaliseRecoveryCode(code)) {
    const { rows } = await q.query<{ id: string; salt: string; hash: string }>("select id, salt, code_hash as hash from mfa_recovery_codes where user_id = $1 and used_at is null", [userId]);
    const hit = rows.find((r) => verifyRecoveryCode(code, { salt: r.salt, hash: r.hash }));
    if (hit) {
      const used = await q.query("update mfa_recovery_codes set used_at = $2 where id = $1 and used_at is null returning id", [hit.id, iso(now)]);
      if (used.rows.length > 0) {
        await q.query("update user_mfa set failed_attempts = 0, locked_until = null where user_id = $1", [userId]);
        return { ok: true, method: "recovery" };
      }
    }
  }
  return { ok: false, reason: (await recordFailure(q, userId, row.firmId, now)) ? "locked" : "invalid" };
}

const refusal = (r: Extract<SecondStep, { ok: false }>): AuthError => new AuthError(r.reason === "locked" ? MESSAGES.locked : r.reason === "not_enabled" ? MESSAGES.notEnabled : MESSAGES.invalid);

async function insertRecoveryCodes(q: Queryable, userId: string, firmId: string, now: Date): Promise<string[]> {
  const codes = generateRecoveryCodes();
  for (const code of codes) {
    const { salt, hash } = hashRecoveryCode(code);
    await q.query("insert into mfa_recovery_codes (user_id, firm_id, code_hash, salt, created_at) values ($1, $2, $3, $4, $5)", [userId, firmId, hash, salt, iso(now)]);
  }
  return codes;
}

// --- Enrolment -----------------------------------------------------------------

export interface Enrolment {
  /** The secret as base32, to show once and to type into an app that cannot scan. */
  secret: string;
  /** The otpauth address for a QR code. */
  uri: string;
}

/** Start enrolment: make a new secret (replacing an unconfirmed one) and return it once. Two-step sign-in is not on until a code is confirmed. */
export async function startEnrolment(db: Db, session: Pick<AuthSession, "userId" | "firmId" | "email">, o: MfaOptions = {}): Promise<Enrolment> {
  const key = keyOf(o); // refuses cleanly, naming the variable, when the key is missing or invalid
  return withAuth(db, async (q) => {
    const user = await q.query<{ active: boolean }>("select active from users where id = $1 and firm_id = $2", [session.userId, session.firmId]);
    if (!user.rows[0]?.active) throw new AuthError("Account not found.");
    const secret = generateSecret();
    const saved = await q.query(
      `insert into user_mfa (user_id, firm_id, secret_ciphertext) values ($1, $2, $3)
       on conflict (user_id) do update set secret_ciphertext = excluded.secret_ciphertext, last_step = null, failed_attempts = 0, locked_until = null, created_at = clock_timestamp()
       where user_mfa.enabled_at is null returning user_id`,
      [session.userId, session.firmId, encryptSecret(secret, key, session.userId)],
    );
    if (saved.rows.length === 0) throw new AuthError("Two-step sign-in is already on. Turn it off first.");
    return { secret: base32Encode(secret), uri: otpauthUri(ISSUER, session.email, secret) };
  });
}

async function confirmQ(q: Queryable, session: Pick<AuthSession, "userId" | "firmId">, code: string, o: MfaOptions): Promise<string[] | AuthError> {
  const row = await loadRow(q, session.userId);
  if (!row || row.enabledAt) return new AuthError(row ? "Two-step sign-in is already on." : "Start enrolment first.");
  const result = await checkSecondStep(q, session.userId, code, o, { requireEnabled: false, recovery: false });
  if (!result.ok) return refusal(result);
  const now = nowOf(o);
  await q.query("update user_mfa set enabled_at = $2 where user_id = $1", [session.userId, iso(now)]);
  await q.query("delete from mfa_recovery_codes where user_id = $1", [session.userId]);
  const codes = await insertRecoveryCodes(q, session.userId, session.firmId, now);
  await logUserChange(q, session as AuthSession, "enable_two_step", session.userId);
  return codes;
}

/** Confirm the first code from the app: turns two-step sign-in on and returns the recovery codes, once. */
export async function confirmEnrolment(db: Db, session: Pick<AuthSession, "userId" | "firmId">, code: string, o: MfaOptions = {}): Promise<string[]> {
  const result = await withAuth(db, (q) => confirmQ(q, session, code, o));
  if (result instanceof AuthError) throw result;
  return result;
}

// --- Sign-in's second step -----------------------------------------------------

/**
 * Check the code at sign-in: an authenticator code or an unused recovery code. Never throws for a wrong code; the answer says which kind of
 * failure it was, and the failure is counted. A user with no two-step sign-in gets "not_enabled" without the key being needed.
 */
export async function verifySecondStep(db: Db, userId: string, code: string, o: MfaOptions = {}): Promise<SecondStep> {
  return withAuth(db, (q) => checkSecondStep(q, userId, code, o, { requireEnabled: true, recovery: true }));
}

// --- Turning it off, resetting it, new recovery codes ---------------------------

async function disableQ(q: Queryable, session: Pick<AuthSession, "userId" | "firmId">, password: string, code: string, o: MfaOptions): Promise<null | AuthError> {
  const { rows } = await q.query<{ passwordHash: string | null }>('select password_hash as "passwordHash" from users where id = $1 and firm_id = $2 and active', [session.userId, session.firmId]);
  if (!rows[0] || !(await verifyPassword(password, rows[0].passwordHash))) return new AuthError("Your password is incorrect.");
  const result = await checkSecondStep(q, session.userId, code, o, { requireEnabled: true, recovery: true });
  if (!result.ok) return refusal(result);
  await q.query("delete from mfa_recovery_codes where user_id = $1", [session.userId]);
  await q.query("delete from user_mfa where user_id = $1", [session.userId]);
  await logUserChange(q, session as AuthSession, "disable_two_step", session.userId);
  return null;
}

/** The user turns their own two-step sign-in off, with their password and a current code (or a recovery code). */
export async function disableMfa(db: Db, session: Pick<AuthSession, "userId" | "firmId">, password: string, code: string, o: MfaOptions = {}): Promise<void> {
  const result = await withAuth(db, (q) => disableQ(q, session, password, code, o));
  if (result instanceof AuthError) throw result;
}

/** An administrator removes a colleague's second step (a lost phone and no recovery codes). Same firm only; the reset is logged. */
export async function adminResetMfa(db: Db, admin: AuthSession, userId: string): Promise<void> {
  await withAuth(db, async (q) => {
    await requireAdmin(q, admin);
    await targetUser(q, admin, userId);
    const gone = await q.query("delete from user_mfa where user_id = $1 and firm_id = $2 returning user_id", [userId, admin.firmId]);
    if (gone.rows.length === 0) throw new AuthError("Two-step sign-in is not on for this user.");
    await q.query("delete from mfa_recovery_codes where user_id = $1", [userId]);
    await q.query("delete from pending_sign_ins where user_id = $1", [userId]);
    await logUserChange(q, admin, "reset_two_step", userId);
  });
}

async function regenerateQ(q: Queryable, session: Pick<AuthSession, "userId" | "firmId">, code: string, o: MfaOptions): Promise<string[] | AuthError> {
  const result = await checkSecondStep(q, session.userId, code, o, { requireEnabled: true, recovery: true });
  if (!result.ok) return refusal(result);
  await q.query("delete from mfa_recovery_codes where user_id = $1", [session.userId]);
  const codes = await insertRecoveryCodes(q, session.userId, session.firmId, nowOf(o));
  await logUserChange(q, session as AuthSession, "regenerate_recovery_codes", session.userId);
  return codes;
}

/** Replace the user's recovery codes with ten new ones, returned once. The old ones stop working. Needs a current code. */
export async function regenerateRecoveryCodes(db: Db, session: Pick<AuthSession, "userId" | "firmId">, code: string, o: MfaOptions = {}): Promise<string[]> {
  const result = await withAuth(db, (q) => regenerateQ(q, session, code, o));
  if (result instanceof AuthError) throw result;
  return result;
}
