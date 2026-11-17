import { describe, expect, it } from "vitest";
import { appPasswordProblems, assertSecureUrl, databaseUrl, HostedConfigError, isLoopbackHost, migrationUrl, ownerUsers, sslModeForHost } from "../src/server/config";

// What the Vercel-Neon integration injects (names from its docs; every value here is an invented placeholder).
const NEON = {
  VERCEL: "1",
  DATABASE_URL: "postgres://neondb_owner:owner-pw@ep-x-pooler.example.test/neondb?sslmode=require",
  DATABASE_URL_UNPOOLED: "postgres://neondb_owner:owner-pw@ep-x.example.test/neondb?sslmode=require",
  PGHOST: "ep-x-pooler.example.test",
  PGHOST_UNPOOLED: "ep-x.example.test",
  PGUSER: "neondb_owner",
  PGDATABASE: "neondb",
  PGPASSWORD: "owner-pw",
};
const APP_PW = "Ab3-long-generated-App-password-0102";

describe("the runtime connection on Neon", () => {
  it("is built from the pooled host and database, as ledgerfile_app, with verified TLS", () => {
    const url = databaseUrl({ ...NEON, LEDGERFILE_APP_PASSWORD: APP_PW })!;
    const u = new URL(url);
    expect(u.username).toBe("ledgerfile_app");
    expect(u.hostname).toBe("ep-x-pooler.example.test");
    expect(u.pathname).toBe("/neondb");
    expect(u.searchParams.get("sslmode")).toBe("verify-full");
    expect(decodeURIComponent(u.password)).toBe(APP_PW);
  });
  it("fails closed when the app password is missing, and never falls back to the injected owner URL", () => {
    expect(() => databaseUrl(NEON)).toThrow(HostedConfigError);
    expect(() => databaseUrl({ ...NEON, LEDGERFILE_APP_PASSWORD: "" })).toThrow(/LEDGERFILE_APP_PASSWORD/);
    // The message names the variable, never a value.
    try {
      databaseUrl(NEON);
    } catch (e) {
      expect((e as Error).message).not.toContain("owner-pw");
      expect((e as Error).message).not.toContain("ep-x-pooler");
    }
  });
  it("never connects as the injected owner user", () => {
    const url = databaseUrl({ ...NEON, LEDGERFILE_APP_PASSWORD: APP_PW })!;
    expect(new URL(url).username).not.toBe(NEON.PGUSER);
    expect(ownerUsers(NEON).has(new URL(url).username)).toBe(false);
    // And the owner's URL is not accepted as an explicit override either.
    expect(() => databaseUrl({ ...NEON, LEDGERFILE_DATABASE_URL: NEON.DATABASE_URL })).toThrow(/database owner/);
  });
  it("encodes special characters in the password", () => {
    const pw = "p@ss:w/ord#?%&=+ space-0123456789";
    const url = databaseUrl({ ...NEON, LEDGERFILE_APP_PASSWORD: pw })!;
    expect(url).not.toContain(pw);
    expect(decodeURIComponent(new URL(url).password)).toBe(pw);
    expect(new URL(url).hostname).toBe("ep-x-pooler.example.test");
  });
  it("does not use the owner's DATABASE_URL when a part is missing", () => {
    const { PGDATABASE: _db, ...noDb } = NEON;
    void _db;
    // Without the parts it would fall to DATABASE_URL, the owner's: refused because its user is the owner.
    expect(() => databaseUrl({ ...noDb, LEDGERFILE_APP_PASSWORD: APP_PW })).toThrow(/database owner/);
  });
  it("uses the pooled host at runtime and the direct one for migrations", () => {
    expect(new URL(databaseUrl({ ...NEON, LEDGERFILE_APP_PASSWORD: APP_PW })!).hostname).toBe("ep-x-pooler.example.test");
    expect(migrationUrl(NEON)).toBe(NEON.DATABASE_URL_UNPOOLED);
  });
});

describe("precedence", () => {
  const explicit = "postgres://ledgerfile_app:pw@pooler.example.test:6543/postgres?sslmode=require";
  const owner = "postgres://postgres:x@db.example.test:5432/postgres?sslmode=require";
  it("LEDGERFILE_DATABASE_URL wins over the Neon parts", () => {
    expect(databaseUrl({ ...NEON, LEDGERFILE_APP_PASSWORD: APP_PW, LEDGERFILE_DATABASE_URL: explicit })).toBe(explicit);
  });
  it("a hand-set DATABASE_URL still works for Supabase, when it is not the owner's", () => {
    expect(databaseUrl({ VERCEL: "1", DATABASE_URL: explicit, DATABASE_URL_MIGRATIONS: owner })).toBe(explicit);
    expect(() => databaseUrl({ VERCEL: "1", DATABASE_URL: owner, DATABASE_URL_MIGRATIONS: owner })).toThrow(/database owner/);
  });
  it("hosted with nothing usable refuses to start", () => {
    expect(() => databaseUrl({ VERCEL: "1" })).toThrow(HostedConfigError);
  });
  it("is null locally", () => {
    expect(databaseUrl({})).toBeNull();
  });
  it("migrations prefer the explicit migration URL, then the direct one, then the pooled one", () => {
    expect(migrationUrl({ DATABASE_URL_MIGRATIONS: "m", DATABASE_URL_UNPOOLED: "u", DATABASE_URL: "d" })).toBe("m");
    expect(migrationUrl({ DATABASE_URL_UNPOOLED: "u", DATABASE_URL: "d" })).toBe("u");
    expect(migrationUrl({ DATABASE_URL: "d" })).toBe("d");
    expect(migrationUrl({})).toBeNull();
  });
});

describe("TLS", () => {
  it("is verified for any real host and off only for this machine", () => {
    expect(sslModeForHost("ep-x-pooler.example.test")).toBe("verify-full");
    expect(sslModeForHost("localhost")).toBe("disable");
    expect(sslModeForHost("127.0.0.1")).toBe("disable");
    expect(isLoopbackHost("db.example.test")).toBe(false);
    expect(isLoopbackHost("localhost.example.test")).toBe(false);
  });
  it("cannot be turned off for a real host by any variable", () => {
    for (const flag of [{ LEDGERFILE_ALLOW_INSECURE_DB: "1" }, { CI: "true" }, { PGSSLMODE: "disable" }]) {
      const url = databaseUrl({ ...NEON, ...flag, LEDGERFILE_APP_PASSWORD: APP_PW })!;
      expect(new URL(url).searchParams.get("sslmode")).toBe("verify-full");
    }
  });
  it("refuses a handed-in URL without sslmode for a real host, and allows localhost", () => {
    expect(() => assertSecureUrl("postgres://u:p@db.example.test/x", "X")).toThrow(/sslmode=require/);
    expect(() => assertSecureUrl("postgres://u:p@db.example.test/x?sslmode=disable", "X")).toThrow(/sslmode/);
    expect(() => assertSecureUrl("postgres://u:p@db.example.test/x?sslmode=require", "X")).not.toThrow();
    expect(() => assertSecureUrl("postgres://u:p@localhost:5432/x", "X")).not.toThrow();
  });
  it("builds a loopback URL without TLS for the CI service container", () => {
    const url = databaseUrl({ VERCEL: "1", PGHOST: "localhost", PGDATABASE: "neondb", PGUSER: "neondb_owner", LEDGERFILE_APP_PASSWORD: APP_PW })!;
    expect(new URL(url).searchParams.get("sslmode")).toBe("disable");
  });
});

describe("the app password policy", () => {
  it("accepts a long generated password", () => {
    expect(appPasswordProblems({ LEDGERFILE_APP_PASSWORD: APP_PW })).toEqual([]);
  });
  it("refuses a missing, short, demo or sample password, without printing it", () => {
    expect(appPasswordProblems({})).toEqual(["LEDGERFILE_APP_PASSWORD is not set."]);
    expect(appPasswordProblems({ LEDGERFILE_APP_PASSWORD: "short" })).toContain("LEDGERFILE_APP_PASSWORD is shorter than 24 characters.");
    expect(appPasswordProblems({ LEDGERFILE_APP_PASSWORD: APP_PW, SAMPLE_ADMIN_PASSWORD: APP_PW })).toEqual(["LEDGERFILE_APP_PASSWORD is the same as SAMPLE_ADMIN_PASSWORD."]);
    expect(appPasswordProblems({ LEDGERFILE_APP_PASSWORD: "ledgerfile-demo-only" }).join(" ")).toContain("public demo password");
    expect(appPasswordProblems({ LEDGERFILE_APP_PASSWORD: "short" }).join(" ")).not.toContain("short ");
  });
});
