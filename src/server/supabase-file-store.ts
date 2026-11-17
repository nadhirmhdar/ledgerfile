import { FILE_KEY, type FileStore } from "./file-store";

/**
 * File storage on Supabase Storage, through its REST API with plain fetch (the client library would add a dependency for three
 * calls). Server-only: the service role key can read and write every object, so it is read from the server's environment and
 * never given a NEXT_PUBLIC_ name. The bucket is private; there are no public or signed URLs, and downloads go through the app's
 * logged route.
 *
 * Errors name the operation and the HTTP status, never the URL, the key or the credentials.
 */
export interface SupabaseStoreOptions {
  url: string;
  serviceRoleKey: string;
  bucket: string;
  fetch?: typeof fetch;
}

export function supabaseFileStore(options: SupabaseStoreOptions): FileStore {
  if (typeof window !== "undefined") throw new Error("The storage adapter is server-only.");
  const base = options.url.replace(/\/+$/, "");
  const doFetch = options.fetch ?? fetch;
  const object = (key: string) => {
    // Refuse anything that is not exactly two identifiers, whatever the caller passed.
    if (!FILE_KEY.test(key)) throw new Error("Invalid storage key.");
    return `${base}/storage/v1/object/${encodeURIComponent(options.bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;
  };
  const auth = { Authorization: `Bearer ${options.serviceRoleKey}`, apikey: options.serviceRoleKey };
  const fail = (op: string, status: number) => new Error(`File storage ${op} failed (${status}).`);

  return {
    async put(key, data) {
      const res = await doFetch(object(key), { method: "POST", headers: { ...auth, "Content-Type": "application/octet-stream", "x-upsert": "false" }, body: data as BodyInit });
      // An existing object is a conflict, never replaced: one upload can not overwrite another.
      if (res.status === 409 || res.status === 400) {
        const text = await res.text().catch(() => "");
        if (res.status === 409 || /duplicate|already exists/i.test(text)) throw new Error("File storage put refused: the object already exists.");
        throw fail("put", res.status);
      }
      if (!res.ok) throw fail("put", res.status);
    },
    async get(key) {
      const res = await doFetch(object(key), { method: "GET", headers: auth });
      if (res.status === 404) return null;
      if (res.status === 400) {
        // Supabase answers 400 with a not_found body for a missing object in some versions.
        const text = await res.text().catch(() => "");
        if (/not.?found/i.test(text)) return null;
        throw fail("get", res.status);
      }
      if (!res.ok) throw fail("get", res.status);
      return new Uint8Array(await res.arrayBuffer());
    },
    async remove(key) {
      const res = await doFetch(object(key), { method: "DELETE", headers: auth });
      if (!res.ok && res.status !== 404) throw fail("remove", res.status);
    },
  };
}
