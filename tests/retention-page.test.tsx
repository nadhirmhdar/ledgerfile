import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "../src/server/db";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import type { FileStore } from "../src/server/file-store";
import { getRetention, type RetentionView } from "../src/server/retention";
import { NAME_MISMATCH, NOT_PARTNER, SAME_PERSON, checkYears, countsSentence } from "../src/domain/retention";
import { RetentionBody } from "../src/ui/retention-view";

let db: Db;
let current: { firmId: string; userId: string; role: string; name: string; firmName: string; email: string };
const mem = vi.hoisted(() => ({ files: new Map<string, Uint8Array>(), failing: false, removed: [] as string[] }));
const memStore: FileStore = {
  put: async (k, d) => void mem.files.set(k, d),
  get: async (k) => mem.files.get(k) ?? null,
  remove: async (k) => {
    if (mem.failing) throw new Error("the store is unavailable");
    mem.files.delete(k);
    mem.removed.push(k);
  },
};
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("../src/server/session", () => ({ getSession: async () => current, getOptionalSession: async () => current }));
vi.mock("../src/server/db", async (original) => {
  const real = await original<typeof import("../src/server/db")>();
  return { ...real, getDb: async () => db };
});
vi.mock("../src/server/file-store", async (original) => {
  const real = await original<typeof import("../src/server/file-store")>();
  return { ...real, getFileStore: () => memStore };
});

const A = "aaaaaaaa-7474-4000-8000-000000000001";
const user = (n: number, role: repo.Session["role"]): repo.Session => ({ firmId: A, userId: `${A.slice(0, 8)}-7474-4000-8000-00000000009${n}`, role });
const partner = user(1, "partner");
const partner2 = user(2, "partner");
const reviewer = user(3, "reviewer");
const preparer = user(4, "preparer");
const as = (s: repo.Session) => (current = { ...s, name: `${s.role} ${s.userId.slice(-1)}`, firmName: "Firm A", email: "x@x.test" });
type T = Parameters<Parameters<typeof withFirm>[2]>[0];
const inTx = <R,>(fn: (tx: T) => Promise<R>) => withFirm(db, A, fn);

let engagement: string;
let storageKey: string;

beforeAll(async () => {
  db = await openDatabase();
  await db.query("insert into firms (id, name, retention_years) values ($1, 'Firm A', 2)", [A]);
  for (const u of [partner, partner2, reviewer, preparer]) await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, A, `${u.userId}@x.test`, `${u.role} ${u.userId.slice(-1)}`, u.role]);
  engagement = await inTx(async (tx) => repo.createEngagement(tx, partner, await repo.createClient(tx, partner, "Page Test LLC"), "2020-01-01", "2020-12-31"));
  await db.query("update engagements set status = 'locked', locked_by = $2, locked_at = now() where id = $1", [engagement, partner.userId]);
  await db.query("update engagements set archived_at = now() - interval '5 years', archived_by = $2 where id = $1", [engagement, partner.userId]);
  storageKey = `${A}/dddddddd-7474-4000-8000-000000000001`;
  await db.query("insert into working_papers (firm_id, engagement_id, target_kind, file_name, size_bytes, sha256, storage_key, uploaded_by) values ($1, $2, 'engagement', 'a.txt', 1, 'x', $3, $4)", [A, engagement, storageKey, partner.userId]);
  mem.files.set(storageKey, new Uint8Array([1]));
});

afterAll(async () => {
  await db.close();
});

const empty = { ok: true, message: "" };
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

describe("the page and its actions", () => {
  it("is not found for a preparer and a reviewer, and renders for a partner", async () => {
    const { default: Page } = await import("../src/app/(app)/firm/retention/page");
    for (const s of [preparer, reviewer]) {
      as(s);
      await expect(Page(), s.role).rejects.toThrow();
    }
    as(partner);
    await expect(Page()).resolves.toBeDefined();
    // A session that claims to be a partner is not believed: the database says preparer.
    current = { ...as(preparer), role: "partner" };
    await expect(Page()).rejects.toThrow();
  });

  it("refuses a preparer and a reviewer on every action, creating nothing", async () => {
    const a = await import("../src/app/retention-actions");
    for (const s of [preparer, reviewer]) {
      as(s);
      const f = form({ engagementId: engagement, reason: "A reason that is long enough.", requestId: "1", typedName: "Page Test LLC" });
      for (const act of [a.requestDeletionAction, a.cancelDeletionAction, a.approveDeletionAction]) expect(await act(empty, f), s.role).toEqual({ ok: false, message: NOT_PARTNER });
      expect(await a.retryFilesAction()).toEqual({ ok: false, message: NOT_PARTNER });
    }
    expect((await db.query("select 1 from retention_deletions")).rows).toHaveLength(0);
  });

  it("runs the whole flow: request, refused self-approval, refused name, approval, files removed after the commit", async () => {
    const a = await import("../src/app/retention-actions");
    as(partner);
    const asked = await a.requestDeletionAction(empty, form({ engagementId: engagement, reason: "Past the period the firm set." }));
    expect(asked, asked.message).toMatchObject({ ok: true });
    const requestId = String((await inTx((tx) => getRetention(tx))).items[0].request!.id);
    expect(await a.approveDeletionAction(empty, form({ requestId, typedName: "Page Test LLC" }))).toEqual({ ok: false, message: SAME_PERSON });
    as(partner2);
    expect(await a.approveDeletionAction(empty, form({ requestId, typedName: "page test llc" }))).toEqual({ ok: false, message: NAME_MISMATCH });
    expect((await db.query("select 1 from engagements where id = $1", [engagement])).rows).toHaveLength(1);
    mem.failing = true;
    const failed = await a.approveDeletionAction(empty, form({ requestId, typedName: "Page Test LLC" }));
    expect(failed.ok).toBe(true);
    expect(failed.message).toContain("could not be removed from storage yet");
    expect((await db.query("select 1 from engagements where id = $1", [engagement])).rows).toHaveLength(0);
    expect((await inTx((tx) => getRetention(tx))).pendingFiles.map((f) => f.key)).toEqual([storageKey]);
    mem.failing = false;
    as(reviewer);
    expect(await a.retryFilesAction()).toEqual({ ok: false, message: NOT_PARTNER });
    as(partner);
    expect(await a.retryFilesAction()).toEqual({ ok: true, message: "Removed 1 file." });
    expect(mem.removed).toContain(storageKey);
    expect(await a.retryFilesAction()).toEqual({ ok: true, message: "No files are waiting to be removed." });
  }, 120_000);

  it("sets the period only for an administrator", async () => {
    const a = await import("../src/app/retention-actions");
    as(partner);
    expect((await a.setRetentionAction(empty, form({ years: "9" }))).ok).toBe(false);
  });
});

describe("the words", () => {
  const item = (over: Partial<RetentionView["items"][number]> = {}): RetentionView["items"][number] => ({
    engagementId: "e1",
    clientName: "Invented Co LLC",
    periodStart: "2020-01-01",
    periodEnd: "2020-12-31",
    archivedOn: "2021-02-01",
    eligibleFrom: "2024-02-01",
    eligible: true,
    request: null,
    ...over,
  });
  const view = (over: Partial<RetentionView> = {}): RetentionView => ({ years: 3, partners: 2, items: [item()], purged: [], pendingFiles: [], ...over });
  const html = (v: RetentionView, me = "u1") => renderToStaticMarkup(<RetentionBody view={v} me={me} />);

  it("says plainly when no period is set, and offers no request", () => {
    const h = html(view({ years: null, items: [item({ eligible: false, eligibleFrom: null })] }));
    expect(h).toContain("No retention period is set");
    expect(h).toContain("No period set");
    expect(h).not.toContain("Request deletion of this file");
  });
  it("offers a request for an eligible file only, and says what is deleted and what is kept", () => {
    const h = html(view());
    expect(h).toContain("Request deletion of this file");
    expect(h).toContain("Deleting cannot be undone");
    expect(h).toContain("Kept: the audit log");
    expect(html(view({ items: [item({ eligible: false })] }))).not.toContain("Request deletion of this file");
  });
  it("shows a pending request to its requester without an approve form, and to another partner with one", () => {
    const request = { id: 5, state: "pending" as const, requester: "Pia Partner", requesterId: "u1", at: "2026-03-01 10:00", reason: "Past the period.", counts: { accounts: 12, working_papers: 3 }, cancelledBy: null, cancelledAt: null };
    const mine = html(view({ items: [item({ request })] }), "u1");
    expect(mine).toContain("a different partner has to approve it");
    expect(mine).not.toContain("Approve and delete");
    expect(mine).toContain("Cancel this request");
    const other = html(view({ items: [item({ request })] }), "u2");
    expect(other).toContain("Approve and delete");
    // The one irreversible action is the danger variant, not the cobalt primary.
    expect(/<button[^>]*text-danger-strong[^>]*>Approve and delete</button>/.test(other)).toBe(true);
    expect(/<button[^>]*bg-accent[^>]*>Approve and delete/.test(other)).toBe(false);
    expect(other).toContain("to delete this file");
    expect(other).toContain("12 trial balance accounts, 3 working papers (and their files)");
    expect(html(view({ partners: 1, items: [item({ request })] }), "u2")).not.toContain("Approve and delete");
    expect(html(view({ partners: 1 }))).toContain("only one");
  });
  it("lists the files still to remove with a retry, and the deleted files", () => {
    const h = html(view({ pendingFiles: [{ id: 1, key: "k/1", purgeId: 1, clientName: "Gone LLC" }], purged: [{ purgeId: 1, clientName: "Gone LLC", periodStart: "2019-01-01", periodEnd: "2019-12-31", archivedOn: "2020-02-01", purgedOn: "2026-03-01", counts: { accounts: 4, engagements: 1 } }] }));
    expect(h).toContain("Files still to remove");
    expect(h).toContain("Try again to remove these files");
    expect(h).toContain("Deleted files");
    expect(h).toContain("Removed 5 rows");
  });
  it("states no legal retention period anywhere", () => {
    const sources = ["src/domain/retention.ts", "src/ui/retention-view.tsx", "src/app/(app)/firm/retention/page.tsx", "src/app/(app)/firm/page.tsx"].map((p) => readFileSync(path.join(process.cwd(), p), "utf8")).join("\n");
    const rendered = html(view()) + html(view({ years: null }));
    const banned = /required by law|statutory|legally required|the law requires|minimum (retention|period)|\b(five|seven|ten|5|7|10)[- ]year retention/i;
    for (const text of [sources, rendered]) expect(text).not.toMatch(banned);
    expect(readFileSync(path.join(process.cwd(), "db/migrations/0034_retention.sql"), "utf8")).not.toMatch(/required by law|statutory period|legally required/i);
  });
  it("checks the period and words the counts", () => {
    expect(checkYears("")).toEqual({ ok: true, years: null });
    expect(checkYears("7")).toEqual({ ok: true, years: 7 });
    expect(checkYears("0").ok).toBe(false);
    expect(checkYears("31").ok).toBe(false);
    expect(checkYears("1.5").ok).toBe(false);
    expect(countsSentence({})).toBe("nothing but the engagement itself");
    expect(countsSentence({ sign_offs: 2, engagements: 1 })).toBe("2 sign-offs, the engagement");
    expect(countsSentence({ tb_imports: 1, journal_entries: 1, working_papers: 1, accounts: 3 })).toBe("3 trial balance accounts, 1 trial balance import, 1 journal entry, 1 working paper (and their files)".split(", ").sort((a, b) => ["1 trial balance import", "1 journal entry", "1 working paper (and their files)", "3 trial balance accounts"].indexOf(a) - ["1 trial balance import", "1 journal entry", "1 working paper (and their files)", "3 trial balance accounts"].indexOf(b)).join(", "));
  });
});
