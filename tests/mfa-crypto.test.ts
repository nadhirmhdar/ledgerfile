import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, mfaKey, mfaKeyProblem } from "../src/server/mfa-crypto";
import { HostedConfigError, redact } from "../src/server/config";

const key = randomBytes(32);
const USER = "aaaaaaaa-9999-4000-8000-000000000001";
const SECRET = Buffer.from("12345678901234567890");

describe("encrypting the authenticator secret", () => {
  it("round-trips, and the stored text is versioned and does not hold the secret", () => {
    const stored = encryptSecret(SECRET, key, USER);
    expect(stored).toMatch(/^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    expect(stored.split(":")).toHaveLength(4);
    expect(stored).not.toContain(SECRET.toString("base64"));
    expect(decryptSecret(stored, key, USER).equals(SECRET)).toBe(true);
  });
  it("uses a new random 12-byte IV every time", () => {
    const a = encryptSecret(SECRET, key, USER);
    const b = encryptSecret(SECRET, key, USER);
    expect(a).not.toBe(b);
    expect(Buffer.from(a.split(":")[1], "base64")).toHaveLength(12);
    expect(Buffer.from(a.split(":")[2], "base64")).toHaveLength(16);
  });
  it("detects tampering with any part", () => {
    const [v, iv, tag, ct] = encryptSecret(SECRET, key, USER).split(":");
    const flip = (b64: string) => {
      const buf = Buffer.from(b64, "base64");
      buf[0] ^= 1;
      return buf.toString("base64");
    };
    for (const bad of [`${v}:${flip(iv)}:${tag}:${ct}`, `${v}:${iv}:${flip(tag)}:${ct}`, `${v}:${iv}:${tag}:${flip(ct)}`, `v2:${iv}:${tag}:${ct}`, `${v}:${iv}:${tag}`, "garbage", ""]) {
      expect(() => decryptSecret(bad, key, USER)).toThrow("The stored two-step secret could not be read.");
    }
  });
  it("fails with the wrong key, and with another user's id (the ciphertext is bound to its owner)", () => {
    const stored = encryptSecret(SECRET, key, USER);
    expect(() => decryptSecret(stored, randomBytes(32), USER)).toThrow("could not be read");
    expect(() => decryptSecret(stored, key, "bbbbbbbb-9999-4000-8000-000000000001")).toThrow("could not be read");
  });
  it("does not put the secret, the key or the ciphertext in an error", () => {
    const stored = encryptSecret(SECRET, key, USER);
    try {
      decryptSecret(stored, randomBytes(32), USER);
    } catch (e) {
      const message = (e as Error).message;
      expect(message).not.toContain(stored);
      expect(message).not.toContain(key.toString("base64"));
    }
  });
  it("refuses a key that is not 32 bytes", () => {
    expect(() => encryptSecret(SECRET, randomBytes(16), USER)).toThrow(/right size/);
  });
});

describe("the key from the environment", () => {
  const good = randomBytes(32).toString("base64");
  it("is read when it is base64 of exactly 32 bytes", () => {
    expect(mfaKeyProblem({ MFA_ENCRYPTION_KEY: good })).toBeNull();
    expect(mfaKey({ MFA_ENCRYPTION_KEY: ` ${good} ` }).equals(Buffer.from(good, "base64"))).toBe(true);
  });
  it("is refused when missing, empty, not base64, or the wrong size, naming the variable and never its value", () => {
    const cases: [Record<string, string | undefined>, RegExp][] = [
      [{}, /MFA_ENCRYPTION_KEY is not set/],
      [{ MFA_ENCRYPTION_KEY: "  " }, /is not set/],
      [{ MFA_ENCRYPTION_KEY: "not base64 !!" }, /not valid base64/],
      [{ MFA_ENCRYPTION_KEY: randomBytes(16).toString("base64") }, /exactly 32 bytes/],
      [{ MFA_ENCRYPTION_KEY: randomBytes(48).toString("base64") }, /exactly 32 bytes/],
    ];
    for (const [env, pattern] of cases) {
      expect(mfaKeyProblem(env)).toMatch(pattern);
      expect(() => mfaKey(env)).toThrow(HostedConfigError);
      expect(mfaKeyProblem(env)).not.toContain(env.MFA_ENCRYPTION_KEY?.trim() || "\u0000");
    }
  });
  it("is stripped from any text that is logged", () => {
    const text = redact(`failed with ${good} in it`, { MFA_ENCRYPTION_KEY: good });
    expect(text).not.toContain(good);
    expect(text).toContain("[redacted]");
  });
});
