import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";

/**
 * A SCRAM-SHA-256 password verifier in the form Postgres stores (RFC 5802 and RFC 7677):
 *
 *   SCRAM-SHA-256$<iterations>:<base64 salt>$<base64 StoredKey>:<base64 ServerKey>
 *
 * Giving Postgres this in `PASSWORD '...'` sets the password without the plaintext ever appearing in SQL text, where a server log
 * could capture it. The password is used as UTF-8 bytes; SASLprep only changes passwords with unusual characters, and the setup
 * script requires a long generated password, so an ASCII one is the intended case.
 */
export function scramVerifier(password: string, salt: Buffer = randomBytes(16), iterations = 4096): string {
  const salted = pbkdf2Sync(Buffer.from(password, "utf8"), salt, iterations, 32, "sha256");
  const clientKey = createHmac("sha256", salted).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const serverKey = createHmac("sha256", salted).update("Server Key").digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

/** The format check: what Postgres will accept as an already-hashed SCRAM password. */
export const SCRAM_FORMAT = /^SCRAM-SHA-256\$\d+:[A-Za-z0-9+/]+={0,2}\$[A-Za-z0-9+/]{43}=:[A-Za-z0-9+/]{43}=$/;
