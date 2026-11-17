import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Time-based one-time passwords (RFC 6238, which builds on the HOTP of RFC 4226): HMAC-SHA1, 30-second steps, 6 digits, which is what
 * authenticator apps expect. Pure and dependency-free; the secret is raw bytes and its text form is base32 (RFC 4648), as apps import it.
 */

export const STEP_SECONDS = 30;
export const DIGITS = 6;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Base32 without padding, upper case: what authenticator apps show and accept. */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Decode base32, tolerating lower case, spaces, dashes and padding. Returns null for anything that is not base32. */
export function base32Decode(text: string): Buffer | null {
  const clean = text.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  if (clean === "") return null;
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) return null;
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new secret: 20 random bytes (160 bits), the length RFC 4226 recommends. */
export const generateSecret = (): Buffer => randomBytes(20);

/** The time step a moment falls in. */
export const stepOf = (nowMs: number): number => Math.floor(nowMs / 1000 / STEP_SECONDS);

/** The 6-digit code for a time step. */
export function totp(secret: Uint8Array, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac("sha1", secret).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

/** Constant-time comparison of two strings of any length. */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  if (x.length !== y.length) {
    // Still do a comparison of the same cost, so the time does not say whether the lengths matched.
    timingSafeEqual(x, x);
    return false;
  }
  return timingSafeEqual(x, y);
}

/** What a person typed, reduced to digits: spaces and a dash in the middle are allowed. Null when it is not six digits. */
export function normaliseCode(input: string): string | null {
  const digits = input.replace(/[\s-]/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}

/**
 * Check a code against the current time step and the one either side of it (for a slightly wrong clock), and refuse any step at or before
 * `lastStep`, which is the last step already accepted for this user, so a code cannot be used twice. Returns the matched step, or null.
 * All three steps are always computed, so the time taken does not say which one matched.
 */
export function verifyTotp(secret: Uint8Array, code: string, nowMs: number, lastStep: number | null): number | null {
  const typed = normaliseCode(code);
  const current = stepOf(nowMs);
  let matched: number | null = null;
  for (const step of [current - 1, current, current + 1]) {
    const hit = typed !== null && safeEqual(totp(secret, step), typed);
    if (hit && (lastStep === null || step > lastStep) && matched === null) matched = step;
  }
  return matched;
}

/** The address an authenticator app imports, as a QR code or by hand. */
export function otpauthUri(issuer: string, account: string, secret: Uint8Array): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const query = new URLSearchParams({ secret: base32Encode(secret), issuer, algorithm: "SHA1", digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${query.toString()}`;
}
