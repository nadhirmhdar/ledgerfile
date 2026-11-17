import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
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

// Roles are cluster-wide, so on a real server these tests use a role of their own and never touch the real ledgerfile_app, whose password the
// runtime-role test logs in with. The role is dropped at the end.
describe("ensureAppRole", () => {
  it("creates the runtime role with every restriction, and updates it when run again", async () => {
    const db = await openDatabase();
    const role = `lf_app_test_${randomBytes(5).toString("hex")}`;
    try {
      const first = await ensureAppRole(db, { verifier: scramVerifier("a-long-generated-app-password-0001") }, role);
      const second = await ensureAppRole(db, { verifier: scramVerifier("another-long-generated-password-02") }, role);
      expect([first.created, second.created]).toEqual([true, false]);
      const { rows } = await db.query<Record<string, boolean>>(
        "select rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolbypassrls from pg_roles where rolname = $1",
        [role],
      );
      expect(rows[0]).toEqual({ rolcanlogin: true, rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolinherit: false, rolbypassrls: false });
      const members = await db.query<{ rolname: string }>(
        "select g.rolname from pg_auth_members m join pg_roles g on g.oid = m.roleid join pg_roles u on u.oid = m.member where u.rolname = $1 order by 1",
        [role],
      );
      expect(members.rows.map((r) => r.rolname)).toEqual(["app_auth", "app_user"]);
      const owned = await db.query("select 1 from pg_tables where schemaname = 'public' and tableowner = $1", [role]);
      expect(owned.rows).toHaveLength(0);
    } finally {
      // Privileges in this database first, then the role (which also removes its memberships).
      await db.exec(`drop owned by ${role}`).catch(() => undefined);
      await db.exec(`drop role if exists ${role}`).catch(() => undefined);
      await db.close();
    }
  });
  it("refuses anything that is not a SCRAM verifier, so a plaintext password never reaches SQL", async () => {
    const db = await openDatabase();
    await expect(ensureAppRole(db, { verifier: "plain-text-password-not-a-verifier" }, "lf_app_test_never")).rejects.toThrow(/SCRAM-SHA-256/);
    await expect(ensureAppRole(db, { verifier: "SCRAM-SHA-256$4096:x'; drop table firms; --" }, "lf_app_test_never")).rejects.toThrow(/SCRAM-SHA-256/);
    await db.close();
  });
  it("refuses a role name that is not a plain identifier, because it goes into SQL", async () => {
    const db = await openDatabase();
    const v = scramVerifier("a-long-generated-app-password-0001");
    for (const bad of ["Bad", "a b", "x;drop table firms", "1abc", "", "a".repeat(64), 'q"x']) {
      await expect(ensureAppRole(db, { verifier: v }, bad)).rejects.toThrow(/plain lower-case identifier/);
    }
    await db.close();
  });
});

describe("verifyRuntimeConnection", () => {
  it("passes on a database where the roles switch, and says nothing about hosts or users when it fails", async () => {
    const { verifyRuntimeConnection } = await import("../src/server/hosted-setup");
    const db = await openDatabase();
    await expect(verifyRuntimeConnection(db)).resolves.toBeUndefined();
    await db.exec("drop table schema_migrations cascade");
    await expect(verifyRuntimeConnection(db)).rejects.toThrow(/could not log in and switch roles/);
    await db.close();
  });
});
