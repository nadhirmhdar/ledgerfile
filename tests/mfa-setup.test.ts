import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

/**
 * db:setup-hosted runs inside the Vercel build. It must stop, before it touches any database, when MFA_ENCRYPTION_KEY is missing or invalid:
 * a failed build leaves the live deployment serving, so a deploy that lacks the key can never lock anyone out. The script is run here with
 * an environment that has no database at all, so the only thing it can fail on first is the key.
 */
function runSetup(env: Record<string, string>) {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !/^(DATABASE_URL|PG|LEDGERFILE|MFA_|SAMPLE_|TEST_)/.test(k)) clean[k] = v;
  return spawnSync(process.execPath, ["--import", "tsx", "scripts/setup-hosted.mts"], { env: { ...clean, ...env } as NodeJS.ProcessEnv, encoding: "utf8", timeout: 60_000 });
}

describe("the hosted setup check for the two-step key", () => {
  it("fails, naming the variable and saying the live site keeps running, when the key is missing", () => {
    const r = runSetup({});
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Refusing to set up the database");
    expect(r.stderr).toContain("MFA_ENCRYPTION_KEY is not set");
    expect(r.stderr).toContain("the live site keeps running");
  }, 70_000);

  it("fails for a key that is not 32 bytes of base64, without printing it", () => {
    const bad = randomBytes(16).toString("base64");
    const r = runSetup({ MFA_ENCRYPTION_KEY: bad });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("must decode to exactly 32 bytes");
    expect(r.stderr).not.toContain(bad);
    expect(r.stdout).not.toContain(bad);
  }, 70_000);

  it("gets past the key check with a valid key (and then stops for the missing database connection, which this test does not provide)", () => {
    const good = randomBytes(32).toString("base64");
    const r = runSetup({ MFA_ENCRYPTION_KEY: good });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Set the direct owner connection");
    expect(r.stderr).not.toContain("MFA_ENCRYPTION_KEY");
    expect(r.stderr).not.toContain(good);
  }, 70_000);
});
