import { describe, expect, it } from "vitest";
import { generateRecoveryCode, generateRecoveryCodes, hashRecoveryCode, normaliseRecoveryCode, RECOVERY_CODE_BITS, RECOVERY_CODE_COUNT, verifyRecoveryCode } from "../src/domain/recovery-codes";

describe("recovery codes", () => {
  it("come in tens, in a readable format with no look-alike characters", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(RECOVERY_CODE_COUNT).toBe(10);
    for (const c of codes) {
      expect(c).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}-[a-z2-9]{5}$/);
      expect(c).not.toMatch(/[01ilo]/);
    }
  });

  it("carry at least 60 bits each (about 74), and do not repeat", () => {
    expect(RECOVERY_CODE_BITS).toBeGreaterThanOrEqual(60);
    expect(RECOVERY_CODE_BITS).toBe(74);
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) seen.add(generateRecoveryCode());
    expect(seen.size).toBe(2000);
  });

  it("use every symbol of the alphabet, which a biased generator would not", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 400; i++) for (const ch of generateRecoveryCode().replace(/-/g, "")) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    expect(counts.size).toBe(31);
    // 6000 draws over 31 symbols is about 194 each; allow a wide band.
    for (const n of counts.values()) expect(n).toBeGreaterThan(110);
  });
});

describe("what is typed", () => {
  it("is read without regard to case, spaces or dashes", () => {
    expect(normaliseRecoveryCode("ABCDE-FGH23-45678")).toBe("abcdefgh2345678");
    expect(normaliseRecoveryCode("  abcde fgh23 45678 ")).toBe("abcdefgh2345678");
    expect(normaliseRecoveryCode("abcdefgh2345678")).toBe("abcdefgh2345678");
  });
  it("is not a code when it is the wrong length or has a character outside the alphabet", () => {
    for (const bad of ["", "abcde-fgh23", "abcde-fgh23-456789", "abcde-fgh23-4567l", "abcde-fgh23-4567!", "abcde-fgh23-4567i", "0000000000000000"]) expect(normaliseRecoveryCode(bad)).toBeNull();
  });
});

describe("storing and checking a code", () => {
  it("stores a salt and a SHA-256 hash, never the code", () => {
    const code = generateRecoveryCode();
    const stored = hashRecoveryCode(code);
    expect(stored.salt).toMatch(/^[0-9a-f]{32}$/);
    expect(stored.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(code.replace(/-/g, ""));
  });
  it("verifies the right code however it is typed, and refuses another", () => {
    const code = generateRecoveryCode();
    const stored = hashRecoveryCode(code);
    expect(verifyRecoveryCode(code, stored)).toBe(true);
    expect(verifyRecoveryCode(code.toUpperCase().replace(/-/g, " "), stored)).toBe(true);
    expect(verifyRecoveryCode(generateRecoveryCode(), stored)).toBe(false);
    expect(verifyRecoveryCode("nonsense", stored)).toBe(false);
    expect(verifyRecoveryCode("", stored)).toBe(false);
  });
  it("salts each code, so the same code hashes differently each time and one salt does not fit another's hash", () => {
    const code = generateRecoveryCode();
    const a = hashRecoveryCode(code);
    const b = hashRecoveryCode(code);
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
    expect(verifyRecoveryCode(code, { salt: b.salt, hash: a.hash })).toBe(false);
  });
  it("will not hash something that is not a code", () => {
    expect(() => hashRecoveryCode("nope")).toThrow(/not a recovery code/);
  });
});
