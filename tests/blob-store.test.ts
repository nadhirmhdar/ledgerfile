import { describe, expect, it } from "vitest";
import { vercelBlobFileStore, type BlobSdk } from "../src/server/blob-file-store";
import { fileStoreKind } from "../src/server/file-store";

const KEY = "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222";

function fake(overrides: Partial<BlobSdk> = {}) {
  const calls: { op: string; pathname: string; options?: unknown }[] = [];
  const sdk: BlobSdk = {
    async put(pathname, _body, options) {
      calls.push({ op: "put", pathname, options });
    },
    async get(pathname, options) {
      calls.push({ op: "get", pathname, options });
      return { statusCode: 200, stream: new Response("abc").body };
    },
    async del(pathname) {
      calls.push({ op: "del", pathname });
    },
    ...overrides,
  };
  return { sdk, calls };
}

describe("vercelBlobFileStore", () => {
  it("accepts only keys that are exactly two identifiers", async () => {
    const { sdk, calls } = fake();
    const store = vercelBlobFileStore({ sdk });
    for (const bad of ["../x", "a/b", `${KEY}/extra`, "", `${KEY}?x=1`]) {
      await expect(store.put(bad, new Uint8Array([1]))).rejects.toThrow("Invalid storage key.");
      await expect(store.get(bad)).rejects.toThrow("Invalid storage key.");
      await expect(store.remove(bad)).rejects.toThrow("Invalid storage key.");
    }
    expect(calls).toHaveLength(0);
  });
  it("stores privately at exactly the key, with no suffix and no overwrite", async () => {
    const { sdk, calls } = fake();
    await vercelBlobFileStore({ sdk }).put(KEY, new Uint8Array([1, 2]));
    expect(calls[0]).toMatchObject({ op: "put", pathname: KEY, options: { access: "private", addRandomSuffix: false, allowOverwrite: false } });
  });
  it("reads privately and returns the bytes", async () => {
    const { sdk, calls } = fake();
    expect(Array.from((await vercelBlobFileStore({ sdk }).get(KEY)) ?? [])).toEqual([97, 98, 99]);
    expect(calls[0]).toMatchObject({ op: "get", pathname: KEY, options: { access: "private" } });
  });
  it("returns null when the blob is missing", async () => {
    expect(await vercelBlobFileStore({ sdk: fake({ get: async () => null }).sdk }).get(KEY)).toBeNull();
    expect(await vercelBlobFileStore({ sdk: fake({ get: async () => ({ statusCode: 304, stream: null }) }).sdk }).get(KEY)).toBeNull();
  });
  it("treats an existing object as an error without echoing the SDK message", async () => {
    const sdk = fake({
      put: async () => {
        throw new Error(`This blob already exists: https://store.private.blob.vercel-storage.com/${KEY} token=secret`);
      },
    }).sdk;
    await expect(vercelBlobFileStore({ sdk }).put(KEY, new Uint8Array([1]))).rejects.toThrow("File storage put refused: the object already exists.");
  });
  it("names the operation and nothing else on failure", async () => {
    const boom = async () => {
      throw new Error(`failed for https://x/${KEY} with token vercel_blob_rw_secret`);
    };
    const store = vercelBlobFileStore({ sdk: fake({ put: boom, get: boom, del: boom }).sdk });
    const errors: string[] = [];
    for (const run of [() => store.put(KEY, new Uint8Array([1])), () => store.get(KEY), () => store.remove(KEY)]) await run().catch((e: Error) => errors.push(e.message));
    expect(errors).toEqual(["File storage put failed.", "File storage get failed.", "File storage remove failed."]);
  });
  it("removes by key", async () => {
    const { sdk, calls } = fake();
    await vercelBlobFileStore({ sdk }).remove(KEY);
    expect(calls[0]).toEqual({ op: "del", pathname: KEY });
  });
});

describe("fileStoreKind and Vercel Blob", () => {
  it("chooses it by name", () => {
    expect(fileStoreKind({ FILE_STORE: "vercel-blob" })).toBe("vercel-blob");
    expect(fileStoreKind({ FILE_STORE: "supabase" })).toBe("supabase");
  });
});
