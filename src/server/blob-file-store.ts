import { createHash } from "node:crypto";
import { FILE_KEY, type FileStore } from "./file-store";

/**
 * File storage on Vercel Blob, in a PRIVATE store. Server-only. Read from the docs (https://vercel.com/docs/vercel-blob/private-storage):
 * a private blob's URL "is not publicly accessible" and every read needs authentication, so the app reads it on the server with the
 * SDK's `get(pathname, { access: "private" })` and serves it itself, through the logged download route. No blob URL or signed URL
 * is ever rendered in a page or stored. (A direct upload does give the browser a short-lived, single-key client token and, when
 * the upload finishes, the SDK returns the new blob's URL to the browser's memory; the server issues the token only for a key it
 * chose, stores neither, and never renders either. See direct-upload.ts.)
 *
 * The stored pathname is exactly the key (`<uuid>/<uuid>`): no random suffix, and `allowOverwrite` stays off, so a second upload to
 * the same key is refused by Blob itself. The SDK takes its credentials from the server's environment (BLOB_READ_WRITE_TOKEN, or
 * OIDC on Vercel); this file never reads or prints them. Errors name the operation, never the key, URL or token.
 */
export interface BlobSdk {
  put(pathname: string, body: Uint8Array, options: { access: "private"; addRandomSuffix: false; allowOverwrite: false; contentType: string }): Promise<unknown>;
  get(pathname: string, options: { access: "private" }): Promise<{ statusCode: number; stream: ReadableStream<Uint8Array> | null } | null>;
  del(pathname: string): Promise<void>;
}

async function realSdk(): Promise<BlobSdk> {
  const sdk = await import("@vercel/blob");
  return {
    put: (pathname, body, options) => sdk.put(pathname, Buffer.from(body), options),
    get: (pathname, options) => sdk.get(pathname, options),
    del: (pathname) => sdk.del(pathname),
  };
}

export function vercelBlobFileStore(options: { sdk?: BlobSdk } = {}): FileStore {
  if (typeof window !== "undefined") throw new Error("The storage adapter is server-only.");
  const sdk = async () => options.sdk ?? (await realSdk());
  const check = (key: string) => {
    // Refuse anything that is not exactly two identifiers, whatever the caller passed.
    if (!FILE_KEY.test(key)) throw new Error("Invalid storage key.");
    return key;
  };
  return {
    async put(key, data) {
      const k = check(key);
      try {
        await (await sdk()).put(k, data, { access: "private", addRandomSuffix: false, allowOverwrite: false, contentType: "application/octet-stream" });
      } catch (e) {
        // The SDK throws when the pathname exists (by default an error is thrown on overwrite). Report that without its message.
        if (e instanceof Error && /already exists|exists|overwrite/i.test(e.message)) throw new Error("File storage put refused: the object already exists.");
        throw new Error("File storage put failed.");
      }
    },
    async get(key) {
      const k = check(key);
      try {
        const result = await (await sdk()).get(k, { access: "private" });
        if (!result || result.statusCode !== 200 || !result.stream) return null;
        return new Uint8Array(await new Response(result.stream).arrayBuffer());
      } catch {
        throw new Error("File storage get failed.");
      }
    },
    async remove(key) {
      const k = check(key);
      try {
        await (await sdk()).del(k);
      } catch {
        throw new Error("File storage remove failed.");
      }
    },
  };
}

/**
 * Read a stored object on the server and report its size and sha256, without keeping it in memory. Used to verify a direct upload:
 * the numbers are the server's own, taken from the bytes Blob holds, never from anything the browser said. Reading stops once the
 * object is larger than `maxBytes` (the size reported is then over the limit and the hash is empty), so a huge object is not read to the end.
 * Null when there is no such object. Errors name the operation, never the key, URL or token.
 */
export async function inspectBlob(key: string, maxBytes: number, options: { sdk?: BlobSdk } = {}): Promise<{ size: number; sha256: string } | null> {
  if (typeof window !== "undefined") throw new Error("The storage adapter is server-only.");
  if (!FILE_KEY.test(key)) throw new Error("Invalid storage key.");
  const sdk = options.sdk ?? (await realSdk());
  try {
    const result = await sdk.get(key, { access: "private" });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    const hash = createHash("sha256");
    const reader = result.stream.getReader();
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return { size, sha256: "" };
      }
      hash.update(value);
    }
    return { size, sha256: hash.digest("hex") };
  } catch {
    throw new Error("File storage inspect failed.");
  }
}

/** The operations a direct upload needs from the store, on the real Blob SDK (or one passed in by a test). */
export function blobOps(options: { sdk?: BlobSdk } = {}) {
  const store = vercelBlobFileStore(options);
  return { inspect: (key: string, maxBytes: number) => inspectBlob(key, maxBytes, options), remove: (key: string) => store.remove(key) };
}
