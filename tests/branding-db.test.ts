import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/server/db";
import { openDatabase, withAuth, withFirm } from "../src/server/db";
import * as auth from "../src/server/auth";
import { getBranding, loadBrandingForOutputs, readLogo, removeLogo, updateBranding, uploadLogo } from "../src/server/branding";
import type { FileStore } from "../src/server/file-store";
import { makeJpeg, makePng, svgBytes } from "./image-fixtures";

const FIRM = "aaaaaaaa-3030-4000-8000-000000000001";
const OTHER = "bbbbbbbb-3030-4000-8000-000000000001";
const person = (id: string, firm: string, role: string, name: string): auth.AuthSession => ({ firmId: firm, userId: id, name, email: `${name.toLowerCase().replace(/ /g, ".")}@x.test`, role: role as auth.Role, firmName: "Firm" });
const admin = person("aaaaaaaa-3030-4000-8000-000000000011", FIRM, "admin", "Ada Admin");
const partner = person("aaaaaaaa-3030-4000-8000-000000000012", FIRM, "partner", "Pat Partner");
const reviewer = person("aaaaaaaa-3030-4000-8000-000000000013", FIRM, "reviewer", "Rae Reviewer");
const preparer = person("aaaaaaaa-3030-4000-8000-000000000014", FIRM, "preparer", "Pia Preparer");
const otherAdmin = person("bbbbbbbb-3030-4000-8000-000000000011", OTHER, "admin", "Ben Admin");

let db: Db;
const files = new Map<string, Uint8Array>();
const store: FileStore = {
  put: async (key, data) => {
    if (files.has(key)) throw new Error("exists");
    files.set(key, data);
  },
  get: async (key) => files.get(key) ?? null,
  remove: async (key) => void files.delete(key),
};
const row = async (id: string) => (await db.query<Record<string, unknown>>("select name, address, contact_line, registration_line, logo_key, logo_content_type, logo_bytes, logo_sha256, branding_updated_at from firms where id = $1", [id])).rows[0];
const log = async (firm: string, action: string) => (await db.query<{ user_id: string; detail: Record<string, unknown>; entity: string; entity_id: string }>("select user_id, detail, entity, entity_id from audit_log where firm_id = $1 and action = $2 order by id", [firm, action])).rows;
const details = { address: "Office 12\nBusiness Bay\nDubai", contactLine: "info@demo.test", registrationLine: "Licence 123" };

beforeAll(async () => {
  db = await openDatabase();
  await db.query("insert into firms (id, name) values ($1, 'Demo Audit Firm'), ($2, 'Other Firm')", [FIRM, OTHER]);
  for (const p of [admin, partner, reviewer, preparer, otherAdmin]) {
    await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [p.userId, p.firmId, p.email, p.name, p.role]);
    await auth.setPassword(db, p.userId, "invented-passphrase-1");
  }
});

afterAll(async () => {
  await db.close();
});

describe("a firm starts with no branding", () => {
  it("has every column null, and loads as an empty branding", async () => {
    const r = await row(FIRM);
    expect(r).toMatchObject({ name: "Demo Audit Firm", address: null, contact_line: null, registration_line: null, logo_key: null, logo_content_type: null, logo_bytes: null, logo_sha256: null, branding_updated_at: null });
    expect(await withFirm(db, FIRM, (tx) => getBranding(tx))).toEqual({ firmName: "Demo Audit Firm", address: null, contactLine: null, registrationLine: null, hasLogo: false, logoContentType: null, logoBytes: null, updatedAt: null });
    expect(await withFirm(db, FIRM, (tx) => loadBrandingForOutputs(tx, () => store))).toEqual({ firmName: "Demo Audit Firm", address: null, contactLine: null, registrationLine: null, logo: null });
  });
});

describe("only an administrator can change the branding", () => {
  it("refuses a partner, a reviewer and a preparer, for the details and for the logo, and stores nothing", async () => {
    for (const s of [partner, reviewer, preparer]) {
      await expect(updateBranding(db, s, details), s.name).rejects.toThrow(/Only an administrator/);
      await expect(uploadLogo(db, s, makePng(), store), s.name).rejects.toThrow(/Only an administrator/);
      await expect(removeLogo(db, s, store), s.name).rejects.toThrow(/Only an administrator/);
    }
    expect(files.size).toBe(0);
    expect((await row(FIRM)).address).toBeNull();
    expect(await log(FIRM, "update_branding")).toHaveLength(0);
  });

  it("re-reads the role from the database, so a stale session that says admin is not enough", async () => {
    const stale = { ...partner, role: "admin" as auth.Role };
    await expect(updateBranding(db, stale, details)).rejects.toThrow(/Only an administrator/);
    await expect(uploadLogo(db, stale, makePng(), store)).rejects.toThrow(/Only an administrator/);
    expect(files.size).toBe(0);
  });

  it("lets an administrator save the details, and logs which lines were set", async () => {
    await updateBranding(db, admin, details);
    expect(await row(FIRM)).toMatchObject({ address: "Office 12\nBusiness Bay\nDubai", contact_line: "info@demo.test", registration_line: "Licence 123", name: "Demo Audit Firm" });
    expect((await row(FIRM)).branding_updated_at).not.toBeNull();
    const entries = await log(FIRM, "update_branding");
    expect(entries).toEqual([{ user_id: admin.userId, entity: "firm", entity_id: FIRM, detail: { address: true, contactLine: true, registrationLine: true } }]);
  });

  it("clears a line when it is left blank, and refuses text that is too long", async () => {
    await updateBranding(db, admin, { ...details, contactLine: "  " });
    expect((await row(FIRM)).contact_line).toBeNull();
    await expect(updateBranding(db, admin, { ...details, address: "x".repeat(301) })).rejects.toThrow(/address is too long/);
    expect((await row(FIRM)).address).toBe("Office 12\nBusiness Bay\nDubai");
  });
});

describe("another firm", () => {
  it("cannot read or change this firm's branding, and an administrator changes only their own firm", async () => {
    expect(await withFirm(db, OTHER, (tx) => getBranding(tx))).toMatchObject({ firmName: "Other Firm", address: null });
    await updateBranding(db, otherAdmin, { address: "Elsewhere", contactLine: "", registrationLine: "" });
    expect((await row(OTHER)).address).toBe("Elsewhere");
    expect((await row(FIRM)).address).toBe("Office 12\nBusiness Bay\nDubai");
    // Tenant work never writes the firms table at all.
    await expect(withFirm(db, FIRM, (tx) => tx.query("update firms set address = 'x'"))).rejects.toThrow(/permission denied/);
    // The sign-in role may write only the branding columns, never the name.
    await expect(withAuth(db, (q) => q.query("update firms set name = 'Renamed' where id = $1", [FIRM]))).rejects.toThrow(/permission denied/);
    expect((await row(FIRM)).name).toBe("Demo Audit Firm");
  });
});

describe("the logo", () => {
  let first: string;
  it("is checked before anything is stored: an SVG renamed .png, a GIF and an oversize picture are refused", async () => {
    await expect(uploadLogo(db, admin, svgBytes(), store)).rejects.toThrow(/PNG or JPEG/);
    await expect(uploadLogo(db, admin, makePng(20, 20), store)).rejects.toThrow(/too small/);
    await expect(uploadLogo(db, admin, Buffer.alloc(0), store)).rejects.toThrow(/Choose an image/);
    expect(files.size).toBe(0);
    expect((await row(FIRM)).logo_key).toBeNull();
    expect(await log(FIRM, "upload_logo")).toHaveLength(0);
  });

  it("is stored under a server key in the firm's own prefix, with its type, size and sha256, and logged", async () => {
    const png = makePng(80, 40);
    const result = await uploadLogo(db, admin, png, store);
    expect(result).toEqual({ contentType: "image/png", bytes: png.length, width: 80, height: 40 });
    const r = await row(FIRM);
    first = String(r.logo_key);
    expect(first).toMatch(new RegExp(`^${FIRM}/[0-9a-f-]{36}$`));
    expect(r).toMatchObject({ logo_content_type: "image/png", logo_bytes: png.length, logo_sha256: createHash("sha256").update(png).digest("hex") });
    expect(files.get(first)).toEqual(png);
    const entries = await log(FIRM, "upload_logo");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ user_id: admin.userId, detail: { contentType: "image/png", bytes: png.length, width: 80, height: 40, sha256: r.logo_sha256 } });
    // No URL or token is recorded anywhere.
    expect(JSON.stringify([r, entries])).not.toMatch(/https?:|token/i);
  });

  it("is read back for the firm only, checked against its hash", async () => {
    const mine = await withFirm(db, FIRM, (tx) => readLogo(tx, () => store));
    expect(mine?.contentType).toBe("image/png");
    expect(await withFirm(db, OTHER, (tx) => readLogo(tx, () => store))).toBeNull();
    // A file that has changed in the store is not served.
    files.set(first, Buffer.from("tampered"));
    expect(await withFirm(db, FIRM, (tx) => readLogo(tx, () => store))).toBeNull();
    files.set(first, makePng(80, 40));
  });

  it("is replaced by a new one under a new key, and the old file is removed after", async () => {
    const jpg = makeJpeg(120, 60);
    await uploadLogo(db, admin, jpg, store);
    const r = await row(FIRM);
    expect(r.logo_key).not.toBe(first);
    expect(r).toMatchObject({ logo_content_type: "image/jpeg", logo_bytes: jpg.length });
    expect(files.has(first)).toBe(false);
    expect(files.has(String(r.logo_key))).toBe(true);
    expect(files.size).toBe(1);
  });

  it("loads for the outputs with its size from its own header, and an interlaced or unreadable one is left out", async () => {
    const b = await withFirm(db, FIRM, (tx) => loadBrandingForOutputs(tx, () => store));
    expect(b.logo).toMatchObject({ contentType: "image/jpeg", width: 120, height: 60 });
    expect(b.address).toBe("Office 12\nBusiness Bay\nDubai");
    const key = String((await row(FIRM)).logo_key);
    files.delete(key);
    expect((await withFirm(db, FIRM, (tx) => loadBrandingForOutputs(tx, () => store))).logo).toBeNull();
    files.set(key, makeJpeg(120, 60));
  });

  it("is removed by an administrator only, the file with it, and logged", async () => {
    await expect(removeLogo(db, partner, store)).rejects.toThrow(/Only an administrator/);
    expect(files.size).toBe(1);
    await removeLogo(db, admin, store);
    expect(files.size).toBe(0);
    expect(await row(FIRM)).toMatchObject({ logo_key: null, logo_content_type: null, logo_bytes: null, logo_sha256: null });
    expect(await log(FIRM, "remove_logo")).toHaveLength(1);
    await expect(removeLogo(db, admin, store)).rejects.toThrow(/no logo to remove/);
    // The details stay.
    expect((await row(FIRM)).address).toBe("Office 12\nBusiness Bay\nDubai");
  });

  it("leaves nothing behind when recording fails after the file was stored", async () => {
    const failing = { ...admin, firmId: "cccccccc-3030-4000-8000-000000000001" };
    // A user of a firm that does not exist is not an administrator of anything: refused before any file is stored.
    await expect(uploadLogo(db, failing, makePng(), store)).rejects.toThrow(/Only an administrator/);
    expect(files.size).toBe(0);
  });
});

describe("the table's own checks", () => {
  it("refuses a logo that is half recorded, or that points at another firm's prefix", async () => {
    await expect(db.query("update firms set logo_key = $2 where id = $1", [FIRM, `${FIRM}/aaaaaaaa-0000-4000-8000-000000000001`])).rejects.toThrow();
    await expect(db.query("update firms set logo_key = $2, logo_content_type = 'image/png', logo_bytes = 10, logo_sha256 = repeat('a', 64) where id = $1", [FIRM, `${OTHER}/aaaaaaaa-0000-4000-8000-000000000001`])).rejects.toThrow();
    await expect(db.query("update firms set logo_key = $2, logo_content_type = 'image/svg+xml', logo_bytes = 10, logo_sha256 = repeat('a', 64) where id = $1", [FIRM, `${FIRM}/aaaaaaaa-0000-4000-8000-000000000001`])).rejects.toThrow();
    await expect(db.query("update firms set address = $2 where id = $1", [FIRM, "x".repeat(301)])).rejects.toThrow();
    expect((await row(FIRM)).logo_key).toBeNull();
  });
});
