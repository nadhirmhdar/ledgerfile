import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "../src/server/db";
import { openDatabase } from "../src/server/db";
import * as auth from "../src/server/auth";
import { PUBLIC_DEMO_PASSWORD } from "../src/server/config";
import { SAMPLE_USERS, samplePasswordProblems } from "../src/server/sample-seed";

afterEach(() => vi.unstubAllEnvs());

describe("the sample seed refuses weak or public passwords", () => {
  const good = {
    SAMPLE_ADMIN_PASSWORD: "invented-admin-passphrase",
    SAMPLE_PARTNER_PASSWORD: "invented-partner-passphrase",
    SAMPLE_REVIEWER_PASSWORD: "invented-reviewer-passphrase",
    SAMPLE_PREPARER_PASSWORD: "invented-preparer-passphrase",
  };
  it("passes with four good, different passwords", () => {
    expect(samplePasswordProblems(good)).toEqual([]);
  });
  it("names each variable that is missing", () => {
    expect(samplePasswordProblems({})).toEqual(SAMPLE_USERS.map((u) => `${u.env} is not set.`));
  });
  it("refuses a short password", () => {
    expect(samplePasswordProblems({ ...good, SAMPLE_ADMIN_PASSWORD: "short" })).toEqual(["SAMPLE_ADMIN_PASSWORD is shorter than 10 characters."]);
  });
  it("refuses the public demo password, wherever it is used", () => {
    expect(samplePasswordProblems({ ...good, SAMPLE_REVIEWER_PASSWORD: PUBLIC_DEMO_PASSWORD })).toEqual(["SAMPLE_REVIEWER_PASSWORD is the public demo password."]);
  });
  it("refuses one password shared by two people", () => {
    expect(samplePasswordProblems({ ...good, SAMPLE_PARTNER_PASSWORD: good.SAMPLE_ADMIN_PASSWORD })).toEqual(["SAMPLE_PARTNER_PASSWORD is the same as SAMPLE_ADMIN_PASSWORD."]);
  });
  it("never prints a password value", () => {
    const text = samplePasswordProblems({ ...good, SAMPLE_ADMIN_PASSWORD: "short" }).join(" ");
    expect(text).not.toContain("short ");
    expect(text).not.toContain("invented-");
  });
});

describe("sign-in on a hosted site", () => {
  let db: Db;
  beforeAll(async () => {
    db = await openDatabase();
    // A user who happens to have the public demo password, as a local demo seed would have created.
    await auth.signUp(db, { firmName: "Demo Audit", name: "Demo Admin", email: "demo@ledgerfile.test", password: PUBLIC_DEMO_PASSWORD });
    await auth.signUp(db, { firmName: "Real Audit", name: "Real Admin", email: "real@firm.test", password: "invented-real-passphrase" });
  });

  it("accepts the demo password locally", async () => {
    expect(await auth.signIn(db, "demo@ledgerfile.test", PUBLIC_DEMO_PASSWORD)).toBeTruthy();
  });
  it("refuses the public demo password when hosted, with the ordinary message", async () => {
    vi.stubEnv("VERCEL", "1");
    await expect(auth.signIn(db, "demo@ledgerfile.test", PUBLIC_DEMO_PASSWORD)).rejects.toThrow("The email address or password is incorrect.");
    await expect(auth.signIn(db, "real@firm.test", PUBLIC_DEMO_PASSWORD)).rejects.toThrow("The email address or password is incorrect.");
  });
  it("still lets a real password in when hosted", async () => {
    vi.stubEnv("VERCEL", "1");
    expect(await auth.signIn(db, "real@firm.test", "invented-real-passphrase")).toBeTruthy();
  });
  it("keeps counting failed attempts, because the failure is thrown after the commit", async () => {
    await expect(auth.signIn(db, "real@firm.test", "wrong-password-1")).rejects.toThrow();
    const { rows } = await db.query<{ failed_attempts: number }>("select failed_attempts from users where email = 'real@firm.test'");
    expect(rows[0].failed_attempts).toBeGreaterThan(0);
  });
});
