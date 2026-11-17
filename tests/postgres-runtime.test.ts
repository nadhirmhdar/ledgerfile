import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as auth from "../src/server/auth";
import { withFirm, type Db } from "../src/server/db";
import { assertSchemaCurrent } from "../src/server/migrations";
import { createPostgresDb } from "../src/server/pg-adapter";
import { describeValue, EXPECTED, typeRoundTrip } from "./pg-roundtrip";

/**
 * Runs only in the CI `postgres` job (or anywhere both URLs are given). It connects as the recommended RUNTIME role, a login role
 * that owns nothing and is a member of app_user and app_auth, to a database that `db:migrate` and docs/hosted-roles.sql have already
 * prepared. Nothing here is a real credential: the role and its password exist only inside the throwaway CI service container.
 */
const URL = process.env.TEST_RUNTIME_DATABASE_URL;
const PASSWORD = "invented-runtime-passphrase";
const suffix = randomBytes(4).toString("hex");

describe.skipIf(!URL)("the Postgres adapter as the runtime role", () => {
  let db: Db;
  let single: Db;
  let a: { firmId: string; userId: string };
  let b: { firmId: string; userId: string };

  beforeAll(async () => {
    db = createPostgresDb(URL!, { max: 4 });
    single = createPostgresDb(URL!, { max: 1 });
    a = await auth.signUp(db, { firmName: "Runtime Alpha", name: "Ada Admin", email: `ada-${suffix}@alpha.test`, password: PASSWORD });
    b = await auth.signUp(db, { firmName: "Runtime Beta", name: "Ben Admin", email: `ben-${suffix}@beta.test`, password: PASSWORD });
  }, 120000);
  afterAll(async () => {
    await db?.close();
    await single?.close();
  });

  it("starts: the database is at the migration this code expects", async () => {
    await expect(assertSchemaCurrent(db)).resolves.toBeUndefined();
  });

  it("returns the same JavaScript values as PGlite for every column type", async () => {
    expect(describeValue(await typeRoundTrip(db))).toEqual(EXPECTED);
  });

  it("connects as a role that owns nothing and cannot bypass row-level security", async () => {
    const me = await db.query<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }>(
      "select current_user, r.rolsuper, r.rolbypassrls from pg_roles r where r.rolname = current_user",
    );
    expect(me.rows[0].rolsuper).toBe(false);
    expect(me.rows[0].rolbypassrls).toBe(false);
    const owned = await db.query("select 1 from pg_tables where schemaname = 'public' and tableowner = current_user");
    expect(owned.rows).toHaveLength(0);
    const roles = await db.query<{ rolname: string; rolbypassrls: boolean; rolsuper: boolean }>("select rolname, rolbypassrls, rolsuper from pg_roles where rolname in ('app_user', 'app_auth')");
    expect(roles.rows).toHaveLength(2);
    for (const r of roles.rows) expect([r.rolbypassrls, r.rolsuper]).toEqual([false, false]);
  });

  it("signs up, signs in, and finds the session", async () => {
    const token = await auth.signIn(db, `ada-${suffix}@alpha.test`, PASSWORD);
    const session = await auth.getSessionByToken(db, token);
    expect(session).toMatchObject({ firmId: a.firmId, userId: a.userId, name: "Ada Admin", role: "admin", firmName: "Runtime Alpha" });
    await expect(auth.signIn(db, `ada-${suffix}@alpha.test`, "wrong-wrong-wrong")).rejects.toThrow("The email address or password is incorrect.");
    await auth.signOut(db, token);
    expect(await auth.getSessionByToken(db, token)).toBeNull();
  });

  it("lets an administrator add a user, and the team lists only that firm", async () => {
    const token = await auth.signIn(db, `ada-${suffix}@alpha.test`, PASSWORD);
    const session = (await auth.getSessionByToken(db, token))!;
    await auth.addUser(db, session, { name: "Pia Preparer", email: `pia-${suffix}@alpha.test`, role: "preparer", password: PASSWORD });
    const teamA = await auth.listTeam(db, a.firmId);
    expect(teamA.map((u) => u.name).sort()).toEqual(["Ada Admin", "Pia Preparer"]);
    expect((await auth.listTeam(db, b.firmId)).map((u) => u.name)).toEqual(["Ben Admin"]);
  });

  it("keeps two firms apart through withFirm", async () => {
    await withFirm(db, a.firmId, (tx) => tx.query("insert into clients (firm_id, name) values ($1, 'Alpha client')", [a.firmId]));
    await withFirm(db, b.firmId, (tx) => tx.query("insert into clients (firm_id, name) values ($1, 'Beta client')", [b.firmId]));
    const seenByA = await withFirm(db, a.firmId, async (tx) => (await tx.query<{ name: string }>("select name from clients order by name")).rows.map((r) => r.name));
    const seenByB = await withFirm(db, b.firmId, async (tx) => (await tx.query<{ name: string }>("select name from clients order by name")).rows.map((r) => r.name));
    expect(seenByA).toEqual(["Alpha client"]);
    expect(seenByB).toEqual(["Beta client"]);
    expect(await withFirm(db, a.firmId, async (tx) => (await tx.query("select 1 from firms")).rows.length)).toBe(1);
    // A firm cannot write a row into another firm.
    await expect(withFirm(db, a.firmId, (tx) => tx.query("insert into clients (firm_id, name) values ($1, 'Smuggled')", [b.firmId]))).rejects.toThrow(/row-level security/);
    // With no firm set, nothing is visible.
    expect(await db.transaction(async (tx) => { await tx.exec("set local role app_user"); return (await tx.query("select 1 from clients")).rows.length; })).toBe(0);
  });

  it("does not let tenant work reach sessions or password hashes", async () => {
    await expect(withFirm(db, a.firmId, (tx) => tx.query("select * from sessions"))).rejects.toThrow(/permission denied/);
    await expect(withFirm(db, a.firmId, (tx) => tx.query("select password_hash from users"))).rejects.toThrow(/permission denied/);
  });

  it("leaves nothing on the connection after a transaction, which is what makes a transaction pooler safe", async () => {
    // One connection, reused: after withFirm and after withAuth the next statement is a plain one again.
    await withFirm(single, a.firmId, async (tx) => (await tx.query("select 1")).rows.length);
    const after = await single.query<{ who: string; firm: string }>("select current_user as who, coalesce(current_setting('app.firm_id', true), '') as firm");
    const login = await single.query<{ who: string }>("select session_user as who");
    expect(after.rows[0].who).toBe(login.rows[0].who);
    expect(after.rows[0].firm).toBe("");
    // A failed transaction also leaves the connection clean.
    await expect(withFirm(single, a.firmId, () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    const again = await single.query<{ who: string; firm: string }>("select current_user as who, coalesce(current_setting('app.firm_id', true), '') as firm");
    expect(again.rows[0]).toEqual({ who: login.rows[0].who, firm: "" });
  });
});
