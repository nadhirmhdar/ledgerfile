import { createHash, randomBytes, randomInt } from "node:crypto";
import { safeEqual } from "./totp";

/**
 * Recovery codes for two-step sign-in: ten single-use codes the user keeps somewhere safe for the day the authenticator is lost.
 *
 * Format "xxxxx-xxxxx-xxxxx": 15 characters from a 31-symbol alphabet (lower-case letters and the digits 2 to 9, leaving out the
 * look-alikes 0, 1, i, l and o), about 74 bits each, drawn with node's unbiased randomInt.
 *
 * Why a salted SHA-256 and not a slow password hash: a recovery code is a random value of 74 bits, not something a person chose, so
 * guessing it offline is out of reach however fast the hash is, and a slow hash would only make each sign-in slower. The salt (16 random
 * bytes per code) stops two equal codes, or a table built in advance, from matching. Only the hash and salt are stored.
 */

export const RECOVERY_CODE_COUNT = 10;
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const GROUPS = 3;
const GROUP_LENGTH = 5;
export const RECOVERY_CODE_BITS = Math.floor(GROUPS * GROUP_LENGTH * Math.log2(ALPHABET.length));

/** One new code in the readable form. */
export function generateRecoveryCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g++) {
    let group = "";
    for (let i = 0; i < GROUP_LENGTH; i++) group += ALPHABET[randomInt(ALPHABET.length)];
    groups.push(group);
  }
  return groups.join("-");
}

export const generateRecoveryCodes = (count = RECOVERY_CODE_COUNT): string[] => Array.from({ length: count }, generateRecoveryCode);

/** What a person typed, reduced to the code's own characters: case, spaces and dashes do not matter. Null when it cannot be a code. */
export function normaliseRecoveryCode(input: string): string | null {
  const clean = input.toLowerCase().replace(/[\s-]/g, "");
  if (clean.length !== GROUPS * GROUP_LENGTH) return null;
  for (const ch of clean) if (!ALPHABET.includes(ch)) return null;
  return clean;
}

const digest = (salt: string, normalised: string) => createHash("sha256").update(Buffer.from(salt, "hex")).update(normalised, "utf8").digest("hex");

/** The salt and hash to store for a code. */
export function hashRecoveryCode(code: string): { salt: string; hash: string } {
  const normalised = normaliseRecoveryCode(code);
  if (!normalised) throw new Error("That is not a recovery code.");
  const salt = randomBytes(16).toString("hex");
  return { salt, hash: digest(salt, normalised) };
}

/** Whether typed input is the code that was hashed. Constant time; false for anything that cannot be a code. */
export function verifyRecoveryCode(input: string, stored: { salt: string; hash: string }): boolean {
  const normalised = normaliseRecoveryCode(input);
  if (!normalised) return false;
  return safeEqual(digest(stored.salt, normalised), stored.hash);
}
