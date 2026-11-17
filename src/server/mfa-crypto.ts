import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { HostedConfigError } from "./config";

/**
 * Encryption of the authenticator secret at rest: AES-256-GCM with a random 12-byte IV, in a versioned text format
 * "v1:<iv>:<tag>:<ciphertext>" (each part base64). The key is MFA_ENCRYPTION_KEY from the environment: 32 random bytes, base64. The key,
 * the secret and the ciphertext are never put in an error message, a log or the audit log.
 *
 * The user's id is bound to the ciphertext as additional authenticated data, so a ciphertext copied from one user's row to another's
 * fails to decrypt instead of quietly giving the wrong person's secret.
 */

export const MFA_KEY_ENV = "MFA_ENCRYPTION_KEY";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const VERSION = "v1";

type Env = Record<string, string | undefined>;

/** Why the key cannot be used, in words that name the variable and never its value; null when it can. */
export function mfaKeyProblem(env: Env = process.env): string | null {
  const raw = env[MFA_KEY_ENV]?.trim();
  if (!raw) return `${MFA_KEY_ENV} is not set. Two-step sign-in needs it: 32 random bytes, base64 (for example from \`openssl rand -base64 32\`).`;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) return `${MFA_KEY_ENV} is not valid base64.`;
  if (Buffer.from(raw, "base64").length !== KEY_BYTES) return `${MFA_KEY_ENV} must decode to exactly ${KEY_BYTES} bytes (generate one with \`openssl rand -base64 32\`).`;
  return null;
}

/** The key as bytes. Throws a HostedConfigError that names the variable, never its value. */
export function mfaKey(env: Env = process.env): Buffer {
  const problem = mfaKeyProblem(env);
  if (problem) throw new HostedConfigError(problem);
  return Buffer.from(env[MFA_KEY_ENV]!.trim(), "base64");
}

/** Encrypt a secret for storage. `binding` (the user's id) is authenticated with it. */
export function encryptSecret(plain: Buffer, key: Buffer, binding: string): string {
  if (key.length !== KEY_BYTES) throw new Error("The encryption key is not the right size.");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(binding, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), ciphertext.toString("base64")].join(":");
}

/** Decrypt a stored secret. Any tampering, a wrong key or a wrong binding fails with the same plain message. */
export function decryptSecret(stored: string, key: Buffer, binding: string): Buffer {
  const fail = () => new Error("The stored two-step secret could not be read.");
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION || key.length !== KEY_BYTES) throw fail();
  try {
    const iv = Buffer.from(parts[1], "base64");
    const tag = Buffer.from(parts[2], "base64");
    if (iv.length !== IV_BYTES || tag.length !== 16) throw fail();
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(binding, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(parts[3], "base64")), decipher.final()]);
  } catch {
    throw fail();
  }
}
