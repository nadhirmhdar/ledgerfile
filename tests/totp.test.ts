import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, generateSecret, normaliseCode, otpauthUri, safeEqual, stepOf, totp, verifyTotp } from "../src/domain/totp";

// RFC 6238, Appendix B: the SHA-1 test secret is the ASCII string "12345678901234567890". The RFC's codes are 8 digits; a 6-digit code is the
// same truncated value taken modulo 10^6, so it is the last six digits of the RFC's code.
const RFC_SECRET = Buffer.from("12345678901234567890", "ascii");
const RFC_VECTORS: [number, string, string][] = [
  [59, "94287082", "287082"],
  [1111111109, "07081804", "081804"],
  [1111111111, "14050471", "050471"],
  [1234567890, "89005924", "005924"],
  [2000000000, "69279037", "279037"],
  [20000000000, "65353130", "353130"],
];

describe("RFC 6238 test vectors (SHA-1, 30-second steps), as 6 digits", () => {
  for (const [seconds, eight, six] of RFC_VECTORS) {
    it(`gives ${six} at ${seconds} s (the RFC's ${eight})`, () => {
      expect(eight.endsWith(six)).toBe(true);
      expect(totp(RFC_SECRET, stepOf(seconds * 1000))).toBe(six);
    });
  }
  it("works out the time step from milliseconds", () => {
    expect(stepOf(59_000)).toBe(1);
    expect(stepOf(60_000)).toBe(2);
    expect(stepOf(0)).toBe(0);
  });
});

describe("base32 (RFC 4648)", () => {
  const vectors: [string, string][] = [
    ["", ""],
    ["f", "MY"],
    ["fo", "MZXQ"],
    ["foo", "MZXW6"],
    ["foob", "MZXW6YQ"],
    ["fooba", "MZXW6YTB"],
    ["foobar", "MZXW6YTBOI"],
  ];
  it("encodes the RFC vectors, without padding", () => {
    for (const [plain, encoded] of vectors) expect(base32Encode(Buffer.from(plain))).toBe(encoded);
  });
  it("decodes them, and tolerates lower case, spaces, dashes and padding", () => {
    for (const [plain, encoded] of vectors.slice(1)) expect(base32Decode(encoded)!.toString()).toBe(plain);
    expect(base32Decode("mzxw 6ytb-oi==")!.toString()).toBe("foobar");
  });
  it("refuses text that is not base32", () => {
    expect(base32Decode("")).toBeNull();
    expect(base32Decode("MZXW1")).toBeNull();
    expect(base32Decode("hello!")).toBeNull();
  });
  it("round-trips random secrets of every small length", () => {
    for (let n = 1; n <= 40; n++) {
      const bytes = Buffer.from(Array.from({ length: n }, () => Math.floor(Math.random() * 256)));
      expect(base32Decode(base32Encode(bytes))!.equals(bytes)).toBe(true);
    }
  });
});

describe("secrets", () => {
  it("are 20 random bytes, never the same twice", () => {
    const a = generateSecret();
    expect(a.length).toBe(20);
    expect(generateSecret().equals(a)).toBe(false);
  });
});

describe("verifying a code", () => {
  const secret = RFC_SECRET;
  const now = 1111111109 * 1000; // inside step 37037036
  const step = stepOf(now);

  it("accepts the current step and returns it", () => {
    expect(verifyTotp(secret, totp(secret, step), now, null)).toBe(step);
  });
  it("accepts one step either side, for a clock that is a little off", () => {
    expect(verifyTotp(secret, totp(secret, step - 1), now, null)).toBe(step - 1);
    expect(verifyTotp(secret, totp(secret, step + 1), now, null)).toBe(step + 1);
  });
  it("refuses two steps away, and anything that is not the code", () => {
    expect(verifyTotp(secret, totp(secret, step - 2), now, null)).toBeNull();
    expect(verifyTotp(secret, totp(secret, step + 2), now, null)).toBeNull();
    expect(verifyTotp(secret, "000000", now, null)).toBeNull();
    for (const bad of ["", "12345", "1234567", "abcdef", "12 34"]) expect(verifyTotp(secret, bad, now, null)).toBeNull();
  });
  it("refuses a step at or before the last one accepted, so a code cannot be used twice", () => {
    const code = totp(secret, step);
    expect(verifyTotp(secret, code, now, step)).toBeNull();
    expect(verifyTotp(secret, code, now, step + 1)).toBeNull();
    expect(verifyTotp(secret, code, now, step - 1)).toBe(step);
    // After accepting the step ahead, the current step's code is no longer good either.
    expect(verifyTotp(secret, totp(secret, step), now, step + 1)).toBeNull();
  });
  it("takes the code as typed: spaces and a dash in the middle are fine", () => {
    const code = totp(secret, step);
    expect(verifyTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`, now, null)).toBe(step);
    expect(verifyTotp(secret, `${code.slice(0, 3)}-${code.slice(3)}`, now, null)).toBe(step);
    expect(normaliseCode(" 123 456 ")).toBe("123456");
    expect(normaliseCode("12345")).toBeNull();
  });
  it("does not accept another secret's code", () => {
    expect(verifyTotp(generateSecret(), totp(secret, step), now, null)).toBeNull();
  });
});

describe("comparing", () => {
  it("is equal only for equal text, whatever the lengths", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});

describe("the address an authenticator app imports", () => {
  it("names the issuer and the account, the secret in base32, SHA-1, 6 digits and 30 seconds", () => {
    const uri = otpauthUri("LedgerFile", "ada@example.test", Buffer.from("foobar"));
    const url = new URL(uri);
    expect(url.protocol).toBe("otpauth:");
    expect(url.host).toBe("totp");
    expect(decodeURIComponent(url.pathname)).toBe("/LedgerFile:ada@example.test");
    expect(url.searchParams.get("secret")).toBe("MZXW6YTBOI");
    expect(url.searchParams.get("issuer")).toBe("LedgerFile");
    expect(url.searchParams.get("algorithm")).toBe("SHA1");
    expect(url.searchParams.get("digits")).toBe("6");
    expect(url.searchParams.get("period")).toBe("30");
  });
  it("escapes an account that has awkward characters", () => {
    expect(otpauthUri("LedgerFile", "a b&c@example.test", Buffer.from("x"))).toContain("a%20b%26c%40example.test");
  });
});
