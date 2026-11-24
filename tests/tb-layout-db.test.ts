import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "../src/server/db";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";

let db: Db;
let current: repo.Session;
vi.mock("../src/server/session", () => ({ getSession: async () => current, getOptionalSession: async () => current }));
vi.mock("../src/server/db", async (original) => {
  const real = await original<typeof import("../src/server/db")>();
  return { ...real, getDb: async () => db };
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const { uploadTrialBalanceAction, forgetTbLayoutAction } = await import("../src/app/actions");

const X = "aaaaaaaa-3838-4000-8000-000000000001";
const Y = "bbbbbbbb-3838-4000-8000-000000000001";
const user = (n: number, role: repo.Session["role"], firmId = X): repo.Session => ({ firmId, userId: `${firmId.slice(0, 8)}-3838-4000-8000-00000000001${n}`, role });
const preparer = user(1, "preparer");
const reviewer = user(2, "reviewer");
const partner = user(4, "partner");
const partnerY = user(3, "partner", Y);

/** A sheet the automatic detection cannot read, then the same client's next year: other year in a heading, a new column, columns moved. */
const ODD_2024 = "Head,Closing amt Dr,Closing amt Cr,Yr 2023\nCash at bank,1000.00,,900.00\nShare capital,,1000.00,-900.00\n";
const ODD_2025 = "Note,Yr 2024,Closing amt Cr,HEAD,Closing amt Dr\nx,800.00,,Cash at bank,1200.00\ny,-800.00,1200.00,Share capital,\n";
const STANDARD = "Account Code,Account Name,Debit,Credit\n1000,Bank,500.00,\n3000,Capital,,500.00\n";
const CHOICE = { headerRow: "0", role_0: "name", role_1: "debit", role_2: "credit", role_3: "prior" };

const upload = (engagementId: string, csv: string, extra: Record<string, string> = {}, as: repo.Session = preparer) => {
  current = as;
  const form = new FormData();
  form.set("engagementId", engagementId);
  form.set("file", new File([csv], "tb.csv", { type: "text/csv" }));
  for (const [k, v] of Object.entries(extra)) form.set(k, v);
  return uploadTrialBalanceAction({ ok: true, message: "" }, form);
};
const forget = (engagementId: string, as: repo.Session) => {
  current = as;
  const form = new FormData();
  form.set("engagementId", engagementId);
  return forgetTbLayoutAction(form);
};
const accounts = async (engagementId: string) => (await db.query("select 1 from accounts where engagement_id = $1", [engagementId])).rows.length;
const layoutOf = async (clientId: string) => (await db.query<{ tb_layout: { headings: Record<string, string> } | null }>("select tb_layout from clients where id = $1", [clientId])).rows[0].tb_layout;
const importLayout = async (engagementId: string) => (await db.query<{ layout: { source: string } | null }>("select layout from tb_imports where engagement_id = $1 order by imported_at desc, id desc limit 1", [engagementId])).rows[0]?.layout ?? null;
const logs = async (action: string) => (await db.query<{ entity_id: string; user_id: string }>("select entity_id, user_id from audit_log where action = $1 order by id", [action])).rows;

let clientA: string;
let clientB: string;
let clientY: string;
let e2024: string;
let e2025: string;
let eB: string;
let eY: string;

beforeAll(async () => {
  db = await openDatabase();
  for (const firm of [X, Y]) await db.query("insert into firms (id, name) values ($1, 'Firm')", [firm]);
  for (const u of [preparer, reviewer, partner, partnerY]) {
    await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, u.firmId, `${u.userId}@x.test`, `${u.role} ${u.userId.slice(-1)}`, u.role]);
  }
  await withFirm(db, X, async (tx) => {
    clientA = await repo.createClient(tx, partner, "Client A");
    clientB = await repo.createClient(tx, partner, "Client B");
    const p = partner;
    e2024 = await repo.createEngagement(tx, p, clientA, "2024-01-01", "2024-12-31");
    e2025 = await repo.createEngagement(tx, p, clientA, "2025-01-01", "2025-12-31");
    eB = await repo.createEngagement(tx, p, clientB, "2025-01-01", "2025-12-31");
  });
  await withFirm(db, Y, async (tx) => {
    clientY = await repo.createClient(tx, partnerY, "Client Y");
    eY = await repo.createEngagement(tx, partnerY, clientY, "2025-01-01", "2025-12-31");
  });
});

afterAll(async () => {
  await db.close();
});

describe("a sheet the automatic detection cannot read", () => {
  it("does not import: it shows the first rows and asks which column is which", async () => {
    const state = await upload(e2024, ODD_2024);
    expect(state.ok).toBe(false);
    expect(state.message).toContain("Could not find a header row");
    expect(state.preview).toMatchObject({ fileName: "tb.csv", columnCount: 4, headerRow: 0, selected: {} });
    expect(state.preview!.rows).toHaveLength(3);
    expect(await accounts(e2024)).toBe(0);
    expect(await layoutOf(clientA)).toBeNull();
  });

  it("refuses an incomplete choice in plain words, and shows the chooser again with the choices kept", async () => {
    const state = await upload(e2024, ODD_2024, { headerRow: "0", role_0: "name", role_1: "debit" });
    expect(state.ok).toBe(false);
    expect(state.message).toBe("Choose both a Debit and a Credit column, or use one Balance column.");
    expect(state.preview?.selected).toEqual({ 0: "name", 1: "debit" });
    expect(await accounts(e2024)).toBe(0);
    const clash = await upload(e2024, ODD_2024, { headerRow: "0", role_0: "name", role_1: "debit", role_2: "debit" });
    expect(clash.message).toContain("Each role can be one column only");
  });

  it("imports with the chosen columns, says so, and remembers the headings for the client", async () => {
    const state = await upload(e2024, ODD_2024, CHOICE);
    expect(state).toMatchObject({ ok: true });
    expect(state.message).toContain("Imported 2 accounts");
    expect(state.message).toContain("Columns you chose.");
    expect(await accounts(e2024)).toBe(2);
    expect(await layoutOf(clientA)).toMatchObject({ headings: { name: "Head", debit: "Closing amt Dr", credit: "Closing amt Cr", prior: "Yr 2023" } });
    expect(await importLayout(e2024)).toMatchObject({ source: "chosen" });
    expect((await logs("save_tb_layout")).map((l) => [l.entity_id, l.user_id])).toEqual([[clientA, preparer.userId]]);
  });

  it("never trusts the browser: a chosen layout that does not balance is refused, with the chooser again", async () => {
    const state = await upload(eB, "Head,Closing amt Dr,Closing amt Cr\nCash,1000.00,\nCapital,,900.00\n", { headerRow: "0", role_0: "name", role_1: "debit", role_2: "credit" });
    expect(state.ok).toBe(false);
    expect(state.message).toContain("does not balance");
    expect(state.preview).toBeDefined();
    expect(await accounts(eB)).toBe(0);
    expect(await layoutOf(clientB)).toBeNull();
  });
});

describe("the next upload for the same client", () => {
  it("uses the remembered headings with no chooser, even with another year in a heading, an extra column and the columns moved", async () => {
    const state = await upload(e2025, ODD_2025);
    expect(state).toMatchObject({ ok: true });
    expect(state.preview).toBeUndefined();
    expect(state.message).toContain("Columns as remembered for this client.");
    expect(await accounts(e2025)).toBe(2);
    const read = (await db.query<{ code: string; closing_minor: string; prior_minor: string }>("select code, closing_minor::text, prior_minor::text from accounts where engagement_id = $1 order by code", [e2025])).rows;
    expect(read).toEqual([{ code: "Cash at bank", closing_minor: "120000", prior_minor: "80000" }, { code: "Share capital", closing_minor: "-120000", prior_minor: "-80000" }]);
    expect(await importLayout(e2025)).toMatchObject({ source: "remembered" });
  });

  it("asks again when the user chooses the columns, whatever is remembered", async () => {
    const state = await upload(e2025, ODD_2025, { chooseColumns: "1" });
    expect(state.ok).toBe(false);
    expect(state.preview).toBeDefined();
    expect(await accounts(e2025)).toBe(2);
  });

  it("does not use one client's layout for another client of the same firm, or for another firm", async () => {
    const other = await upload(eB, ODD_2025);
    expect(other.preview).toBeDefined();
    expect(await accounts(eB)).toBe(0);
    const otherFirm = await upload(eY, ODD_2024, {}, partnerY);
    expect(otherFirm.preview).toBeDefined();
    expect(await layoutOf(clientY)).toBeNull();
  });
});

describe("a file it can already read", () => {
  it("is detected as before, and its columns are remembered too", async () => {
    const state = await upload(eB, STANDARD);
    expect(state).toMatchObject({ ok: true });
    expect(state.message).toContain("Imported 2 accounts");
    expect(state.message).toContain("Columns detected.");
    expect(state.preview).toBeUndefined();
    expect(await importLayout(eB)).toMatchObject({ source: "detected" });
    expect(await layoutOf(clientB)).toMatchObject({ headings: { code: "Account Code", name: "Account Name", debit: "Debit", credit: "Credit" } });
  });

  it("reads the same file the next time from what is remembered, with the same accounts", async () => {
    const before = (await db.query("select code, name, closing_minor::text from accounts where engagement_id = $1 order by code", [eB])).rows;
    const state = await upload(eB, STANDARD);
    expect(state.message).toContain("Columns as remembered for this client.");
    expect((await db.query("select code, name, closing_minor::text from accounts where engagement_id = $1 order by code", [eB])).rows).toEqual(before);
  });
});

describe("forgetting the remembered columns", () => {
  it("is for a reviewer or partner: a preparer's request changes nothing", async () => {
    await forget(e2024, preparer);
    expect(await layoutOf(clientA)).not.toBeNull();
    expect(await logs("forget_tb_layout")).toEqual([]);
  });

  it("clears them for that client only, logs it, and the next upload asks again", async () => {
    await forget(e2024, reviewer);
    expect(await layoutOf(clientA)).toBeNull();
    expect(await layoutOf(clientB)).not.toBeNull();
    expect((await logs("forget_tb_layout")).map((l) => [l.entity_id, l.user_id])).toEqual([[clientA, reviewer.userId]]);
    const state = await upload(e2025, ODD_2025);
    expect(state.preview).toBeDefined();
    // Forgetting again does nothing and logs nothing.
    await forget(e2024, reviewer);
    expect(await logs("forget_tb_layout")).toHaveLength(1);
  });

  it("another firm cannot forget this firm's layout", async () => {
    await forget(eB, partnerY);
    expect(await layoutOf(clientB)).not.toBeNull();
  });
});

describe("what is stored", () => {
  it("is three nullable columns: nothing remembered reads as null", async () => {
    const { rows } = await db.query<{ tb_layout: unknown; tb_layout_updated_at: unknown }>("select tb_layout, tb_layout_updated_at from clients where id = $1", [clientY]);
    expect(rows[0]).toEqual({ tb_layout: null, tb_layout_updated_at: null });
  });
});
