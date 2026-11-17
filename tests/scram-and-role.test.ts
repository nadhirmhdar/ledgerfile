import { createHash, createHmac, pbkdf2Sync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/server/db";
import { ensureAppRole } from "../src/server/hosted-setup";
import { SCRAM_FORMAT, scramVerifier } from "../src/server/scram";

describe("scramVerifier", () => {
  const salt = Buffer.from("0123456789abcdef");
  it("has the form Postgres stores", () => {
    const v = scramVerifier("a-long-generated-app-password-0001", salt);
    expect(v).toMatch(SCRAM_FORMAT);
    expect(v.startsWith("SCRAM-SHA-256$4096:")).toBe(true);
    expect(v).not.toContain("a-long-generated");
  });
  it("is derived as RFC 5802 says", () => {
    const pw = "pencil-pencil-pencil-pencil";
    const salted = pbkdf2Sync(pw, salt, 4096, 32, "sha256");
    const client = createHmac("sha256", salted).update("Client Key").digest();
    const stored = createHash("sha256").update(client).digest("base64");
    const server = createHmac("sha256", salted).update("Server Key").digest("base64");
    expect(scramVerifier(pw, salt)).toBe(`SCRAM-SHA-256$4096:${salt.toString("base64")}$${stored}:${server}`);
  });
  it("uses a fresh salt each time and depends on the password", () => {
    expect(scramVerifier("same-password-same-password")).not.toBe(scramVerifier("same-password-same-password"));
    expect(scramVerifier("one-password-one-password", salt)).not.toBe(scramVerifier("two-password-two-password", salt));
  });
});

// On a real server the role already exists cluster-wide (made by setup) and the runtime-role test logs in with its password, so this test
// changes only the throwaway PGlite database. CI proves the real-server path by running db:setup-hosted twice.
describe.skipIf(!!process.env.TEST_DATABASE_URL)("ensureAppRole", () => {
  it("creates the runtime role with every restriction, and updates it when run again", async () => {
    const db = await openDatabase();
    const first = await ensureAppRole(db, scramVerifier("a-long-generated-app-password-0001"));
    const second = await ensureAppRole(db, scramVerifier("another-long-generated-password-02"));
    expect([first.created, second.created]).toEqual([true, false]);
    const { rows } = await db.query<Record<string, boolean>>(
      "select rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolbypassrls from pg_roles where rolname = 'ledgerfile_app'",
    );
    expect(rows[0]).toEqual({ rolcanlogin: true, rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolinherit: false, rolbypassrls: false });
    const members = await db.query<{ rolname: string }>(
      "select g.rolname from pg_auth_members m join pg_roles g on g.oid = m.roleid join pg_roles u on u.oid = m.member where u.rolname = 'ledgerfile_app' order by 1",
    );
    expect(members.rows.map((r) => r.rolname)).toEqual(["app_auth", "app_user"]);
    const owned = await db.query("select 1 from pg_tables where schemaname = 'public' and tableowner = 'ledgerfile_app'");
    expect(owned.rows).toHaveLength(0);
    await db.close();
  });
  it("refuses anything that is not a SCRAM verifier, so a plaintext password never reaches SQL", async () => {
    const db = await openDatabase();
    await expect(ensureAppRole(db, "plain-text-password-not-a-verifier")).rejects.toThrow(/SCRAM-SHA-256/);
    await expect(ensureAppRole(db, "SCRAM-SHA-256$4096:x'; drop table firms; --")).rejects.toThrow(/SCRAM-SHA-256/);
    await db.close();
  });
});
