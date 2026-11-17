import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "../src/server/db";
import { openDatabase, withAuth, withFirm } from "../src/server/db";
import * as auth from "../src/server/auth";
import { adminResetMfa, confirmEnrolment, disableMfa, regenerateRecoveryCodes, startEnrolment, verifySecondStep } from "../src/server/mfa";
import { base32Decode, stepOf, totp } from "../src/domain/totp";
import { HostedConfigError } from "../src/server/config";

const FIRM_A = "aaaaaaaa-9999-4000-8000-000000000001";
const FIRM_B = "bbbbbbbb-9999-4000-8000-000000000001";
const PASSWORD = "invented-passphrase-1";
const people = [
  { id: "aaaaaaaa-9999-4000-8000-000000000011", firm: FIRM_A, role: "admin", name: "Ada Admin", email: "ada@a.test" },
  { id: "aaaaaaaa-9999-4000-8000-000000000012", firm: FIRM_A, role: "preparer", name: "Pia Preparer", email: "pia@a.test" },
  { id: "aaaaaaaa-9999-4000-8000-000000000013", firm: FIRM_A, role: "partner", name: "Pat Partner", email: "pat@a.test" },
  { id: "bbbbbbbb-9999-4000-8000-000000000011", firm: FIRM_B, role: "admin", name: "Ben Admin", email: "ben@b.test" },
] as const;
const session = (p: (typeof people)[number]): auth.AuthSession => ({ firmId: p.firm, userId: p.id, name: p.name, email: p.email, role: p.role, firmName: "Firm" });
const [ada, pia, pat, ben] = people.map(session);

const key = randomBytes(32);
const T0 = new Date("2026-06-01T10:00:00Z");
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);
let db: Db;

const codeAt = (secret: string, at: Date, offset = 0) => totp(base32Decode(secret)!, stepOf(at.getTime()) + offset);
const wrong = (secret: string, at: Date) => {
  const right = new Set([-1, 0, 1].map((o) => codeAt(secret, at, o)));
  for (let n = 0; n < 1000; n++) {
    const c = String(n).padStart(6, "0");
    if (!right.has(c)) return c;
  }
  throw new Error("unreachable");
};
const row = async (userId: string) => (await db.query<Record<string, unknown>>("select * from user_mfa where user_id = $1", [userId])).rows[0];
const count = async (sql: string, params: unknown[] = []) => Number((await db.query<{ n: string }>(sql, params)).rows[0].n);
const enrol = async (s: auth.AuthSession, at = T0) => {
  const e = await startEnrolment(db, s, { key, now: at });
  const codes = await confirmEnrolment(db, s, codeAt(e.secret, at), { key, now: at });
  return { secret: e.secret, codes };
};

beforeAll(async () => {
  db = await openDatabase();
  await db.query("insert into firms (id, name) values ($1, 'Firm A'), ($2, 'Firm B')", [FIRM_A, FIRM_B]);
  for (const p of people) {
    await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [p.id, p.firm, p.email, p.name, p.role]);
    await auth.setPassword(db, p.id, PASSWORD);
  }
});

afterAll(async () => {
  await db.close();
});

describe("enrolment", () => {
  it("makes an unconfirmed secret that is stored encrypted and does not count as two-step sign-in", async () => {
    const e = await startEnrolment(db, pia, { key, now: T0 });
    expect(e.secret).toMatch(/^[A-Z2-7]{32}$/);
    const uri = new URL(e.uri);
    expect(uri.searchParams.get("secret")).toBe(e.secret);
    expect(decodeURIComponent(uri.pathname)).toBe("/LedgerFile:pia@a.test");
    const stored = await row(pia.userId);
    expect(stored).toMatchObject({ firm_id: FIRM_A, enabled_at: null, last_step: null, failed_attempts: 0 });
    expect(String(stored.secret_ciphertext)).toMatch(/^v1:/);
    expect(String(stored.secret_ciphertext)).not.toContain(e.secret);
    expect(await verifySecondStep(db, pia.userId, codeAt(e.secret, T0), { key, now: T0 })).toEqual({ ok: false, reason: "not_enabled" });
  });

  it("replaces an unconfirmed secret, and the old secret's code no longer confirms", async () => {
    const first = await startEnrolment(db, pia, { key, now: T0 });
    const second = await startEnrolment(db, pia, { key, now: T0 });
    expect(second.secret).not.toBe(first.secret);
    await expect(confirmEnrolment(db, pia, codeAt(first.secret, T0), { key, now: T0 })).rejects.toThrow(/not right/);
  });

  it("counts a wrong confirmation, and a right one turns it on and returns ten recovery codes once", async () => {
    const e = await startEnrolment(db, pia, { key, now: T0 });
    await expect(confirmEnrolment(db, pia, wrong(e.secret, T0), { key, now: T0 })).rejects.toThrow(/That code is not right/);
    expect(Number((await row(pia.userId)).failed_attempts)).toBe(1);

    const codes = await confirmEnrolment(db, pia, codeAt(e.secret, T0), { key, now: T0 });
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    const after = await row(pia.userId);
    expect(after.enabled_at).not.toBeNull();
    expect(Number(after.failed_attempts)).toBe(0);
    expect(Number(after.last_step)).toBe(stepOf(T0.getTime()));
    expect(await count("select count(*) as n from mfa_recovery_codes where user_id = $1 and used_at is null", [pia.userId])).toBe(10);
    // Only hashes are stored.
    const stored = (await db.query<{ code_hash: string; salt: string }>("select code_hash, salt from mfa_recovery_codes where user_id = $1", [pia.userId])).rows;
    for (const s of stored) for (const c of codes) expect(JSON.stringify(s)).not.toContain(c.replace(/-/g, ""));
  });

  it("refuses to start again while it is on, and to confirm twice", async () => {
    await expect(startEnrolment(db, pia, { key })).rejects.toThrow(/already on/);
    await expect(confirmEnrolment(db, pia, "123456", { key })).rejects.toThrow(/already on/);
    await expect(confirmEnrolment(db, ada, "123456", { key })).rejects.toThrow(/Start enrolment first/);
  });
});

describe("the second step", () => {
  let secret: string;
  let codes: string[];
  beforeAll(async () => {
    ({ secret, codes } = await enrol(pat));
  });

  it("does not accept the code that confirmed enrolment again (it was already used), but accepts the next step's", async () => {
    expect(await verifySecondStep(db, pat.userId, codeAt(secret, T0), { key, now: T0 })).toEqual({ ok: false, reason: "invalid" });
    expect(await verifySecondStep(db, pat.userId, codeAt(secret, T0, 1), { key, now: T0 })).toEqual({ ok: true, method: "totp" });
  });

  it("refuses a code that has been used, even within its window, and accepts a later one", async () => {
    const t = minutes(10);
    expect(await verifySecondStep(db, pat.userId, codeAt(secret, t), { key, now: t })).toEqual({ ok: true, method: "totp" });
    expect(await verifySecondStep(db, pat.userId, codeAt(secret, t), { key, now: t })).toEqual({ ok: false, reason: "invalid" });
    // The step before it is also refused: steps only move forward.
    expect(await verifySecondStep(db, pat.userId, codeAt(secret, t, -1), { key, now: t })).toEqual({ ok: false, reason: "invalid" });
    const later = minutes(11);
    expect(await verifySecondStep(db, pat.userId, codeAt(secret, later), { key, now: later })).toEqual({ ok: true, method: "totp" });
  });

  it("accepts a recovery code once, however it is typed, and never again", async () => {
    const t = minutes(20);
    const typed = codes[0].toUpperCase().replace(/-/g, " ");
    expect(await verifySecondStep(db, pat.userId, typed, { key, now: t })).toEqual({ ok: true, method: "recovery" });
    expect(await verifySecondStep(db, pat.userId, codes[0], { key, now: t })).toEqual({ ok: false, reason: "invalid" });
    expect(await count("select count(*) as n from mfa_recovery_codes where user_id = $1 and used_at is not null", [pat.userId])).toBe(1);
    expect(await verifySecondStep(db, pat.userId, codes[1], { key, now: t })).toEqual({ ok: true, method: "recovery" });
  });

  it("locks for 15 minutes after five wrong codes, does not check while locked, and opens again after", async () => {
    const t = minutes(30);
    for (let i = 1; i <= 4; i++) expect(await verifySecondStep(db, pat.userId, wrong(secret, t), { key, now: t })).toEqual({ ok: false, reason: "invalid" });
    expect(Number((await row(pat.userId)).failed_attempts)).toBe(4);
    expect(await verifySecondStep(db, pat.userId, wrong(secret, t), { key, now: t })).toEqual({ ok: false, reason: "locked" });
    expect(await count("select count(*) as n from audit_log where action = 'two_step_locked' and entity_id = $1", [pat.userId])).toBe(1);
    // While locked even the right code is refused, and nothing more is counted.
    expect(await verifySecondStep(db, pat.userId, codeAt(secret, t), { key, now: minutes(40) })).toEqual({ ok: false, reason: "locked" });
    expect(Number((await row(pat.userId)).failed_attempts)).toBe(0);
    const open = minutes(46);
    expect(await verifySecondStep(db, pat.userId, codeAt(secret, open), { key, now: open })).toEqual({ ok: true, method: "totp" });
    expect((await row(pat.userId)).locked_until).toBeNull();
  });

  it("starts the count again after a right code", async () => {
    const t = minutes(60);
    await verifySecondStep(db, pat.userId, wrong(secret, t), { key, now: t });
    await verifySecondStep(db, pat.userId, wrong(secret, t), { key, now: t });
    expect(Number((await row(pat.userId)).failed_attempts)).toBe(2);
    expect((await verifySecondStep(db, pat.userId, codeAt(secret, t), { key, now: t })).ok).toBe(true);
    expect(Number((await row(pat.userId)).failed_attempts)).toBe(0);
  });

  it("says a user with no two-step sign-in has none, and does not need the key to say so", async () => {
    vi.stubEnv("MFA_ENCRYPTION_KEY", "");
    try {
      expect(await verifySecondStep(db, ada.userId, "123456")).toEqual({ ok: false, reason: "not_enabled" });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("regenerating recovery codes", () => {
  it("needs a current code, replaces all ten, and the old ones stop working", async () => {
    const { secret, codes } = await enrol(ada, T0);
    await expect(regenerateRecoveryCodes(db, ada, wrong(secret, minutes(5)), { key, now: minutes(5) })).rejects.toThrow(/not right/);
    const t = minutes(6);
    const fresh = await regenerateRecoveryCodes(db, ada, codeAt(secret, t), { key, now: t });
    expect(fresh).toHaveLength(10);
    expect(fresh.some((c) => codes.includes(c))).toBe(false);
    expect(await verifySecondStep(db, ada.userId, codes[0], { key, now: t })).toEqual({ ok: false, reason: "invalid" });
    expect(await verifySecondStep(db, ada.userId, fresh[0], { key, now: t })).toEqual({ ok: true, method: "recovery" });
    expect(await count("select count(*) as n from mfa_recovery_codes where user_id = $1", [ada.userId])).toBe(10);
    expect(await count("select count(*) as n from audit_log where action = 'regenerate_recovery_codes' and entity_id = $1", [ada.userId])).toBe(1);
  });
});

describe("turning it off", () => {
  it("needs the password and a code, removes the secret and the codes, and logs it", async () => {
    const { secret } = await enrol(ben, T0);
    await expect(disableMfa(db, ben, "wrong password here", codeAt(secret, minutes(2)), { key, now: minutes(2) })).rejects.toThrow(/password is incorrect/);
    await expect(disableMfa(db, ben, PASSWORD, wrong(secret, minutes(2)), { key, now: minutes(2) })).rejects.toThrow(/not right/);
    expect(await row(ben.userId)).toBeTruthy();
    const t = minutes(3);
    await disableMfa(db, ben, PASSWORD, codeAt(secret, t), { key, now: t });
    expect(await row(ben.userId)).toBeUndefined();
    expect(await count("select count(*) as n from mfa_recovery_codes where user_id = $1", [ben.userId])).toBe(0);
    expect(await count("select count(*) as n from audit_log where action = 'disable_two_step' and entity_id = $1", [ben.userId])).toBe(1);
    await expect(disableMfa(db, ben, PASSWORD, "123456", { key })).rejects.toThrow(/not on for this account/);
  });
});

describe("an administrator's reset", () => {
  it("removes a colleague's second step in the same firm, and logs it as the administrator's act", async () => {
    await expect(adminResetMfa(db, pia, pat.userId)).rejects.toThrow(/Only an administrator/);
    await expect(adminResetMfa(db, pat, pia.userId)).rejects.toThrow(/Only an administrator/);
    await adminResetMfa(db, ada, pia.userId);
    expect(await row(pia.userId)).toBeUndefined();
    expect(await count("select count(*) as n from mfa_recovery_codes where user_id = $1", [pia.userId])).toBe(0);
    const log = (await db.query<{ user_id: string; entity: string; entity_id: string; firm_id: string }>("select user_id, entity, entity_id, firm_id from audit_log where action = 'reset_two_step'")).rows;
    expect(log).toEqual([{ user_id: ada.userId, entity: "user", entity_id: pia.userId, firm_id: FIRM_A }]);
    await expect(adminResetMfa(db, ada, pia.userId)).rejects.toThrow(/not on for this user/);
  });

  it("cannot reach a user of another firm", async () => {
    await enrol(ben, minutes(120));
    await expect(adminResetMfa(db, ada, ben.userId)).rejects.toThrow(/User not found/);
    expect(await row(ben.userId)).toBeTruthy();
    await adminResetMfa(db, ben, ben.userId);
  });
});

describe("no secret is ever logged", () => {
  it("keeps secrets, codes and recovery codes out of the audit log", async () => {
    const { secret, codes } = await enrol(pia, minutes(200));
    const log = JSON.stringify((await db.query("select action, entity, entity_id, detail from audit_log")).rows);
    expect(log).toContain("enable_two_step");
    expect(log).not.toContain(secret);
    for (const c of codes) expect(log).not.toContain(c);
    expect(log).not.toContain(key.toString("base64"));
    expect(log).not.toMatch(/v1:/);
  });
});

describe("a deployment without the key", () => {
  it("refuses to enrol, naming the variable, and writes nothing", async () => {
    vi.stubEnv("MFA_ENCRYPTION_KEY", "");
    try {
      await expect(startEnrolment(db, ben)).rejects.toThrow(HostedConfigError);
      await expect(startEnrolment(db, ben)).rejects.toThrow(/MFA_ENCRYPTION_KEY is not set/);
    } finally {
      vi.unstubAllEnvs();
    }
    expect(await row(ben.userId)).toBeUndefined();
  });
});

describe("who can see and change what", () => {
  const as = <R,>(firm: string, fn: (tx: Parameters<Parameters<typeof withFirm>[2]>[0]) => Promise<R>) => withFirm(db, firm, fn);

  it("lets tenant work read only the non-secret columns, and only its own firm's rows", async () => {
    await enrol(pat, minutes(300)).catch(() => undefined);
    const mine = await as(FIRM_A, async (tx) => (await tx.query<{ user_id: string; enabled_at: unknown }>("select user_id, enabled_at from user_mfa")).rows);
    expect(mine.length).toBeGreaterThan(0);
    expect((await row(pia.userId)) !== undefined).toBe(true);
    expect(await as(FIRM_B, async (tx) => (await tx.query("select user_id, enabled_at from user_mfa where user_id = $1", [pia.userId])).rows)).toHaveLength(0);
    expect(await as(FIRM_B, async (tx) => (await tx.query("select id, used_at from mfa_recovery_codes where user_id = $1", [pia.userId])).rows)).toHaveLength(0);
  });

  it("refuses tenant work the secret, the ciphertext, the hashes, the counters and any select *", async () => {
    for (const sql of [
      "select secret_ciphertext from user_mfa",
      "select last_step from user_mfa",
      "select failed_attempts from user_mfa",
      "select locked_until from user_mfa",
      "select * from user_mfa",
      "select code_hash from mfa_recovery_codes",
      "select salt from mfa_recovery_codes",
      "select * from mfa_recovery_codes",
      "select * from pending_sign_ins",
    ]) {
      await expect(as(FIRM_A, (tx) => tx.query(sql)), sql).rejects.toThrow(/permission denied/);
    }
  });

  it("refuses tenant work any write to these tables", async () => {
    await expect(as(FIRM_A, (tx) => tx.query("delete from user_mfa"))).rejects.toThrow(/permission denied/);
    await expect(as(FIRM_A, (tx) => tx.query("update user_mfa set failed_attempts = 0"))).rejects.toThrow(/permission denied/);
    await expect(as(FIRM_A, (tx) => tx.query("insert into mfa_recovery_codes (user_id, firm_id, code_hash, salt) values ($1, $2, repeat('a', 64), repeat('b', 32))", [pia.userId, FIRM_A]))).rejects.toThrow(/permission denied/);
  });

  it("lets the sign-in role do what the second step needs, and nothing it should not", async () => {
    await withAuth(db, async (q) => {
      expect((await q.query("select secret_ciphertext, enabled_at, last_step, failed_attempts, locked_until from user_mfa")).rows.length).toBeGreaterThan(0);
      await q.query("update user_mfa set failed_attempts = failed_attempts where true");
      expect((await q.query("select id, code_hash, salt, used_at from mfa_recovery_codes")).rows.length).toBeGreaterThan(0);
      await q.query("update mfa_recovery_codes set used_at = used_at where true");
      expect((await q.query("select mfa_required from firms")).rows.every((r: { mfa_required: boolean }) => r.mfa_required === false)).toBe(true);
      // The pending sign-in table: insert, read, update, delete.
      await q.query("insert into pending_sign_ins (token_hash, user_id, firm_id, expires_at) values (repeat('c', 64), $1, $2, $3)", [pat.userId, FIRM_A, new Date(T0.getTime() + 600_000).toISOString()]);
      expect((await q.query("select attempts from pending_sign_ins where token_hash = repeat('c', 64)")).rows).toEqual([{ attempts: 0 }]);
      await q.query("update pending_sign_ins set attempts = attempts + 1 where token_hash = repeat('c', 64)");
      await q.query("delete from pending_sign_ins where token_hash = repeat('c', 64)");
    });
  });

  it("ties a row to a user of the same firm", async () => {
    await expect(db.query("insert into user_mfa (user_id, firm_id, secret_ciphertext) values ($1, $2, 'v1:AAAA:AAAA:AAAA')", [people[1].id, FIRM_B])).rejects.toThrow();
  });

  it("starts every firm with the requirement off", async () => {
    expect((await db.query<{ mfa_required: boolean }>("select mfa_required from firms")).rows.every((r) => r.mfa_required === false)).toBe(true);
  });
});
