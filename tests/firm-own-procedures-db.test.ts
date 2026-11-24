import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/server/db";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import * as audit from "../src/server/audit";
import * as methodology from "../src/server/firm-methodology";
import { AREAS, AREA_BY_CODE, assertionsOf } from "../src/domain/audit";

const FIRM = "aaaaaaaa-3535-4000-8000-000000000001";
const OTHER = "bbbbbbbb-3535-4000-8000-000000000001";
const user = (n: number, role: repo.Session["role"], firmId = FIRM): repo.Session => ({ firmId, userId: `${firmId.slice(0, 8)}-3535-4000-8000-00000000001${n}`, role });
const prep = user(1, "preparer");
const rev = user(2, "reviewer");
const partner = user(3, "partner");
const admin = user(4, "admin");
const otherPartner = user(5, "partner", OTHER);

const TB = [
  { code: "1000", name: "Bank - current account", closingMinor: 30000000, priorMinor: null },
  { code: "1100", name: "Trade receivables", closingMinor: 20000000, priorMinor: null },
  { code: "3000", name: "Share capital", closingMinor: -10000000, priorMinor: null },
  { code: "4000", name: "Sales", closingMinor: -100000000, priorMinor: null },
  { code: "6100", name: "Office rent", closingMinor: 60000000, priorMinor: null },
];

let db: Db;
type T = Parameters<Parameters<typeof withFirm>[2]>[0];
const as = <R,>(s: repo.Session, fn: (tx: T) => Promise<R>) => withFirm(db, s.firmId, fn);
const rate = (code: string, level: string) => Object.fromEntries(assertionsOf(AREA_BY_CODE.get(code)!).map((a) => [a, level]));
const loaded = (engagement: string, area = "C5") => as(prep, (tx) => audit.listProcedures(tx, engagement, area));
const rowsOf = async (sql: string, firm = FIRM) => (await db.query<Record<string, unknown>>(sql.replace("$FIRM", `'${firm}'`))).rows;
const ownCount = async () => (await rowsOf("select 1 from firm_own_procedures where firm_id = $FIRM")).length;
const history = () => rowsOf("select template_id, action, before_values, after_values, changed_by from firm_own_procedure_history where firm_id = $FIRM order by changed_at, id");
const logged = (action: string) => rowsOf(`select detail, user_id from audit_log where firm_id = $FIRM and action = '${action}' order by id`);
const viewOf = async (area: string, s = prep) => (await as(s, (tx) => methodology.listFirmMethodology(tx))).find((a) => a.code === area)!;

const input = (over: Partial<Record<"tier" | "body" | "evidence" | "reference", string>> & { assertions?: string[] } = {}) => ({ tier: "core", assertions: ["E"], body: "Invented own procedure.", evidence: "Invented evidence.", reference: "Invented reference.", ...over });

async function newEngagement(period: [string, string]): Promise<string> {
  const id = await as(partner, async (tx) => {
    const client = await repo.createClient(tx, partner, `Audit Co ${period[0]}`);
    const created = await repo.createEngagement(tx, partner, client, period[0], period[1]);
    await repo.importTrialBalance(tx, partner, created, "tb.xlsx", TB);
    await repo.approveAllMappings(tx, partner, created);
    return created;
  });
  await as(rev, (tx) => audit.setAuditEnabled(tx, rev, id, true));
  return id;
}

beforeAll(async () => {
  db = await openDatabase();
  for (const firm of [FIRM, OTHER]) await db.query("insert into firms (id, name) values ($1, 'Firm')", [firm]);
  for (const u of [prep, rev, partner, admin, otherPartner]) {
    await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, u.firmId, `${u.userId}@x.test`, `${u.role} ${u.userId.slice(-1)}`, u.role]);
  }
});

afterAll(async () => {
  await db.close();
});

describe("with no own procedures, the programme is as before", () => {
  it("loads exactly the library, none of it marked as the firm's, and the firm's areas are the library", async () => {
    const engagement = await newEngagement(["2025-01-01", "2025-12-31"]);
    await as(rev, (tx) => audit.setAreaRisks(tx, rev, engagement, "C5", rate("C5", "low")));
    const rows = await loaded(engagement);
    expect(rows.map((p) => p.templateId)).toEqual(AREA_BY_CODE.get("C5")!.procedures.filter((p) => p.tier === "core").map((p) => p.id).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));
    expect(rows.every((p) => !p.firmAdded && !p.firmWording)).toBe(true);
    expect(await as(prep, (tx) => methodology.getFirmAreas(tx))).toBe(AREAS);
    expect(await ownCount()).toBe(0);
    expect(await history()).toEqual([]);
    const view = await viewOf("C5");
    expect(view).toMatchObject({ own: [], canAdd: true, assertionChoices: assertionsOf(AREA_BY_CODE.get("C5")!) });
  });
});

describe("only partner-level users can add, change or retire", () => {
  it("refuses a reviewer and a preparer for every change, and stores nothing", async () => {
    for (const s of [rev, prep]) {
      await expect(as(s, (tx) => methodology.addProcedure(tx, s, "C5", input())), s.role).rejects.toThrow(/Only a partner/);
      await expect(as(s, (tx) => methodology.editOwnProcedure(tx, s, "C5.F01", input())), s.role).rejects.toThrow(/Only a partner/);
      await expect(as(s, (tx) => methodology.retireOwnProcedure(tx, s, "C5.F01")), s.role).rejects.toThrow(/Only a partner/);
      await expect(as(s, (tx) => methodology.restoreOwnProcedure(tx, s, "C5.F01")), s.role).rejects.toThrow(/Only a partner/);
    }
    expect(await ownCount()).toBe(0);
    expect(await history()).toEqual([]);
  });

  it("re-reads the role from the database, so a stale session that says partner is not enough", async () => {
    const stale = { ...prep, role: "partner" as const };
    await expect(as(stale, (tx) => methodology.addProcedure(tx, stale, "C5", input()))).rejects.toThrow(/Only a partner/);
    expect(await ownCount()).toBe(0);
  });

  it("allows a partner and the firm administrator", async () => {
    expect(await as(admin, (tx) => methodology.addProcedure(tx, admin, "C13", input()))).toBe("C13.F01");
    await as(partner, (tx) => methodology.retireOwnProcedure(tx, partner, "C13.F01"));
    expect((await viewOf("C13")).own[0]).toMatchObject({ id: "C13.F01", retired: true });
  });
});

describe("what is refused", () => {
  it("an unknown area, a library id, and ids that were never added", async () => {
    await expect(as(partner, (tx) => methodology.addProcedure(tx, partner, "C99", input()))).rejects.toThrow(/Unknown audit area/);
    await expect(as(partner, (tx) => methodology.addProcedure(tx, partner, "A1", input()))).rejects.toThrow(/Unknown audit area/);
    for (const id of ["C5.01", "C5.F31", "C5.F00", "nonsense", "C99.F01"]) {
      await expect(as(partner, (tx) => methodology.editOwnProcedure(tx, partner, id, input())), id).rejects.toThrow(/not added by your firm/);
      await expect(as(partner, (tx) => methodology.retireOwnProcedure(tx, partner, id)), id).rejects.toThrow(/not added by your firm/);
    }
    await expect(as(partner, (tx) => methodology.retireOwnProcedure(tx, partner, "C5.F05"))).rejects.toThrow(/not added by your firm/);
  });

  it("assertions the library's area does not cover, no assertions, blank wording, over-long wording, and Partner sign-off evidence", async () => {
    const c15 = assertionsOf(AREA_BY_CODE.get("C15")!);
    expect(c15).not.toContain("E");
    await expect(as(partner, (tx) => methodology.addProcedure(tx, partner, "C15", input({ assertions: ["E"] })))).rejects.toThrow(/only assertions this area already covers/i);
    await expect(as(partner, (tx) => methodology.addProcedure(tx, partner, "C5", input({ assertions: [] })))).rejects.toThrow(/at least one assertion/);
    await expect(as(partner, (tx) => methodology.addProcedure(tx, partner, "C5", input({ body: "  " })))).rejects.toThrow(/cannot be blank/);
    await expect(as(partner, (tx) => methodology.addProcedure(tx, partner, "C5", input({ body: "x".repeat(2001) })))).rejects.toThrow(/too long/);
    await expect(as(partner, (tx) => methodology.addProcedure(tx, partner, "C5", input({ evidence: "x".repeat(301) })))).rejects.toThrow(/evidence is too long/);
    await expect(as(partner, (tx) => methodology.addProcedure(tx, partner, "C5", input({ reference: "x".repeat(301) })))).rejects.toThrow(/reference is too long/);
    await expect(as(partner, (tx) => methodology.addProcedure(tx, partner, "C5", input({ evidence: "Partner sign-off on the file." })))).rejects.toThrow(/Partner sign-off/);
    await expect(as(partner, (tx) => methodology.addProcedure(tx, partner, "C5", input({ tier: "optional" })))).rejects.toThrow(/core, extended or/);
    expect((await rowsOf("select 1 from firm_own_procedures where area_code in ('C5', 'C15') and firm_id = $FIRM")).length).toBe(0);
  });

  it("the database itself refuses evidence that starts Partner sign-off, and an assertion list that is empty", async () => {
    const insert = (evidence: string, assertions: string[]) =>
      as(partner, (tx) => tx.query("insert into firm_own_procedures (firm_id, area_code, seq, tier, assertions, body, evidence, reference, created_by, updated_by) values ($1, 'C9', 1, 'core', $2, 'Invented.', $3, '', $4, $4)", [FIRM, assertions, evidence, partner.userId]));
    await expect(insert("partner SIGN-OFF recorded", ["E"])).rejects.toThrow();
    await expect(insert("Invented evidence.", [])).rejects.toThrow();
  });

  it("an edit of a retired procedure, and retiring or restoring twice", async () => {
    await expect(as(partner, (tx) => methodology.editOwnProcedure(tx, partner, "C13.F01", input()))).rejects.toThrow(/retired/);
    await expect(as(partner, (tx) => methodology.retireOwnProcedure(tx, partner, "C13.F01"))).rejects.toThrow(/already retired/);
    await as(partner, (tx) => methodology.restoreOwnProcedure(tx, partner, "C13.F01"));
    await expect(as(partner, (tx) => methodology.restoreOwnProcedure(tx, partner, "C13.F01"))).rejects.toThrow(/not retired/);
  });

  it("a 31st procedure in an area, retired ones counting, and ids are never reused", async () => {
    for (let n = 1; n <= 30; n++) expect(await as(partner, (tx) => methodology.addProcedure(tx, partner, "C2", input({ body: `Invented procedure ${n}.` })))).toBe(`C2.F${String(n).padStart(2, "0")}`);
    await expect(as(partner, (tx) => methodology.addProcedure(tx, partner, "C2", input()))).rejects.toThrow(/at most 30/);
    await as(partner, (tx) => methodology.retireOwnProcedure(tx, partner, "C2.F30"));
    await expect(as(partner, (tx) => methodology.addProcedure(tx, partner, "C2", input()))).rejects.toThrow(/at most 30/);
    expect((await viewOf("C2")).canAdd).toBe(false);
    expect((await viewOf("C3")).canAdd).toBe(true);
  });
});

describe("two adds to the same area get the next numbers", () => {
  it("one after the other get F01 and F02, and two at the same moment do too", async () => {
    expect(await as(partner, (tx) => methodology.addProcedure(tx, partner, "C8", input({ body: "Invented first." })))).toBe("C8.F01");
    expect(await as(partner, (tx) => methodology.addProcedure(tx, partner, "C8", input({ body: "Invented second." })))).toBe("C8.F02");
    const both = await Promise.all([as(partner, (tx) => methodology.addProcedure(tx, partner, "C9", input({ body: "Invented one." }))), as(admin, (tx) => methodology.addProcedure(tx, admin, "C9", input({ body: "Invented two." })))]);
    expect([...both].sort()).toEqual(["C9.F01", "C9.F02"]);
  });
});

describe("an own procedure is loaded like any other, and marked as the firm's", () => {
  it("is loaded after the library's, with the firm mark on the row and not the rewording mark", async () => {
    const id = await as(partner, (tx) => methodology.addProcedure(tx, partner, "C5", input({ body: "Invented own procedure for receivables.", evidence: "Invented own evidence.", reference: "" })));
    expect(id).toBe("C5.F01");
    const engagement = await newEngagement(["2024-01-01", "2024-12-31"]);
    await as(rev, (tx) => audit.setAreaRisks(tx, rev, engagement, "C5", rate("C5", "low")));
    const rows = await loaded(engagement);
    expect(rows[rows.length - 1]).toMatchObject({ templateId: "C5.F01", tier: "core", assertions: "E", body: "Invented own procedure for receivables.", evidence: "Invented own evidence.", firmAdded: true, firmWording: false, partnerStep: false, status: "open" });
    expect(rows.slice(0, -1).every((p) => !p.firmAdded && !p.firmWording)).toBe(true);
  });

  it("is chosen by tier and risk: an extended one loads only when its assertion is rated above low", async () => {
    await as(partner, (tx) => methodology.addProcedure(tx, partner, "C6", input({ tier: "extended", assertions: ["A"], body: "Invented extended procedure." })));
    const low = await newEngagement(["2023-01-01", "2023-12-31"]);
    await as(rev, (tx) => audit.setAreaRisks(tx, rev, low, "C6", rate("C6", "low")));
    expect((await loaded(low, "C6")).map((p) => p.templateId)).not.toContain("C6.F01");
    const change = await as(rev, (tx) => audit.setAreaRisks(tx, rev, low, "C6", { ...rate("C6", "low"), A: "high" }));
    expect(change.added).toBeGreaterThan(0);
    expect((await loaded(low, "C6")).find((p) => p.templateId === "C6.F01")).toMatchObject({ firmAdded: true, tier: "extended", assertions: "A" });
  });

  it("is loaded in management override, where the risk is fixed, and can be retired", async () => {
    await as(partner, (tx) => methodology.addProcedure(tx, partner, "C16", input({ tier: "significant", assertions: ["C"], body: "Invented override check." })));
    const engagement = await newEngagement(["2022-01-01", "2022-12-31"]);
    await as(rev, (tx) => audit.setAreaRisks(tx, rev, engagement, "C16", {}));
    expect((await loaded(engagement, "C16")).find((p) => p.templateId === "C16.F01")).toMatchObject({ firmAdded: true });
  });

  it("an edit after loading leaves the loaded row unchanged, and a later load uses the edit", async () => {
    const before = await rowsOf("select engagement_id, id from audit_procedures where template_id = 'C5.F01' and firm_id = $FIRM");
    const loadedRow = (await loaded(before[0].engagement_id as string)).find((p) => p.templateId === "C5.F01")!;
    await as(partner, (tx) => methodology.editOwnProcedure(tx, partner, "C5.F01", input({ tier: "core", assertions: ["E", "V"], body: "Invented own procedure, reworded.", evidence: "Invented own evidence.", reference: "" })));
    await as(rev, (tx) => audit.setAreaRisks(tx, rev, before[0].engagement_id as string, "C5", rate("C5", "low")));
    const same = (await loaded(before[0].engagement_id as string)).find((p) => p.templateId === "C5.F01")!;
    expect(same).toMatchObject({ id: loadedRow.id, body: "Invented own procedure for receivables.", assertions: "E" });
    const fresh = await newEngagement(["2021-01-01", "2021-12-31"]);
    await as(rev, (tx) => audit.setAreaRisks(tx, rev, fresh, "C5", rate("C5", "low")));
    expect((await loaded(fresh)).find((p) => p.templateId === "C5.F01")).toMatchObject({ body: "Invented own procedure, reworded.", assertions: "E, V", firmAdded: true });
  });
});

describe("retiring a procedure that is already on an engagement", () => {
  it("takes it out at the next sync when untouched, keeps it when work has been recorded, and brings it back when restored", async () => {
    await as(partner, (tx) => methodology.addProcedure(tx, partner, "C7", input({ body: "Invented first own procedure." })));
    await as(partner, (tx) => methodology.addProcedure(tx, partner, "C7", input({ body: "Invented second own procedure." })));
    const engagement = await newEngagement(["2020-01-01", "2020-12-31"]);
    await as(rev, (tx) => audit.setAreaRisks(tx, rev, engagement, "C7", rate("C7", "low")));
    const rows = await loaded(engagement, "C7");
    const untouched = rows.find((p) => p.templateId === "C7.F01")!;
    const touched = rows.find((p) => p.templateId === "C7.F02")!;
    await as(prep, (tx) => audit.updateProcedure(tx, prep, touched.id, { status: "done", workDone: "Agreed the listing to the ledger.", conclusion: "Agrees." }));

    await as(partner, (tx) => methodology.retireOwnProcedure(tx, partner, "C7.F01"));
    await as(partner, (tx) => methodology.retireOwnProcedure(tx, partner, "C7.F02"));
    // Retiring changes nothing on the engagement by itself.
    expect((await loaded(engagement, "C7")).map((p) => p.templateId)).toEqual(expect.arrayContaining(["C7.F01", "C7.F02"]));

    const change = await as(rev, (tx) => audit.setAreaRisks(tx, rev, engagement, "C7", rate("C7", "low")));
    expect(change).toEqual({ added: 0, removed: 1 });
    const after = await loaded(engagement, "C7");
    expect(after.some((p) => p.id === untouched.id)).toBe(false);
    expect(after.find((p) => p.id === touched.id)).toMatchObject({ status: "done", firmAdded: true });

    const fresh = await newEngagement(["2019-01-01", "2019-12-31"]);
    await as(rev, (tx) => audit.setAreaRisks(tx, rev, fresh, "C7", rate("C7", "low")));
    expect((await loaded(fresh, "C7")).map((p) => p.templateId).filter((t) => t.includes(".F"))).toEqual([]);

    await as(partner, (tx) => methodology.restoreOwnProcedure(tx, partner, "C7.F01"));
    expect(await as(rev, (tx) => audit.setAreaRisks(tx, rev, engagement, "C7", rate("C7", "low")))).toEqual({ added: 1, removed: 0 });
  });
});

describe("an area that was assessed stays assessed", () => {
  it("does not become unassessed when an own procedure is added, and its assertions are unchanged", async () => {
    const engagement = await newEngagement(["2018-01-01", "2018-12-31"]);
    await as(rev, (tx) => audit.setAreaRisks(tx, rev, engagement, "C10", rate("C10", "low")));
    const status = async () => (await as(prep, (tx) => audit.getAuditOverview(tx, engagement)))!.areas.find((a) => a.code === "C10")!;
    expect(await status()).toMatchObject({ assessed: true });
    const allowed = assertionsOf(AREA_BY_CODE.get("C10")!);
    // An assertion the library's area does not cover is refused: it would add a rating the engagement never made.
    const outside = ["E", "R", "CO", "V", "A", "C", "P", "CL"].find((a) => !allowed.includes(a as never));
    if (outside) await expect(as(partner, (tx) => methodology.addProcedure(tx, partner, "C10", input({ assertions: [outside] })))).rejects.toThrow(/already covers/);
    await as(partner, (tx) => methodology.addProcedure(tx, partner, "C10", input({ tier: "extended", assertions: allowed as string[] })));
    expect(await status()).toMatchObject({ assessed: true });
    const firmArea = (await as(prep, (tx) => methodology.getFirmAreas(tx))).find((a) => a.code === "C10")!;
    expect(assertionsOf(firmArea)).toEqual(allowed);
  });
});

describe("another firm cannot see or change them", () => {
  it("sees none of this firm's procedures, and its own do not reach this firm", async () => {
    expect((await viewOf("C5", otherPartner)).own).toEqual([]);
    expect(await as(otherPartner, (tx) => tx.query("select 1 from firm_own_procedures"))).toMatchObject({ rows: [] });
    expect(await as(otherPartner, (tx) => tx.query("select 1 from firm_own_procedure_history"))).toMatchObject({ rows: [] });
    expect((await as(otherPartner, (tx) => tx.query("update firm_own_procedures set retired = true returning 1"))).rows).toHaveLength(0);
    await expect(as(otherPartner, (tx) => tx.query("insert into firm_own_procedures (firm_id, area_code, seq, tier, assertions, body, evidence, reference, created_by, updated_by) values ($1, 'C9', 1, 'core', '{E}', 'x', 'y', '', $2, $2)", [FIRM, otherPartner.userId]))).rejects.toThrow();

    await expect(as(otherPartner, (tx) => methodology.retireOwnProcedure(tx, otherPartner, "C5.F01"))).rejects.toThrow(/not added by your firm/);
    expect(await as(otherPartner, (tx) => methodology.addProcedure(tx, otherPartner, "C5", input({ body: "Invented other-firm procedure." })))).toBe("C5.F01");
    expect((await viewOf("C5")).own[0]).toMatchObject({ id: "C5.F01", body: "Invented own procedure, reworded." });
    expect((await viewOf("C5", otherPartner)).own[0]).toMatchObject({ id: "C5.F01", body: "Invented other-firm procedure." });
  });
});

describe("history and the audit log", () => {
  it("keeps every change, before and after, with who made it, and the application role cannot rewrite it", async () => {
    const rows = (await history()).filter((r) => r.template_id === "C5.F01");
    expect(rows.map((r) => r.action)).toEqual(["add", "edit"]);
    expect(rows[0].before_values).toBeNull();
    expect(rows[0].after_values).toMatchObject({ tier: "core", assertions: ["E"], body: "Invented own procedure for receivables.", retired: false });
    expect(rows[1].before_values).toMatchObject({ body: "Invented own procedure for receivables." });
    expect(rows[1].after_values).toMatchObject({ body: "Invented own procedure, reworded.", assertions: ["E", "V"] });
    expect(rows[0].changed_by).toBe(partner.userId);
    const c13 = (await history()).filter((r) => r.template_id === "C13.F01").map((r) => r.action);
    expect(c13).toEqual(["add", "retire", "retire", "restore"].filter((_, i) => i !== 2));
    expect((await history()).find((r) => r.template_id === "C13.F01")!.changed_by).toBe(admin.userId);

    await expect(as(partner, (tx) => tx.query("update firm_own_procedure_history set action = 'add'"))).rejects.toThrow(/permission denied/);
    await expect(as(partner, (tx) => tx.query("delete from firm_own_procedure_history"))).rejects.toThrow(/permission denied/);
    await expect(as(partner, (tx) => tx.query("delete from firm_own_procedures"))).rejects.toThrow(/permission denied/);
  });

  it("writes each change to the audit log", async () => {
    const added = await logged("add_own_procedure");
    expect(added[0]).toMatchObject({ user_id: admin.userId, detail: { templateId: "C13.F01", before: null, after: { retired: false } } });
    expect((await logged("edit_own_procedure")).length).toBeGreaterThan(0);
    expect((await logged("retire_own_procedure")).length).toBeGreaterThan(0);
    expect((await logged("restore_own_procedure")).length).toBeGreaterThan(0);
  });
});
