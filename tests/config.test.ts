import { describe, expect, it } from "vitest";
import { databaseUrl, HOSTED_UPLOAD_BYTES, HostedConfigError, isHosted, LOCAL_UPLOAD_BYTES, maxUploadBytes, redact, signupOpen, uploadLimitLabel, uploadTooLargeMessage } from "../src/server/config";

describe("isHosted", () => {
  it("is false with none of the three set", () => {
    expect(isHosted({})).toBe(false);
    expect(isHosted({ DATABASE_URL: "", LEDGERFILE_HOSTED: "0", VERCEL: "  " })).toBe(false);
  });
  it("is true when ANY one is set", () => {
    expect(isHosted({ DATABASE_URL: "postgres://placeholder" })).toBe(true);
    expect(isHosted({ LEDGERFILE_HOSTED: "1" })).toBe(true);
    expect(isHosted({ VERCEL: "1" })).toBe(true);
  });
});

describe("databaseUrl fails closed", () => {
  it("is null locally, so PGlite is used", () => {
    expect(databaseUrl({})).toBeNull();
  });
  it("returns the URL when set", () => {
    expect(databaseUrl({ DATABASE_URL: " postgres://app:pw@db.example.test/x?sslmode=require " })).toBe("postgres://app:pw@db.example.test/x?sslmode=require");
  });
  it("refuses to start hosted without a DATABASE_URL, instead of falling back to PGlite", () => {
    expect(() => databaseUrl({ VERCEL: "1" })).toThrow(HostedConfigError);
    expect(() => databaseUrl({ LEDGERFILE_HOSTED: "1" })).toThrow(/no runtime database connection/);
  });
});

describe("signupOpen", () => {
  it("is open locally by default", () => {
    expect(signupOpen({})).toBe(true);
  });
  it("is closed by default when hosted, by any of the three signals", () => {
    expect(signupOpen({ VERCEL: "1" })).toBe(false);
    expect(signupOpen({ LEDGERFILE_HOSTED: "1" })).toBe(false);
    expect(signupOpen({ DATABASE_URL: "postgres://placeholder" })).toBe(false);
  });
  it("can be switched either way", () => {
    expect(signupOpen({ VERCEL: "1", SIGNUP_OPEN: "1" })).toBe(true);
    expect(signupOpen({ VERCEL: "1", SIGNUP_OPEN: "true" })).toBe(true);
    expect(signupOpen({ SIGNUP_OPEN: "0" })).toBe(false);
    expect(signupOpen({ SIGNUP_OPEN: "no" })).toBe(false);
    expect(signupOpen({ SIGNUP_OPEN: "" })).toBe(true);
  });
});

describe("the one upload limit", () => {
  it("is 10 MB locally and 4 MB hosted", () => {
    expect(maxUploadBytes({})).toBe(LOCAL_UPLOAD_BYTES);
    expect(maxUploadBytes({ VERCEL: "1" })).toBe(HOSTED_UPLOAD_BYTES);
    expect(HOSTED_UPLOAD_BYTES).toBeLessThan(4.5 * 1024 * 1024);
  });
  it("words the limit for people", () => {
    expect(uploadLimitLabel({})).toBe("10 MB");
    expect(uploadTooLargeMessage({ VERCEL: "1" })).toBe("The file is larger than 4 MB.");
  });
});

describe("redact", () => {
  it("removes connection strings from a message", () => {
    const text = "connect ECONNREFUSED while using postgresql://user:secretpw@db.example.com:5432/postgres?sslmode=require now";
    const out = redact(text, {});
    expect(out).not.toContain("secretpw");
    expect(out).not.toContain("db.example.com");
    expect(out).toContain("postgres://[redacted]");
  });
  it("removes a configured secret wherever it appears", () => {
    const env = { SUPABASE_SERVICE_ROLE_KEY: "placeholder-service-key-value" };
    expect(redact("bad header placeholder-service-key-value here", env)).toBe("bad header [redacted] here");
  });
  it("leaves ordinary text alone", () => {
    expect(redact("The file is larger than 4 MB.", {})).toBe("The file is larger than 4 MB.");
  });
});

describe("responseTooLarge", () => {
  it("only refuses a file over the cap, and only when hosted", async () => {
    const { responseTooLarge, RESPONSE_CAP_BYTES } = await import("../src/server/config");
    expect(responseTooLarge(RESPONSE_CAP_BYTES + 1, { VERCEL: "1" })).toBe(true);
    expect(responseTooLarge(RESPONSE_CAP_BYTES, { VERCEL: "1" })).toBe(false);
    expect(responseTooLarge(RESPONSE_CAP_BYTES + 1, {})).toBe(false);
  });
});
