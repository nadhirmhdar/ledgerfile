import { describe, expect, it } from "vitest";
import { appPasswordProblems, passwordEntropyBits, redact, withVerifiedTls } from "../src/server/config";
import type { Db } from "../src/server/db";
import { ensureAppRole, ensureSetupRoleCanSwitch, isPlaintextOnlyRefusal, quoteLiteral } from "../src/server/hosted-setup";
import { scramVerifier } from "../src/server/scram";

const NEON_REFUSAL = Object.assign(new Error('Received HTTP code 400 from control plane: {"error":"Neon only supports being given plaintext passwords"}'), { code: "XX000" });
const GOOD_ATTRS = { rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false, rolinherit: false, rolcanlogin: true };

/** A database that records what it is asked and answers the few questions ensureAppRole puts, so no real server is needed. */
function fakeDb(opts: { exists?: boolean; failExec?: (sql: string, n: number) => unknown } = {}) {
  const exec: string[] = [];
  const db: Db = {
    async query(sql: string) {
      if (/from pg_roles where rolname = \$1/.test(sql) && /select 1/.test(sql)) return { rows: opts.exists ? [{}] : [] } as never;
      if (/rolsuper, rolbypassrls/.test(sql)) return { rows: [GOOD_ATTRS] } as never;
      if (/show server_version_num/.test(sql)) return { rows: [{ v: "170000" }] } as never;
      if (/pg_auth_members/.test(sql)) return { rows: [{ super: false, v: "170000", admin: true }] } as never;
      return { rows: [] } as never;
    },
    async exec(sql: string) {
      exec.push(sql);
      const err = opts.failExec?.(sql, exec.length);
      if (err) throw err;
    },
    async transaction(fn) {
      return fn(db);
    },
    async close() {},
  };
  return { db, exec };
}

/** Reads back the string a quoteLiteral produced, the way Postgres does (standard strings: only the quote is special; E strings: backslash too). */
function unquote(lit: string): string {
  const escape = lit.startsWith(" E'") || lit.startsWith("E'");
  const body = lit.replace(/^ ?E?'/, "").replace(/'$/, "");
  let out = "";
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "'" && body[i + 1] === "'") {
      out += "'";
      i++;
    } else if (escape && body[i] === "\\" && body[i + 1] === "\\") {
      out += "\\";
      i++;
    } else out += body[i];
  }
  return out;
}

const PW = "a-long-generated-app-password-0001";

describe("the plaintext fallback on Neon", () => {
  it("recognises exactly Neon's refusal", () => {
    expect(isPlaintextOnlyRefusal(NEON_REFUSAL)).toBe(true);
    expect(isPlaintextOnlyRefusal(Object.assign(new Error("only supports being given plaintext passwords"), { code: "42501" }))).toBe(false);
    expect(isPlaintextOnlyRefusal(Object.assign(new Error("something else"), { code: "XX000" }))).toBe(false);
    expect(isPlaintextOnlyRefusal(null)).toBe(false);
  });

  it("sends the verifier first, and only on that refusal retries the same statement with an escaped plaintext literal", async () => {
    const { db, exec } = fakeDb({ failExec: (sql) => (sql.includes("SCRAM-SHA-256$") ? NEON_REFUSAL : null) });
    const result = await ensureAppRole(db, { verifier: scramVerifier(PW), plaintext: PW });
    expect(result).toEqual({ created: true, usedPlaintext: true });
    const role = exec.filter((s) => s.startsWith("create role"));
    expect(role).toHaveLength(2);
    expect(role[0]).toContain("SCRAM-SHA-256$");
    expect(role[1]).toBe(`create role ledgerfile_app login nosuperuser nocreatedb nocreaterole noinherit nobypassrls password ${quoteLiteral(PW)}`);
    expect(role[1]).not.toContain("SCRAM-SHA-256$");
  });

  it("keeps to the verifier where the server accepts it (plain Postgres, Supabase), so plaintext never reaches SQL there", async () => {
    const { db, exec } = fakeDb();
    const result = await ensureAppRole(db, { verifier: scramVerifier(PW), plaintext: PW });
    expect(result.usedPlaintext).toBe(false);
    expect(exec.join("\n")).not.toContain(PW);
  });

  it("uses the same fallback to change the password of an existing role", async () => {
    const { db, exec } = fakeDb({ exists: true, failExec: (sql) => (sql.includes("SCRAM-SHA-256$") ? NEON_REFUSAL : null) });
    const result = await ensureAppRole(db, { verifier: scramVerifier(PW), plaintext: PW });
    expect(result).toEqual({ created: false, usedPlaintext: true });
    expect(exec.filter((s) => s.startsWith("alter role"))).toHaveLength(2);
  });

  it("does not retry any other error", async () => {
    for (const err of [Object.assign(new Error("permission denied to alter role"), { code: "42501" }), Object.assign(new Error("boom"), { code: "XX000" }), new Error("plain failure")]) {
      const { db, exec } = fakeDb({ failExec: (sql) => (sql.startsWith("create role") ? err : null) });
      await expect(ensureAppRole(db, { verifier: scramVerifier(PW), plaintext: PW })).rejects.toThrow();
      expect(exec.filter((s) => s.startsWith("create role"))).toHaveLength(1);
    }
  });

  it("says so plainly when the server needs plaintext and none was given", async () => {
    const { db } = fakeDb({ failExec: () => NEON_REFUSAL });
    await expect(ensureAppRole(db, { verifier: scramVerifier(PW) })).rejects.toThrow(/only accepts a plaintext password/);
  });
});

describe("quoting the plaintext", () => {
  const cases = ["plain", "it's", "back\\slash", "both ' and \\", "dollar $$ quote $tag$ end", "unicode é ü 日本 😀", "semi; drop table x; --", "'; select 1; --", "\\' tricky", "a''b"];
  it("round-trips every awkward password through the literal", () => {
    for (const pw of cases) expect(unquote(quoteLiteral(pw))).toBe(pw);
  });
  it("never leaves a bare single quote that could end the literal early", () => {
    for (const pw of cases) {
      const inner = quoteLiteral(pw).replace(/^ ?E?'/, "").replace(/'$/, "");
      expect(inner.replace(/''/g, "")).not.toContain("'");
    }
  });
  it("is what the retried statement contains", async () => {
    for (const pw of cases) {
      const { db, exec } = fakeDb({ failExec: (sql) => (sql.includes("SCRAM-SHA-256$") ? NEON_REFUSAL : null) });
      await ensureAppRole(db, { verifier: scramVerifier(pw + "-padding-padding"), plaintext: pw });
      expect(exec[exec.length - 1 - 0] !== undefined).toBe(true);
      expect(exec.some((s) => s.endsWith(`password ${quoteLiteral(pw)}`))).toBe(true);
    }
  });
});

describe("secrets never come back out", () => {
  it("a failure whose message quotes the statement is reported without it", async () => {
    const leak = Object.assign(new Error(`syntax error at or near "${PW}" in create role ledgerfile_app password '${PW}'`), {
      code: "42601",
      detail: `password ${PW}`,
      where: `create role ledgerfile_app password '${PW}'`,
      internalQuery: `create role ledgerfile_app password '${PW}'`,
    });
    const { db } = fakeDb({ failExec: (sql) => (sql.startsWith("create role") ? leak : null) });
    try {
      await ensureAppRole(db, { verifier: scramVerifier(PW), plaintext: PW });
      expect.unreachable();
    } catch (e) {
      const text = JSON.stringify({ message: (e as Error).message, ...(e as object) });
      expect(text).not.toContain(PW);
      expect(text).not.toContain("SCRAM-SHA-256$");
      expect(text).toContain("42601");
    }
  });
  it("a failure on the plaintext retry is also reported without it", async () => {
    const { db } = fakeDb({
      failExec: (sql) => (sql.includes("SCRAM-SHA-256$") ? NEON_REFUSAL : sql.startsWith("create role") ? Object.assign(new Error(`bad password ${PW}`), { code: "XX000" }) : null),
    });
    await expect(ensureAppRole(db, { verifier: scramVerifier(PW), plaintext: PW })).rejects.toThrow(/\[XX000\]/);
    await ensureAppRole(db, { verifier: scramVerifier(PW), plaintext: PW }).catch((e: Error) => expect(e.message).not.toContain(PW));
  });
  it("a refusal on the plaintext retry is not passed up raw either: only the SQLSTATE and a plain sentence leave", async () => {
    const raw = Object.assign(new Error(`Received HTTP code 400 from control plane: Neon only supports being given plaintext passwords ${PW}`), { code: "XX000", detail: `statement with ${PW}`, where: `create role x password '${PW}'` });
    const { db } = fakeDb({ failExec: () => raw });
    try {
      await ensureAppRole(db, { verifier: scramVerifier(PW), plaintext: PW });
      expect.unreachable();
    } catch (e) {
      expect(e).not.toBe(raw);
      expect((e as { detail?: unknown }).detail).toBeUndefined();
      expect((e as { where?: unknown }).where).toBeUndefined();
      expect((e as Error).message).toBe("A role statement failed [XX000]: the database refused the plaintext password too.");
      expect(JSON.stringify({ m: (e as Error).message, ...(e as object) })).not.toContain(PW);
    }
  });
  it("a permission error keeps its (harmless) message", async () => {
    const { db } = fakeDb({ failExec: (sql) => (sql.startsWith("create role") ? Object.assign(new Error("permission denied to create role"), { code: "42501" }) : null) });
    await expect(ensureAppRole(db, { verifier: scramVerifier(PW) })).rejects.toThrow("permission denied to create role");
  });
  it("redact removes the app password as typed, as an SQL literal, and URL-encoded", () => {
    const env = { LEDGERFILE_APP_PASSWORD: "p@ss'w\\rd with space-0123456789" };
    const pw = env.LEDGERFILE_APP_PASSWORD;
    const text = [pw, quoteLiteral(pw), pw.replace(/'/g, "''"), encodeURIComponent(pw), `postgres://u:${encodeURIComponent(pw)}@h/db`].join(" | ");
    const out = redact(text, env);
    expect(out).not.toContain("p@ss");
    expect(out).not.toContain("w\\\\rd");
    expect(out).not.toContain(encodeURIComponent(pw));
    expect(out).toContain("[redacted]");
  });
  it("redact also removes the sample passwords", () => {
    const env = { SAMPLE_ADMIN_PASSWORD: "invented-admin-passphrase" };
    expect(redact("x invented-admin-passphrase y", env)).toBe("x [redacted] y");
  });
});

describe("TLS is normalised to verify-full and never weakened", () => {
  const sslmode = (u: string) => new URL(u).searchParams.get("sslmode");
  it("upgrades require, verify-ca, disable and none for a real host", () => {
    for (const mode of ["require", "verify-ca", "prefer", "disable", "allow"]) {
      expect(sslmode(withVerifiedTls(`postgres://u:p@ep-x.example.test/db?sslmode=${mode}`))).toBe("verify-full");
    }
    expect(sslmode(withVerifiedTls("postgres://u:p@ep-x.example.test/db"))).toBe("verify-full");
    expect(sslmode(withVerifiedTls("postgres://u:p@ep-x.example.test/db?sslmode=verify-full"))).toBe("verify-full");
  });
  it("leaves a loopback URL alone (the CI service container)", () => {
    const url = "postgres://u:p@localhost:5432/db?sslmode=disable";
    expect(withVerifiedTls(url)).toBe(url);
    expect(withVerifiedTls("postgres://u:p@127.0.0.1/db")).toBe("postgres://u:p@127.0.0.1/db");
  });
  it("keeps the rest of the URL, the password included", () => {
    const pw = "p@ss:w/ord#?%&=";
    const url = `postgres://ledgerfile_app:${encodeURIComponent(pw)}@ep-x-pooler.example.test:5432/neondb?sslmode=require&channel_binding=require`;
    const out = new URL(withVerifiedTls(url));
    expect(decodeURIComponent(out.password)).toBe(pw);
    expect(out.hostname).toBe("ep-x-pooler.example.test");
    expect(out.pathname).toBe("/neondb");
    expect(out.searchParams.get("channel_binding")).toBe("require");
  });
});

describe("Neon's password strength rule", () => {
  it("estimates entropy by length and character pool, and rejects repetition", () => {
    expect(passwordEntropyBits("aaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(0);
    expect(passwordEntropyBits("abababababababababababab")).toBe(0);
    expect(passwordEntropyBits("a1b2c3d4e5f6a7b8c9d0e1f2")).toBeGreaterThan(60);
    expect(passwordEntropyBits("short")).toBe(0);
  });
  it("is enforced up front, naming no value", () => {
    const problems = appPasswordProblems({ LEDGERFILE_APP_PASSWORD: "aaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
    expect(problems.join(" ")).toMatch(/too predictable/);
    expect(problems.join(" ")).not.toContain("aaaa");
    expect(appPasswordProblems({ LEDGERFILE_APP_PASSWORD: "a1b2c3d4e5f6a7b8c9d0e1f2" })).toEqual([]);
  });
});

describe("the setup role must be able to switch roles", () => {
  function switchDb(canAfter: string) {
    const log: string[] = [];
    const granted = new Set<string>();
    const db: Db = {
      async query() {
        return { rows: [{ v: "170000" }] } as never;
      },
      async exec(sql: string) {
        log.push(sql);
        const role = sql.match(/^set local role ([a-z_]+)/)?.[1];
        if (role && !(granted.has(role) && canAfter === "grant")) throw new Error("permission denied to set role");
        const g = sql.match(/^grant ([a-z_]+) to current_user/)?.[1];
        if (g) granted.add(g);
      },
      async transaction(fn) {
        return fn(db);
      },
      async close() {},
    };
    return { db, log };
  }
  it("tries the grant once when the switch is refused, then passes", async () => {
    const { db, log } = switchDb("grant");
    await expect(ensureSetupRoleCanSwitch(db)).resolves.toBeUndefined();
    expect(log.filter((s) => s.startsWith("grant"))).toEqual(["grant app_user to current_user with inherit false, set true", "grant app_auth to current_user with inherit false, set true"]);
  });
  it("fails with what to grant when it still cannot", async () => {
    const { db } = switchDb("never");
    await expect(ensureSetupRoleCanSwitch(db)).rejects.toThrow(/cannot switch to app_user.*grant app_user to <the setup role> with set true/);
  });
});
