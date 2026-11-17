import { describe, expect, it } from "vitest";
import { fileStoreKind } from "../src/server/file-store";
import { supabaseFileStore } from "../src/server/supabase-file-store";

const KEY = "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222";
const SERVICE_KEY = "placeholder-service-role-key";
const opts = { url: "https://project.example.test", serviceRoleKey: SERVICE_KEY, bucket: "papers" };

interface Call {
  url: string;
  init: RequestInit;
}
function mock(status: number, body = "") {
  const calls: Call[] = [];
  const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(body, { status });
  }) as typeof fetch;
  return { calls, fetchMock };
}

describe("supabaseFileStore", () => {
  it("accepts only keys that are exactly two identifiers", async () => {
    const { fetchMock, calls } = mock(200);
    const store = supabaseFileStore({ ...opts, fetch: fetchMock });
    for (const bad of ["../x", "a/b", `${KEY}/extra`, "", "11111111-1111-4111-8111-111111111111", `${KEY}?x=1`]) {
      await expect(store.put(bad, new Uint8Array([1]))).rejects.toThrow("Invalid storage key.");
      await expect(store.get(bad)).rejects.toThrow("Invalid storage key.");
      await expect(store.remove(bad)).rejects.toThrow("Invalid storage key.");
    }
    expect(calls).toHaveLength(0);
  });

  it("puts without upserting, to the private object path", async () => {
    const { fetchMock, calls } = mock(200);
    await supabaseFileStore({ ...opts, fetch: fetchMock }).put(KEY, new Uint8Array([1, 2, 3]));
    expect(calls[0].url).toBe(`https://project.example.test/storage/v1/object/papers/${KEY}`);
    expect(calls[0].init.method).toBe("POST");
    expect((calls[0].init.headers as Record<string, string>)["x-upsert"]).toBe("false");
    expect(calls[0].url).not.toContain("/public/");
  });

  it("treats an existing object as an error, never a replacement", async () => {
    for (const [status, body] of [[409, ""], [400, '{"error":"Duplicate","message":"The resource already exists"}']] as const) {
      const { fetchMock } = mock(status, body);
      await expect(supabaseFileStore({ ...opts, fetch: fetchMock }).put(KEY, new Uint8Array([1]))).rejects.toThrow(/already exists/);
    }
  });

  it("returns null for an object that is not there", async () => {
    expect(await supabaseFileStore({ ...opts, fetch: mock(404).fetchMock }).get(KEY)).toBeNull();
    expect(await supabaseFileStore({ ...opts, fetch: mock(400, '{"statusCode":"404","error":"not_found"}').fetchMock }).get(KEY)).toBeNull();
  });

  it("returns the bytes it finds", async () => {
    const got = await supabaseFileStore({ ...opts, fetch: mock(200, "abc").fetchMock }).get(KEY);
    expect(Array.from(got ?? [])).toEqual([97, 98, 99]);
  });

  it("removes, and does not mind a missing object", async () => {
    await expect(supabaseFileStore({ ...opts, fetch: mock(200).fetchMock }).remove(KEY)).resolves.toBeUndefined();
    await expect(supabaseFileStore({ ...opts, fetch: mock(404).fetchMock }).remove(KEY)).resolves.toBeUndefined();
  });

  it("keeps the key and the credentials out of URLs and error messages", async () => {
    const { fetchMock, calls } = mock(500);
    const store = supabaseFileStore({ ...opts, fetch: fetchMock });
    const errors: string[] = [];
    for (const run of [() => store.put(KEY, new Uint8Array([1])), () => store.get(KEY), () => store.remove(KEY)]) {
      await run().catch((e: Error) => errors.push(e.message));
    }
    expect(errors).toEqual(["File storage put failed (500).", "File storage get failed (500).", "File storage remove failed (500)."]);
    for (const c of calls) {
      expect(c.url).not.toContain(SERVICE_KEY);
      expect(c.url).not.toContain("apikey");
      expect(c.url).not.toContain("token");
    }
    for (const e of errors) {
      expect(e).not.toContain(SERVICE_KEY);
      expect(e).not.toContain(KEY);
      expect(e).not.toContain("example.test");
    }
    // The credentials travel in headers only.
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SERVICE_KEY}`);
  });
});

describe("fileStoreKind", () => {
  it("is local by default when not hosted", () => {
    expect(fileStoreKind({})).toBe("local");
  });
  it("follows FILE_STORE", () => {
    expect(fileStoreKind({ FILE_STORE: "supabase" })).toBe("supabase");
    expect(fileStoreKind({ FILE_STORE: "Local", VERCEL: "1" })).toBe("local");
  });
  it("fails closed when hosted and FILE_STORE is not chosen", () => {
    expect(() => fileStoreKind({ VERCEL: "1" })).toThrow(/FILE_STORE/);
    expect(() => fileStoreKind({ DATABASE_URL: "postgres://placeholder" })).toThrow(/FILE_STORE/);
  });
});
