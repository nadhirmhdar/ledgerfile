import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/server/db";
import { openDatabase, withFirm } from "../src/server/db";
import * as auth from "../src/server/auth";

// Throwaway values used only inside this in-memory test database.
const PASSWORD = "correct-horse-battery";
const OTHER = "another-long-passphrase";

let db: Db;
let firmA: { firmId: string; userId: string };
let firmB: { firmId: string; userId: string };

beforeAll(async () => {
  db = await openDatabase();
  firmA = await auth.signUp(db, { firmName: "Alpha Audit", name: "Aisha Admin", email: "Aisha@Alpha.test", password: PASSWORD });
  firmB = await auth.signUp(db, { firmName: "Beta Audit", name: "Bilal Admin", email: "bilal@beta.test", password: OTHER });
}, 30000);

describe("passwords", () => {
  it("hashes with a random salt and verifies", async () => {
    const one = await auth.hashPassword(PASSWORD);
    const two = await auth.hashPassword(PASSWORD);
    expect(one).not.toBe(two);
    expect(one).not.toContain(PASSWORD);
    expect(await auth.verifyPassword(PASSWORD, one)).toBe(true);
    expect(await auth.verifyPassword(PASSWORD + "x", one)).toBe(false);
    expect(await auth.verifyPassword(PASSWORD, null)).toBe(false);
    expect(await auth.verifyPassword(PASSWORD, "garbage")).toBe(false);
  });
});

describe("sign-up", () => {
  it("creates a firm with an administrator", async () => {
    const team = await auth.listTeam(db, firmA.firmId);
    expect(team).toEqual([{ id: firmA.userId, name: "Aisha Admin", email: "aisha@alpha.test", role: "admin", active: true }]);
  });

  it("rejects a duplicate email regardless of case, a weak password and a bad email", async () => {
    await expect(auth.signUp(db, { firmName: "Copy", name: "Copy Cat", email: "AISHA@alpha.test", password: PASSWORD })).rejects.toThrow(/already exists/);
    await expect(auth.signUp(db, { firmName: "Weak", name: "Weak One", email: "weak@x.test", password: "short" })).rejects.toThrow(/at least 10/);
    await expect(auth.signUp(db, { firmName: "Bad", name: "Bad Mail", email: "not-an-email", password: PASSWORD })).rejects.toThrow(/valid email/);
    expect((await db.query("select id from firms")).rows).toHaveLength(2);
  });
});

describe("sign-in and sessions", () => {
  it("signs in with any email casing and resolves the session", async () => {
    const token = await auth.signIn(db, " aisha@ALPHA.test ", PASSWORD);
    const session = await auth.getSessionByToken(db, token);
    expect(session).toEqual({ firmId: firmA.firmId, userId: firmA.userId, name: "Aisha Admin", email: "aisha@alpha.test", role: "admin", firmName: "Alpha Audit" });
    // Only a hash of the token is stored.
    const stored = await db.query<{ token_hash: string }>("select token_hash from sessions");
    expect(stored.rows.some((r) => r.token_hash === token)).toBe(false);
  });

  it("gives the same error for a wrong password and an unknown email", async () => {
    const wrong = await auth.signIn(db, "bilal@beta.test", "wrong-password-1").catch((e) => e.message);
    const unknown = await auth.signIn(db, "nobody@nowhere.test", "wrong-password-1").catch((e) => e.message);
    expect(wrong).toBe("The email address or password is incorrect.");
    expect(unknown).toBe(wrong);
  });

  it("rejects unknown, missing and expired tokens, and ends a session on sign-out", async () => {
    expect(await auth.getSessionByToken(db, undefined)).toBeNull();
    expect(await auth.getSessionByToken(db, "made-up-token")).toBeNull();

    const token = await auth.signIn(db, "bilal@beta.test", OTHER);
    await db.query("update sessions set expires_at = now() - interval '1 minute' where user_id = $1", [firmB.userId]);
    expect(await auth.getSessionByToken(db, token)).toBeNull();

    const fresh = await auth.signIn(db, "bilal@beta.test", OTHER);
    expect(await auth.getSessionByToken(db, fresh)).not.toBeNull();
    await auth.signOut(db, fresh);
    expect(await auth.getSessionByToken(db, fresh)).toBeNull();
  });

  it("locks the account after repeated failures, even for the right password, then unlocks", async () => {
    for (let i = 0; i < auth.MAX_FAILED_ATTEMPTS; i++) {
      await expect(auth.signIn(db, "bilal@beta.test", "wrong-password-1")).rejects.toThrow(/incorrect/);
    }
    await expect(auth.signIn(db, "bilal@beta.test", OTHER)).rejects.toThrow(/locked/);
    await db.query("update users set locked_until = now() - interval '1 minute' where id = $1", [firmB.userId]);
    expect(await auth.signIn(db, "bilal@beta.test", OTHER)).toBeTruthy();
  }, 30000);

  it("replacing a password ends existing sessions", async () => {
    const token = await auth.signIn(db, "bilal@beta.test", OTHER);
    await auth.setPassword(db, firmB.userId, "a-brand-new-passphrase");
    expect(await auth.getSessionByToken(db, token)).toBeNull();
    await expect(auth.signIn(db, "bilal@beta.test", OTHER)).rejects.toThrow(/incorrect/);
    await auth.setPassword(db, firmB.userId, OTHER);
  });
});

describe("team management", () => {
  it("lets an administrator add a colleague, who can then sign in to the same firm", async () => {
    const admin = (await auth.getSessionByToken(db, await auth.signIn(db, "aisha@alpha.test", PASSWORD)))!;
    await auth.addUser(db, admin, { name: "Rana Reviewer", email: "rana@alpha.test", role: "reviewer", password: PASSWORD });
    const session = await auth.getSessionByToken(db, await auth.signIn(db, "rana@alpha.test", PASSWORD));
    expect(session).toMatchObject({ firmId: firmA.firmId, role: "reviewer", firmName: "Alpha Audit" });
    expect((await auth.listTeam(db, firmA.firmId)).map((u) => u.name)).toEqual(["Aisha Admin", "Rana Reviewer"]);
    expect(await auth.listTeam(db, firmB.firmId)).toHaveLength(1);
  });

  it("refuses non-administrators, unknown roles and emails used at another firm", async () => {
    const reviewer = (await auth.getSessionByToken(db, await auth.signIn(db, "rana@alpha.test", PASSWORD)))!;
    await expect(auth.addUser(db, reviewer, { name: "Sneaky", email: "s@alpha.test", role: "admin", password: PASSWORD })).rejects.toThrow(/Only an administrator/);
    // A forged session object claiming the admin role is checked against the database.
    await expect(auth.addUser(db, { ...reviewer, role: "admin" }, { name: "Sneaky", email: "s@alpha.test", role: "admin", password: PASSWORD })).rejects.toThrow(/Only an administrator/);

    const admin = (await auth.getSessionByToken(db, await auth.signIn(db, "aisha@alpha.test", PASSWORD)))!;
    await expect(auth.addUser(db, admin, { name: "Odd Role", email: "o@alpha.test", role: "owner", password: PASSWORD })).rejects.toThrow(/Choose a role/);
    await expect(auth.addUser(db, admin, { name: "Bilal Copy", email: "bilal@beta.test", role: "preparer", password: PASSWORD })).rejects.toThrow(/already exists/);
  });
});

describe("what the application role can reach", () => {
  it("cannot read password hashes, sessions, or change users", async () => {
    await expect(withFirm(db, firmA.firmId, (tx) => tx.query("select password_hash from users"))).rejects.toThrow(/permission denied/);
    await expect(withFirm(db, firmA.firmId, (tx) => tx.query("select * from users"))).rejects.toThrow(/permission denied/);
    await expect(withFirm(db, firmA.firmId, (tx) => tx.query("select * from sessions"))).rejects.toThrow(/permission denied/);
    await expect(withFirm(db, firmA.firmId, (tx) => tx.query("update users set role = 'admin'"))).rejects.toThrow(/permission denied/);
    await expect(
      withFirm(db, firmA.firmId, (tx) => tx.query("insert into users (firm_id, email, name, role) values ($1, 'x@x.test', 'X', 'admin')", [firmA.firmId])),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("managing existing users", () => {
  const admin = async () => (await auth.getSessionByToken(db, await auth.signIn(db, "aisha@alpha.test", PASSWORD)))!;
  const idOf = async (email: string) => (await db.query<{ id: string }>("select id from users where email = $1", [email])).rows[0].id;

  it("lets a user change their own password, ending every session", async () => {
    const token = await auth.signIn(db, "rana@alpha.test", PASSWORD);
    const session = (await auth.getSessionByToken(db, token))!;
    await expect(auth.changeOwnPassword(db, session, "not-my-password", "a-new-passphrase-1")).rejects.toThrow(/current password is incorrect/);
    await expect(auth.changeOwnPassword(db, session, PASSWORD, PASSWORD)).rejects.toThrow(/different/);
    await expect(auth.changeOwnPassword(db, session, PASSWORD, "short")).rejects.toThrow(/at least 10/);
    await auth.changeOwnPassword(db, session, PASSWORD, "a-new-passphrase-1");
    expect(await auth.getSessionByToken(db, token)).toBeNull();
    await expect(auth.signIn(db, "rana@alpha.test", PASSWORD)).rejects.toThrow(/incorrect/);
    expect(await auth.signIn(db, "rana@alpha.test", "a-new-passphrase-1")).toBeTruthy();
  });

  it("lets an administrator reset a colleague's password, but not a user of another firm", async () => {
    const a = await admin();
    const rana = await idOf("rana@alpha.test");
    await auth.resetUserPassword(db, a, rana, PASSWORD);
    expect(await auth.signIn(db, "rana@alpha.test", PASSWORD)).toBeTruthy();
    await expect(auth.resetUserPassword(db, a, firmB.userId, "taken-over-password")).rejects.toThrow(/User not found/);
    expect(await auth.signIn(db, "bilal@beta.test", OTHER)).toBeTruthy();
  });

  it("changes roles, but never leaves a firm without an administrator", async () => {
    const a = await admin();
    const rana = await idOf("rana@alpha.test");
    await expect(auth.setUserRole(db, a, a.userId, "partner")).rejects.toThrow(/at least one administrator/);
    await expect(auth.setUserRole(db, a, rana, "owner")).rejects.toThrow(/Choose a role/);
    await expect(auth.setUserRole(db, a, firmB.userId, "preparer")).rejects.toThrow(/User not found/);
    await auth.setUserRole(db, a, rana, "admin");
    // With a second administrator, the first can step down.
    await auth.setUserRole(db, a, a.userId, "partner");
    await expect(auth.setUserRole(db, a, rana, "preparer")).rejects.toThrow(/Only an administrator/);
    const ranaSession = (await auth.getSessionByToken(db, await auth.signIn(db, "rana@alpha.test", PASSWORD)))!;
    await auth.setUserRole(db, ranaSession, a.userId, "admin");
    await auth.setUserRole(db, await admin(), rana, "reviewer");
  });

  it("deactivates a user: signed out, cannot sign in, still listed; and reactivates", async () => {
    const a = await admin();
    const rana = await idOf("rana@alpha.test");
    const token = await auth.signIn(db, "rana@alpha.test", PASSWORD);
    await expect(auth.setUserActive(db, a, a.userId, false)).rejects.toThrow(/your own account/);
    await expect(auth.setUserActive(db, a, firmB.userId, false)).rejects.toThrow(/User not found/);

    await auth.setUserActive(db, a, rana, false);
    expect(await auth.getSessionByToken(db, token)).toBeNull();
    // The same message as a wrong password, so a deactivated account is not revealed.
    await expect(auth.signIn(db, "rana@alpha.test", PASSWORD)).rejects.toThrow(/email address or password is incorrect/);
    expect((await auth.listTeam(db, firmA.firmId)).find((u) => u.id === rana)).toMatchObject({ active: false });

    await auth.setUserActive(db, a, rana, true);
    expect(await auth.signIn(db, "rana@alpha.test", PASSWORD)).toBeTruthy();
  });

  it("refuses all of it to non-administrators", async () => {
    const reviewer = (await auth.getSessionByToken(db, await auth.signIn(db, "rana@alpha.test", PASSWORD)))!;
    await expect(auth.setUserRole(db, reviewer, reviewer.userId, "admin")).rejects.toThrow(/Only an administrator/);
    await expect(auth.setUserActive(db, reviewer, firmA.userId, false)).rejects.toThrow(/Only an administrator/);
    await expect(auth.resetUserPassword(db, { ...reviewer, role: "admin" }, firmA.userId, "stolen-password-1")).rejects.toThrow(/Only an administrator/);
  });
});
