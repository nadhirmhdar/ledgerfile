import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { arrivalProblem, decideToken, directUploadAvailable, workingPaperLimit, type PendingRow } from "../src/server/direct-upload";
import { inspectBlob, type BlobSdk } from "../src/server/blob-file-store";
import { DIRECT_UPLOAD_BYTES } from "../src/server/config";
import { streamBytes } from "../src/server/stream";
import { clientFileProblem, megabytes, phaseText, uploadHint } from "../src/ui/upload-view";

const FIRM = "aaaaaaaa-4444-4000-8000-000000000001";
const OTHER_FIRM = "bbbbbbbb-4444-4000-8000-000000000001";
const ME = "aaaaaaaa-4444-4000-8000-000000000011";
const SOMEONE = "aaaaaaaa-4444-4000-8000-000000000012";
const KEY = `${FIRM}/11111111-1111-4111-8111-111111111111`;
const NOW = new Date("2026-11-17T10:00:00Z");
const row = (over: Partial<PendingRow> = {}): PendingRow => ({
  key: KEY,
  firmId: FIRM,
  engagementId: "cccccccc-4444-4000-8000-000000000001",
  userId: ME,
  targetKind: "engagement",
  target: null,
  fileName: "bank-statement.pdf",
  sizeBytes: 20 * 1024 * 1024,
  description: null,
  expiresAt: new Date(NOW.getTime() + 10 * 60_000),
  ...over,
});
const me = { userId: ME, firmId: FIRM };
const refused = /not allowed/;

describe("the token check (decideToken)", () => {
  it("issues a token for the key the server issued to this user, limited to the size declared and to the row's lifetime", () => {
    const options = decideToken({ pathname: KEY, session: me, row: row(), now: NOW });
    expect(options).toEqual({ maximumSizeInBytes: 20 * 1024 * 1024, addRandomSuffix: false, allowOverwrite: false, validUntil: row().expiresAt.getTime() });
  });

  it("never allows more than the hosted maximum, whatever was declared", () => {
    const options = decideToken({ pathname: KEY, session: me, row: row({ sizeBytes: DIRECT_UPLOAD_BYTES * 3 }), now: NOW });
    expect(options.maximumSizeInBytes).toBe(DIRECT_UPLOAD_BYTES);
  });

  it("refuses a pathname that is not the issued key", () => {
    const other = `${FIRM}/22222222-2222-4222-8222-222222222222`;
    expect(() => decideToken({ pathname: other, session: me, row: row(), now: NOW })).toThrow(refused);
  });

  it("refuses when there is no pending row for the pathname", () => {
    expect(() => decideToken({ pathname: KEY, session: me, row: null, now: NOW })).toThrow(refused);
  });

  it("refuses another user's key", () => {
    expect(() => decideToken({ pathname: KEY, session: { userId: SOMEONE, firmId: FIRM }, row: row(), now: NOW })).toThrow(refused);
  });

  it("refuses another firm's key, even if a row for it were somehow returned", () => {
    const theirs = `${OTHER_FIRM}/33333333-3333-4333-8333-333333333333`;
    expect(() => decideToken({ pathname: theirs, session: me, row: row({ key: theirs, firmId: OTHER_FIRM }), now: NOW })).toThrow(refused);
    expect(() => decideToken({ pathname: theirs, session: me, row: row({ key: theirs }), now: NOW })).toThrow(refused);
  });

  it("refuses an expired key, including at the moment it expires", () => {
    expect(() => decideToken({ pathname: KEY, session: me, row: row({ expiresAt: new Date(NOW.getTime() - 1000) }), now: NOW })).toThrow(refused);
    expect(() => decideToken({ pathname: KEY, session: me, row: row({ expiresAt: NOW }), now: NOW })).toThrow(refused);
  });

  it("refuses anything that is not a firm id and a random id", () => {
    for (const pathname of ["", "../x", `${FIRM}/../x`, `${FIRM}/a/b`, "bank.pdf", `${FIRM}/`]) {
      expect(() => decideToken({ pathname, session: me, row: row({ key: pathname }), now: NOW })).toThrow(refused);
    }
  });

  it("does not say why in the error", () => {
    expect.assertions(2);
    try {
      decideToken({ pathname: KEY, session: { userId: SOMEONE, firmId: FIRM }, row: row(), now: NOW });
    } catch (e) {
      expect((e as Error).message).not.toContain(KEY);
      expect((e as Error).message).not.toContain(ME);
    }
  });
});

describe("what arrived against what was declared", () => {
  it("accepts exactly the declared size", () => {
    expect(arrivalProblem(1000, { size: 1000 })).toBeNull();
  });
  it("refuses a different size, a missing object and an oversized one", () => {
    expect(arrivalProblem(1000, { size: 999 })).toMatch(/not the size that was declared/);
    expect(arrivalProblem(1000, { size: 1001 })).toMatch(/not the size that was declared/);
    expect(arrivalProblem(1000, null)).toMatch(/did not arrive/);
    expect(arrivalProblem(DIRECT_UPLOAD_BYTES + 1, { size: DIRECT_UPLOAD_BYTES + 1 })).toMatch(/larger than 50 MB/);
  });
});

describe("whether the deployment takes large uploads", () => {
  it("needs the Blob store chosen and the read-write token present", () => {
    expect(directUploadAvailable({ FILE_STORE: "vercel-blob", BLOB_READ_WRITE_TOKEN: "placeholder-token", VERCEL: "1" })).toBe(true);
    // The store id with OIDC alone cannot sign client tokens, so the small form stays.
    expect(directUploadAvailable({ FILE_STORE: "vercel-blob", BLOB_STORE_ID: "store_placeholder", VERCEL: "1" })).toBe(false);
    expect(directUploadAvailable({ FILE_STORE: "supabase", BLOB_READ_WRITE_TOKEN: "placeholder-token", VERCEL: "1" })).toBe(false);
    expect(directUploadAvailable({ FILE_STORE: "local", BLOB_READ_WRITE_TOKEN: "placeholder-token" })).toBe(false);
    expect(directUploadAvailable({})).toBe(false);
    // Hosted with no store chosen is a configuration error elsewhere; here it is simply not available.
    expect(directUploadAvailable({ VERCEL: "1" })).toBe(false);
  });

  it("shows the larger limit only when direct upload is on", () => {
    expect(workingPaperLimit({ FILE_STORE: "vercel-blob", BLOB_READ_WRITE_TOKEN: "placeholder-token", VERCEL: "1" })).toEqual({ bytes: DIRECT_UPLOAD_BYTES, label: "50 MB", direct: true });
    expect(workingPaperLimit({ FILE_STORE: "supabase", VERCEL: "1" })).toEqual({ bytes: 4 * 1024 * 1024, label: "4 MB", direct: false });
    expect(workingPaperLimit({})).toEqual({ bytes: 10 * 1024 * 1024, label: "10 MB", direct: false });
  });
});

describe("reading an object on the server", () => {
  const sdkWith = (objects: Record<string, Uint8Array>): BlobSdk => ({
    put: async () => ({}),
    del: async () => undefined,
    get: async (pathname) => (pathname in objects ? { statusCode: 200, stream: new Response(objects[pathname] as BodyInit).body } : null),
  });

  it("reports the size and the sha256 of the bytes it read", async () => {
    const data = new TextEncoder().encode("a scanned bank statement");
    const found = await inspectBlob(KEY, 1000, { sdk: sdkWith({ [KEY]: data }) });
    expect(found).toEqual({ size: data.byteLength, sha256: createHash("sha256").update(data).digest("hex") });
  });

  it("returns null when there is no such object", async () => {
    expect(await inspectBlob(KEY, 1000, { sdk: sdkWith({}) })).toBeNull();
  });

  it("stops reading once the object is over the limit", async () => {
    const found = await inspectBlob(KEY, 10, { sdk: sdkWith({ [KEY]: new Uint8Array(500) }) });
    expect(found?.size).toBeGreaterThan(10);
    expect(found?.sha256).toBe("");
  });

  it("refuses a key that is not two identifiers and does not put the key in an error", async () => {
    await expect(inspectBlob("../x", 10, { sdk: sdkWith({}) })).rejects.toThrow(/Invalid storage key/);
    const broken: BlobSdk = { put: async () => ({}), del: async () => undefined, get: async () => Promise.reject(new Error(`boom ${KEY} https://example.test/?token=secret`)) };
    await expect(inspectBlob(KEY, 10, { sdk: broken })).rejects.toThrow(/^File storage inspect failed\.$/);
  });
});

describe("streamed downloads", () => {
  it("sends the same bytes in chunks", async () => {
    const data = new Uint8Array(1000).map((_, i) => i % 251);
    const chunks: number[] = [];
    const reader = streamBytes(data, 300).getReader();
    const out: number[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value.byteLength);
      out.push(...value);
    }
    expect(chunks).toEqual([300, 300, 300, 100]);
    expect(Uint8Array.from(out)).toEqual(data);
  });

  it("an empty file is an empty stream", async () => {
    expect((await new Response(streamBytes(new Uint8Array(0))).arrayBuffer()).byteLength).toBe(0);
  });
});

describe("the words of the form", () => {
  it("checks the file in the browser before sending anything", () => {
    expect(clientFileProblem(null, 100)).toBe("Choose a file to upload.");
    expect(clientFileProblem({ size: 0 }, 100)).toBe("Choose a file to upload.");
    expect(clientFileProblem({ size: 101 }, 50 * 1024 * 1024)).toBeNull();
    expect(clientFileProblem({ size: 50 * 1024 * 1024 + 1 }, 50 * 1024 * 1024)).toBe("The file is larger than 50 MB.");
  });

  it("says each step", () => {
    expect(phaseText("preparing")).toBe("Preparing the upload.");
    expect(phaseText("uploading", 41.6)).toBe("Uploading, 42% sent.");
    expect(phaseText("uploading", 400)).toBe("Uploading, 100% sent.");
    expect(phaseText("checking")).toBe("Upload complete. Checking the file.");
    expect(megabytes(50 * 1024 * 1024)).toBe("50 MB");
  });

  it("names the larger limit and the spreadsheet limit only when uploads go direct", () => {
    const types = ["pdf", "xlsx"];
    expect(uploadHint({ direct: true, limitLabel: "50 MB", importLabel: "4 MB", types })).toBe("Up to 50 MB. Accepted types: pdf, xlsx. Spreadsheet imports (trial balances, journals and schedules) stay at 4 MB.");
    expect(uploadHint({ direct: false, limitLabel: "4 MB", importLabel: "4 MB", types })).toBe("Up to 4 MB. Accepted types: pdf, xlsx.");
  });
});
