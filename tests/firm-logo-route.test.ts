import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "../src/server/db";
import { openDatabase } from "../src/server/db";
import * as auth from "../src/server/auth";
import { uploadLogo } from "../src/server/branding";
import { makeJpeg, makePng } from "./image-fixtures";

const mem = vi.hoisted(() => ({ files: new Map<string, Uint8Array>() }));
const memStore = {
  put: async (k: string, d: Uint8Array) => void mem.files.set(k, d),
  get: async (k: string) => mem.files.get(k) ?? null,
  remove: async (k: string) => void mem.files.delete(k),
};
let db: Db;
let current: { firmId: string; userId: string } | null;
vi.mock("../src/server/session", () => ({ getSession: async () => current, getOptionalSession: async () => current }));
vi.mock("../src/server/db", async (original) => {
  const real = await original<typeof import("../src/server/db")>();
  return { ...real, getDb: async () => db };
});
vi.mock("../src/server/file-store", async (original) => {
  const real = await original<typeof import("../src/server/file-store")>();
  return { ...real, getFileStore: () => memStore };
});

const A = "aaaaaaaa-5050-4000-8000-000000000001";
const B = "bbbbbbbb-5050-4000-8000-000000000001";
const adminA: auth.AuthSession = { firmId: A, userId: "aaaaaaaa-5050-4000-8000-000000000011", name: "Ada Admin", email: "ada@a.test", role: "admin", firmName: "Firm A" };
const userB = { firmId: B, userId: "bbbbbbbb-5050-4000-8000-000000000011" };

beforeAll(async () => {
  db = await openDatabase();
  await db.query("insert into firms (id, name) values ($1, 'Firm A'), ($2, 'Firm B')", [A, B]);
  await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, 'Ada Admin', 'admin'), ($4, $5, $6, 'Ben Admin', 'admin')", [adminA.userId, A, adminA.email, userB.userId, B, "ben@b.test"]);
});

afterAll(async () => {
  await db.close();
});

describe("GET /firm/logo", () => {
  it("is not found when no logo is set, and when nobody is signed in", async () => {
    const { GET } = await import("../src/app/(app)/firm/logo/route");
    current = { firmId: A, userId: adminA.userId };
    expect((await GET()).status).toBe(404);
    await uploadLogo(db, adminA, makePng(80, 40), memStore);
    current = null;
    const res = await GET();
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
  });

  it("serves the firm's own logo to its signed-in users, never cached and never sniffed", async () => {
    const { GET } = await import("../src/app/(app)/firm/logo/route");
    current = { firmId: A, userId: "aaaaaaaa-5050-4000-8000-000000000099" };
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(Buffer.from(await res.arrayBuffer()).equals(makePng(80, 40))).toBe(true);
  });

  it("is not found for another firm's user, whatever the request says, and shows each firm its own", async () => {
    const { GET } = await import("../src/app/(app)/firm/logo/route");
    current = userB;
    expect((await GET()).status).toBe(404);
    // Firm B's own logo is a different file; firm A's user never gets it.
    const adminB: auth.AuthSession = { firmId: B, userId: userB.userId, name: "Ben Admin", email: "ben@b.test", role: "admin", firmName: "Firm B" };
    await uploadLogo(db, adminB, makeJpeg(90, 50), memStore);
    const b = await GET();
    expect(b.headers.get("content-type")).toBe("image/jpeg");
    expect(Buffer.from(await b.arrayBuffer()).equals(makeJpeg(90, 50))).toBe(true);
    current = { firmId: A, userId: adminA.userId };
    const a = await GET();
    expect(a.headers.get("content-type")).toBe("image/png");
  });

  it("has no public address: the route takes no parameter that could name a file or a firm", async () => {
    const { GET } = await import("../src/app/(app)/firm/logo/route");
    expect(GET.length).toBe(0);
  });
});
