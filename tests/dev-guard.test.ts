import { describe, expect, it } from "vitest";
import { assertDevSafe, HostedConfigError } from "../src/server/config";

const REMOTE = "postgres://ledgerfile_app:pw@ep-x-pooler.example.test/neondb?sslmode=require";
const NEON_PARTS = { PGHOST: "ep-x-pooler.example.test", PGDATABASE: "neondb", PGUSER: "neondb_owner", LEDGERFILE_APP_PASSWORD: "a-long-generated-app-password-0001" };

describe("assertDevSafe", () => {
  it("refuses a development server whose database is not on this machine", () => {
    expect(() => assertDevSafe({ NODE_ENV: "development", LEDGERFILE_DATABASE_URL: REMOTE })).toThrow(HostedConfigError);
    expect(() => assertDevSafe({ NODE_ENV: "development", ...NEON_PARTS })).toThrow(/not on this machine/);
  });
  it("says nothing that is a secret", () => {
    try {
      assertDevSafe({ NODE_ENV: "development", ...NEON_PARTS });
    } catch (e) {
      const m = (e as Error).message;
      expect(m).not.toContain("ep-x-pooler");
      expect(m).not.toContain("a-long-generated");
      expect(m).not.toContain("neondb");
    }
  });
  it("can be allowed on purpose", () => {
    expect(() => assertDevSafe({ NODE_ENV: "development", LEDGERFILE_DATABASE_URL: REMOTE, LEDGERFILE_ALLOW_REMOTE_DEV: "1" })).not.toThrow();
  });
  it("allows a database on this machine, and local PGlite", () => {
    expect(() => assertDevSafe({ NODE_ENV: "development", LEDGERFILE_DATABASE_URL: "postgres://u:p@localhost:5432/x" })).not.toThrow();
    expect(() => assertDevSafe({ NODE_ENV: "development" })).not.toThrow();
  });
  it("only applies to development: a production server and the setup scripts are not stopped", () => {
    expect(() => assertDevSafe({ NODE_ENV: "production", LEDGERFILE_DATABASE_URL: REMOTE })).not.toThrow();
    expect(() => assertDevSafe({ LEDGERFILE_DATABASE_URL: REMOTE })).not.toThrow();
  });
});
