import { describe, expect, it } from "vitest";
import { appPasswordProblems } from "../src/server/config";
import type { Db } from "../src/server/db";
import { ensureAppRole, quoteLiteral, safeControlPlaneText, type StatementSecret } from "../src/server/hosted-setup";
import { scramVerifier } from "../src/server/scram";

const PW = "Ab3-Xk9qZt2Lm8Rv4Wc7-Pn5";
const VERIFIER = scramVerifier(PW, Buffer.from("0123456789abcdef"));
const HEAD = "create role ledgerfile_app login password ";
const plaintextSecret = (): StatementSecret => {
  const lit = quoteLiteral(PW);
  return { sql: HEAD + lit, start: HEAD.length, end: HEAD.length + lit.length, plaintext: PW, verifier: VERIFIER };
};
const cp = (error: string, id = "req-123") => `Received HTTP code 400 from control plane: ${JSON.stringify({ request_id: id, error })}`;

describe("safeControlPlaneText", () => {
  it("shows an innocent control-plane error, with its request id", () => {
    expect(safeControlPlaneText(cp("password is too weak: needs at least 60 bits of entropy"), plaintextSecret())).toBe("password is too weak: needs at least 60 bits of entropy (request req-123)");
  });
  it("shows only the error field of the JSON shape, not other fields", () => {
    const msg = `Received HTTP code 400 from control plane: ${JSON.stringify({ request_id: "r1", error: "bad", extra: "internal detail" })}`;
    expect(safeControlPlaneText(msg, plaintextSecret())).toBe("bad (request r1)");
  });
  it("shows a message that names the role, which is not a secret", () => {
    expect(safeControlPlaneText(cp("role ledgerfile_app could not be created"), plaintextSecret())).toContain("ledgerfile_app");
  });
  it("shows a non-JSON control-plane text", () => {
    expect(safeControlPlaneText("Received HTTP code 500 from control plane: upstream unavailable", plaintextSecret())).toBe("Received HTTP code 500 from control plane: upstream unavailable");
  });
  it("withholds a message that contains the password in any form", () => {
    for (const form of [PW, PW.replace(/'/g, "''"), encodeURIComponent(PW), quoteLiteral(PW)]) {
      expect(safeControlPlaneText(cp(`bad password ${form}`), plaintextSecret())).toBeNull();
    }
    // Also an awkward password in its quoted forms.
    const pw = "it's a back\\slash Pass-9Aa1xyz";
    const lit = quoteLiteral(pw);
    const secret: StatementSecret = { sql: HEAD + lit, start: HEAD.length, end: HEAD.length + lit.length, plaintext: pw };
    for (const form of [pw, pw.replace(/'/g, "''"), pw.replace(/\\/g, "\\\\").replace(/'/g, "''"), encodeURIComponent(pw), lit]) {
      expect(safeControlPlaneText(cp(`bad ${form}`), secret)).toBeNull();
    }
  });
  it("withholds a message that quotes part of the password", () => {
    expect(safeControlPlaneText(cp(`near "${PW.slice(8, 20)}"`), plaintextSecret())).toBeNull();
    expect(safeControlPlaneText(cp(`near "${PW.slice(10, 16)}"`), plaintextSecret())).toBeNull();
  });
  it("withholds a message that contains the verifier or any of its parts", () => {
    const m = /^SCRAM-SHA-256\$\d+:([^$]+)\$([^:]+):(.+)$/.exec(VERIFIER)!;
    for (const part of [VERIFIER, m[1], m[2], m[3]]) expect(safeControlPlaneText(cp(`rejected ${part}`), plaintextSecret())).toBeNull();
  });
  it("withholds a message that quotes the statement around the secret, but not fixed text that is only the role name", () => {
    const lit = quoteLiteral(PW);
    expect(safeControlPlaneText(cp(`syntax error in: ${(HEAD + lit).slice(HEAD.length - 6)}`), plaintextSecret())).toBeNull();
    expect(safeControlPlaneText(cp(`failed: ${HEAD.slice(0, 30)}`), plaintextSecret())).not.toBeNull();
  });
  it("is null for anything that is not a control-plane message", () => {
    expect(safeControlPlaneText("some other internal error", plaintextSecret())).toBeNull();
  });
  it("strips control characters and caps long text", () => {
    const shown = safeControlPlaneText(cp(`line one\nline\ttwo\u0007bell ${"x".repeat(900)}`), plaintextSecret())!;
    expect(shown).not.toMatch(/[\u0000-\u001f]/);
    expect(shown.length).toBeLessThanOrEqual(304);
    expect(shown.endsWith("...")).toBe(true);
    expect(shown.startsWith("line one line two")).toBe(true);
  });
  it("redacts what redact() knows even in an innocent message", () => {
    process.env.DATABASE_URL_UNPOOLED = "postgres://neondb_owner:ownersecret@ep-x.example.test/neondb";
    try {
      expect(safeControlPlaneText(cp("see postgres://neondb_owner:ownersecret@ep-x.example.test/neondb for help"), plaintextSecret())).not.toContain("ownersecret");
    } finally {
      delete process.env.DATABASE_URL_UNPOOLED;
    }
  });
});

function failingDb(error: Error & { code?: string }) {
  const exec: string[] = [];
  const db: Db = {
    async query(sql: string) {
      if (/from pg_roles where rolname = \$1/.test(sql) && /select 1/.test(sql)) return { rows: [] } as never;
      if (/rolsuper, rolbypassrls/.test(sql)) return { rows: [{ rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false, rolinherit: false, rolcanlogin: true }] } as never;
      if (/show server_version_num/.test(sql)) return { rows: [{ v: "170000" }] } as never;
      return { rows: [] } as never;
    },
    async exec(sql: string) {
      exec.push(sql);
      if (sql.startsWith("create role") && sql.includes("SCRAM-SHA-256$")) throw Object.assign(new Error('Received HTTP code 400 from control plane: {"error":"Neon only supports being given plaintext passwords"}'), { code: "XX000" });
      if (sql.startsWith("create role")) throw error;
    },
    async transaction(fn) {
      return fn(db);
    },
    async close() {},
  };
  return { db, exec };
}

describe("what the owner's build prints", () => {
  it("an innocent control-plane reason on the plaintext retry is shown once, with the code once", async () => {
    const { db } = failingDb(Object.assign(new Error(cp("password does not meet the strength requirements")), { code: "XX000" }));
    const err = await ensureAppRole(db, { verifier: VERIFIER, plaintext: PW }).catch((e: Error) => e);
    expect((err as Error).message).toBe("A role statement failed [XX000]. The database says: password does not meet the strength requirements (request req-123)");
  });
  it("a message that quotes the password is withheld, with a plain sentence", async () => {
    const { db } = failingDb(Object.assign(new Error(cp(`bad password ${PW}`)), { code: "XX000" }));
    const err = (await ensureAppRole(db, { verifier: VERIFIER, plaintext: PW }).catch((e: Error) => e)) as Error;
    expect(err.message).toBe("A role statement failed [XX000]. The database's message was withheld because it could contain the password.");
    expect(err.message).not.toContain(PW);
  });
  it("creates the role with login and the password alone, then sets noinherit in a statement with no secret", async () => {
    const exec: string[] = [];
    const db: Db = {
      async query(sql: string) {
        if (/from pg_roles where rolname = \$1/.test(sql) && /select 1/.test(sql)) return { rows: [] } as never;
        if (/rolsuper, rolbypassrls/.test(sql)) return { rows: [{ rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false, rolinherit: false, rolcanlogin: true }] } as never;
        if (/show server_version_num/.test(sql)) return { rows: [{ v: "170000" }] } as never;
        return { rows: [] } as never;
      },
      async exec(sql: string) {
        exec.push(sql);
      },
      async transaction(fn) {
        return fn(db);
      },
      async close() {},
    };
    await ensureAppRole(db, { verifier: VERIFIER });
    expect(exec[0]).toBe(`create role ledgerfile_app login password '${VERIFIER}'`);
    expect(exec[1]).toBe("alter role ledgerfile_app with noinherit");
    expect(exec[1]).not.toContain("password");
  });
  it("fails if the read-back shows a restriction missing, whatever the defaults were", async () => {
    const db = failingDb(new Error("unused")).db;
    const bad: Db = { ...db, async query(sql: string) { if (/rolsuper, rolbypassrls/.test(sql)) return { rows: [{ rolsuper: false, rolbypassrls: true, rolcreatedb: false, rolcreaterole: false, rolinherit: false, rolcanlogin: true }] } as never; return db.query(sql); }, async exec() {} };
    await expect(ensureAppRole(bad, { verifier: VERIFIER })).rejects.toThrow(/expected restrictions/);
  });
});

describe("Neon's password shape, refused up front", () => {
  const ok = "Ab3-Xk9qZt2Lm8Rv4Wc7-Pn5";
  it("accepts a long mixed password", () => {
    expect(appPasswordProblems({ LEDGERFILE_APP_PASSWORD: ok })).toEqual([]);
  });
  it("names the rule, never the value, for each way it can fail", () => {
    const lower = appPasswordProblems({ LEDGERFILE_APP_PASSWORD: "abcdefghijklmnopqrstuvwxyz0123456789" }).join(" ");
    expect(lower).toMatch(/lowercase letter, an uppercase letter, a number and a symbol/);
    expect(lower).not.toContain("abcdefgh");
    expect(appPasswordProblems({ LEDGERFILE_APP_PASSWORD: "Ab3-long-generated-Appppp-password-02" }).join(" ")).toMatch(/three times in a row/);
    expect(appPasswordProblems({ LEDGERFILE_APP_PASSWORD: "Ab3-lgqq" }).join(" ")).toMatch(/shorter than 24/);
  });
  it("refuses a hex-only password of the kind the earlier setup accepted", () => {
    expect(appPasswordProblems({ LEDGERFILE_APP_PASSWORD: "0123456789abcdef0123456789abcdef" }).length).toBeGreaterThan(0);
  });
});
