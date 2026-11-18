import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/server/db";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import * as audit from "../src/server/audit";
import * as methodology from "../src/server/firm-methodology";
import { AREAS, AREA_BY_CODE, assertionsOf } from "../src/domain/audit";

const FIRM = "aaaaaaaa-3434-4000-8000-000000000001";
const OTHER = "bbbbbbbb-3434-4000-8000-000000000001";
const user = (n: number, role: repo.Session["role"], firmId = FIRM): repo.Session => ({ firmId, userId: `${firmId.slice(0, 8)}-3434-4000-8000-00000000001${n}`, role });
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
const libraryOf = (id: string) => AREAS.flatMap((a) => a.procedures).find((p) => p.id === id)!;
const loaded = async (engagement: string, area = "C5") => as(prep, (tx) => audit.listProcedures(tx, engagement, area));
const history = async (firm: string) => (await db.query<{ template_id: string; action: string; before_values: unknown; after_values: unknown; changed_by: string }>("select template_id, action, before_values, after_values, changed_by from firm_procedure_history where firm_id = $1 order by changed_at, id", [firm])).rows;
const logged = async (firm: string, action: string) => (await db.query<{ detail: { templateId: string; before: unknown; after: unknown }; user_id: string }>("select detail, user_id from audit_log where firm_id = $1 and action = $2 order by id", [firm, action])).rows;
const state = (id: string) => as(prep, (tx) => methodology.listFirmMethodology(tx)).then((areas) => areas.flatMap((a) => a.procedures).find((p) => p.id === id)!);

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

let inProgress: string;

beforeAll(async () => {
  db = await openDatabase();
  for (const firm of [FIRM, OTHER]) await db.query("insert into firms (id, name) values ($1, 'Firm')", [firm]);
  for (const u of [prep, rev, partner, admin, otherPartner]) {
    await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, u.firmId, `${u.userId}@x.test`, `${u.role} ${u.userId.slice(-1)}`, u.role]);
  }
  inProgress = await newEngagement(["2025-01-01", "2025-12-31"]);
  await as(rev, (tx) => audit.setAreaRisks(tx, rev, inProgress, "C5", rate("C5", "low")));
});

afterAll(async () => {
  await db.close();
});

describe("with no firm changes, the loaded programme is today's", () => {
  it("loads the library's own wording, none of it marked as the firm's", async () => {
    const rows = await loaded(inProgress);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const original = libraryOf(r.templateId);
      expect(r, r.templateId).toMatchObject({ body: original.text, evidence: original.evidence, reference: original.reference, tier: original.tier, firmWording: false });
    }
    expect((await as(prep, (tx) => methodology.getFirmAreas(tx)))).toBe(AREAS);
    expect(await history(FIRM)).toEqual([]);
  });

  it("lists every library procedure as the library's, with the library wording as the current wording", async () => {
    const areas = await as(prep, (tx) => methodology.listFirmMethodology(tx));
    expect(areas.map((a) => a.code)).toEqual(AREAS.map((a) => a.code));
    for (const p of areas.flatMap((a) => a.procedures)) expect(p).toMatchObject({ state: "library" });
    const sample = areas.flatMap((a) => a.procedures).find((p) => p.id === "C5.01")!;
    expect(sample.current).toEqual(sample.library);
    expect(sample.protected).toBe(false);
    expect(areas.find((a) => a.code === "C16")!.procedures.every((p) => p.protected)).toBe(true);
  });
});

describe("only partner-level users can change the methodology", () => {
  const edit = { body: "Invented firm wording.", evidence: libraryOf("C5.01").evidence, reference: libraryOf("C5.01").reference };

  it("refuses a reviewer and a preparer for every change, and stores nothing", async () => {
    for (const s of [rev, prep]) {
      await expect(as(s, (tx) => methodology.editProcedure(tx, s, "C5.01", edit)), s.role).rejects.toThrow(/Only a partner/);
      await expect(as(s, (tx) => methodology.hideProcedure(tx, s, "C5.02")), s.role).rejects.toThrow(/Only a partner/);
      await expect(as(s, (tx) => methodology.showProcedure(tx, s, "C5.02")), s.role).rejects.toThrow(/Only a partner/);
      await expect(as(s, (tx) => methodology.resetProcedure(tx, s, "C5.01")), s.role).rejects.toThrow(/Only a partner/);
    }
    expect((await db.query("select 1 from firm_procedures")).rows).toHaveLength(0);
    expect(await history(FIRM)).toEqual([]);
  });

  it("re-reads the role from the database, so a stale session that says partner is not enough", async () => {
    const stale = { ...prep, role: "partner" as const };
    await expect(as(stale, (tx) => methodology.editProcedure(tx, stale, "C5.01", edit))).rejects.toThrow(/Only a partner/);
    expect((await db.query("select 1 from firm_procedures")).rows).toHaveLength(0);
  });

  it("allows a partner and the firm administrator", async () => {
    await as(partner, (tx) => methodology.editProcedure(tx, partner, "C5.01", edit));
    expect((await state("C5.01")).state).toBe("edited");
    await as(admin, (tx) => methodology.resetProcedure(tx, admin, "C5.01"));
    expect((await state("C5.01")).state).toBe("library");
  });
});

describe("what is refused", () => {
  const base = { evidence: libraryOf("C5.01").evidence, reference: libraryOf("C5.01").reference };

  it("an id that is not in the library", async () => {
    await expect(as(partner, (tx) => methodology.editProcedure(tx, partner, "C5.99", { body: "Invented.", ...base }))).rejects.toThrow(/not in the library/);
    await expect(as(partner, (tx) => methodology.hideProcedure(tx, partner, "nonsense"))).rejects.toThrow(/not in the library/);
    await expect(as(partner, (tx) => methodology.showProcedure(tx, partner, "C99.01"))).rejects.toThrow(/not in the library/);
    await expect(as(partner, (tx) => methodology.resetProcedure(tx, partner, "C99.01"))).rejects.toThrow(/not in the library/);
  });

  it("blank wording, and wording over the limits", async () => {
    await expect(as(partner, (tx) => methodology.editProcedure(tx, partner, "C5.01", { body: "   ", ...base }))).rejects.toThrow(/cannot be blank/);
    await expect(as(partner, (tx) => methodology.editProcedure(tx, partner, "C5.01", { body: "x".repeat(2001), ...base }))).rejects.toThrow(/too long/);
    await expect(as(partner, (tx) => methodology.editProcedure(tx, partner, "C5.01", { body: "Invented.", evidence: "x".repeat(301), reference: base.reference }))).rejects.toThrow(/evidence is too long/);
    await expect(as(partner, (tx) => methodology.editProcedure(tx, partner, "C5.01", { body: "Invented.", evidence: base.evidence, reference: "x".repeat(301) }))).rejects.toThrow(/reference is too long/);
    expect((await db.query("select 1 from firm_procedures")).rows).toHaveLength(0);
  });

  it("showing a procedure that is not hidden, resetting one with the library wording, hiding one already hidden", async () => {
    await expect(as(partner, (tx) => methodology.showProcedure(tx, partner, "C5.01"))).rejects.toThrow(/not hidden/);
    await expect(as(partner, (tx) => methodology.resetProcedure(tx, partner, "C5.01"))).rejects.toThrow(/already has the library wording/);
    await as(partner, (tx) => methodology.hideProcedure(tx, partner, "C5.09"));
    await expect(as(partner, (tx) => methodology.hideProcedure(tx, partner, "C5.09"))).rejects.toThrow(/already hidden/);
    await as(partner, (tx) => methodology.showProcedure(tx, partner, "C5.09"));
    expect((await db.query("select 1 from firm_procedures")).rows).toHaveLength(0);
  });

  it("an edit that is the library's own wording stores nothing", async () => {
    await as(partner, (tx) => methodology.editProcedure(tx, partner, "C5.01", { body: libraryOf("C5.01").text, ...base }));
    expect((await db.query("select 1 from firm_procedures")).rows).toHaveLength(0);
  });
});

describe("management override is protected", () => {
  it("cannot be hidden, but its wording can be edited and reset", async () => {
    const id = AREA_BY_CODE.get("C16")!.procedures[0].id;
    await expect(as(partner, (tx) => methodology.hideProcedure(tx, partner, id))).rejects.toThrow(/reworded but not hidden/);
    expect((await state(id)).state).toBe("library");
    const original = libraryOf(id);
    await as(partner, (tx) => methodology.editProcedure(tx, partner, id, { body: "Invented override wording.", evidence: original.evidence, reference: original.reference }));
    expect(await state(id)).toMatchObject({ state: "edited", protected: true, current: { text: "Invented override wording." } });
    await as(partner, (tx) => methodology.resetProcedure(tx, partner, id));
    expect((await state(id)).state).toBe("library");
  });

  it("no other area's procedure is protected", async () => {
    const others = (await as(prep, (tx) => methodology.listFirmMethodology(tx))).filter((a) => a.code !== "C16").flatMap((a) => a.procedures);
    expect(others.some((p) => p.protected)).toBe(false);
  });
});

describe("an edit does not change a procedure already loaded, and a procedure loaded later carries the firm's wording", () => {
  it("leaves the loaded wording as it was, and marks new loads", async () => {
    const original = libraryOf("C5.01");
    const before = (await loaded(inProgress)).find((p) => p.templateId === "C5.01")!;
    await as(partner, (tx) => methodology.editProcedure(tx, partner, "C5.01", { body: "Invented firm wording for C5.01.", evidence: original.evidence, reference: original.reference }));

    // The engagement in progress keeps what it was loaded with, even after its programme is synced again.
    await as(rev, (tx) => audit.setAreaRisks(tx, rev, inProgress, "C5", rate("C5", "low")));
    const after = (await loaded(inProgress)).find((p) => p.templateId === "C5.01")!;
    expect(after).toMatchObject({ id: before.id, body: original.text, firmWording: false });

    // A new engagement loads the firm's wording and shows the mark; its other procedures are the library's.
    const fresh = await newEngagement(["2024-01-01", "2024-12-31"]);
    await as(rev, (tx) => audit.setAreaRisks(tx, rev, fresh, "C5", rate("C5", "low")));
    const rows = await loaded(fresh);
    expect(rows.find((p) => p.templateId === "C5.01")).toMatchObject({ body: "Invented firm wording for C5.01.", evidence: original.evidence, firmWording: true });
    expect(rows.filter((p) => p.templateId !== "C5.01").every((p) => !p.firmWording)).toBe(true);
  });

  it("a reset applies from the next load, and leaves the engagement that was loaded with the firm's wording as it was", async () => {
    const fresh = (await db.query<{ engagement_id: string }>("select engagement_id from audit_procedures where template_id = 'C5.01' and firm_wording")).rows[0].engagement_id;
    await as(partner, (tx) => methodology.resetProcedure(tx, partner, "C5.01"));
    expect((await loaded(fresh)).find((p) => p.templateId === "C5.01")).toMatchObject({ body: "Invented firm wording for C5.01.", firmWording: true });
  });
});

describe("hiding a procedure that is already on an engagement", () => {
  it("takes it out at the next sync when it is untouched, and keeps it when work has been recorded", async () => {
    const engagement = await newEngagement(["2023-01-01", "2023-12-31"]);
    await as(rev, (tx) => audit.setAreaRisks(tx, rev, engagement, "C5", rate("C5", "low")));
    const rows = await loaded(engagement);
    const untouched = rows.find((p) => p.templateId === "C5.02")!;
    const touched = rows.find((p) => p.templateId === "C5.03")!;
    await as(prep, (tx) => audit.updateProcedure(tx, prep, touched.id, { status: "done", workDone: "Agreed the listing to the ledger.", conclusion: "Agrees." }));

    await as(partner, (tx) => methodology.hideProcedure(tx, partner, "C5.02"));
    await as(partner, (tx) => methodology.hideProcedure(tx, partner, "C5.03"));

    // Hiding changes nothing on the engagement by itself.
    expect((await loaded(engagement)).map((p) => p.templateId)).toContain("C5.02");

    const change = await as(rev, (tx) => audit.setAreaRisks(tx, rev, engagement, "C5", rate("C5", "low")));
    expect(change).toEqual({ added: 0, removed: 1 });
    const after = await loaded(engagement);
    expect(after.some((p) => p.id === untouched.id)).toBe(false);
    expect(after.find((p) => p.id === touched.id)).toMatchObject({ status: "done", workDone: "Agreed the listing to the ledger." });

    // A programme loaded from now on leaves both out.
    const fresh = await newEngagement(["2022-01-01", "2022-12-31"]);
    await as(rev, (tx) => audit.setAreaRisks(tx, rev, fresh, "C5", rate("C5", "low")));
    const ids = (await loaded(fresh)).map((p) => p.templateId);
    expect(ids).not.toContain("C5.02");
    expect(ids).not.toContain("C5.03");

    // Showing them again brings them back at the next sync.
    await as(partner, (tx) => methodology.showProcedure(tx, partner, "C5.02"));
    await as(partner, (tx) => methodology.showProcedure(tx, partner, "C5.03"));
    const back = await as(rev, (tx) => audit.setAreaRisks(tx, rev, engagement, "C5", rate("C5", "low")));
    expect(back).toEqual({ added: 1, removed: 0 });
  });

  it("a hidden management-override procedure is still loaded", async () => {
    // The protection is also in the pure merge: even a stored hidden flag cannot take a core C16 procedure out.
    const id = AREA_BY_CODE.get("C16")!.procedures[0].id;
    await db.query("insert into firm_procedures (firm_id, template_id, hidden, updated_by) values ($1, $2, true, $3)", [FIRM, id, partner.userId]);
    try {
      const engagement = await newEngagement(["2021-01-01", "2021-12-31"]);
      await as(rev, (tx) => audit.setAreaRisks(tx, rev, engagement, "C16", {}));
      expect((await loaded(engagement, "C16")).map((p) => p.templateId)).toContain(id);
    } finally {
      await db.query("delete from firm_procedures where firm_id = $1 and template_id = $2", [FIRM, id]);
    }
  });
});

describe("another firm cannot read or change the methodology", () => {
  it("sees the library, cannot see this firm's changes, and its own changes do not reach this firm", async () => {
    await as(partner, (tx) => methodology.editProcedure(tx, partner, "C6.01", { body: "Invented wording for this firm.", evidence: libraryOf("C6.01").evidence, reference: libraryOf("C6.01").reference }));
    const seen = await as(otherPartner, (tx) => methodology.listFirmMethodology(tx));
    expect(seen.flatMap((a) => a.procedures).every((p) => p.state === "library")).toBe(true);
    expect(await as(otherPartner, (tx) => tx.query("select 1 from firm_procedures"))).toMatchObject({ rows: [] });
    expect(await as(otherPartner, (tx) => tx.query("select 1 from firm_procedure_history"))).toMatchObject({ rows: [] });

    // Row-level security: the other firm's statements reach no row of this firm.
    expect((await as(otherPartner, (tx) => tx.query("update firm_procedures set hidden = true returning 1"))).rows).toHaveLength(0);
    expect((await as(otherPartner, (tx) => tx.query("delete from firm_procedures returning 1"))).rows).toHaveLength(0);
    await expect(as(otherPartner, (tx) => tx.query("insert into firm_procedures (firm_id, template_id, hidden, updated_by) values ($1, 'C6.02', true, $2)", [FIRM, otherPartner.userId]))).rejects.toThrow();

    await as(otherPartner, (tx) => methodology.hideProcedure(tx, otherPartner, "C6.02"));
    expect((await state("C6.02")).state).toBe("library");
    expect((await state("C6.01")).state).toBe("edited");
    await as(otherPartner, (tx) => methodology.resetProcedure(tx, otherPartner, "C6.02"));
  });
});

describe("history and the audit log", () => {
  it("keeps every change, before and after, with who made it, and the application role cannot rewrite it", async () => {
    const rows = (await history(FIRM)).filter((r) => r.template_id === "C5.01");
    expect(rows.map((r) => r.action)).toEqual(["edit", "reset", "edit", "edit", "reset"]);
    const edit = rows[0];
    expect(edit.before_values).toBeNull();
    expect(edit.after_values).toMatchObject({ body: "Invented firm wording.", hidden: false });
    expect(edit.changed_by).toBe(partner.userId);
    const reset = rows[1];
    expect(reset.before_values).toMatchObject({ body: "Invented firm wording." });
    expect(reset.after_values).toBeNull();
    expect(rows.find((r) => r.changed_by === admin.userId)?.action).toBe("reset");

    await expect(as(partner, (tx) => tx.query("update firm_procedure_history set action = 'edit'"))).rejects.toThrow(/permission denied/);
    await expect(as(partner, (tx) => tx.query("delete from firm_procedure_history"))).rejects.toThrow(/permission denied/);
  });

  it("writes each change to the audit log", async () => {
    const edits = await logged(FIRM, "edit_procedure_wording");
    expect(edits[0]).toMatchObject({ user_id: partner.userId, detail: { templateId: "C5.01", before: null, after: { body: "Invented firm wording.", hidden: false } } });
    const hides = await logged(FIRM, "hide_procedure_wording");
    expect(hides.map((h) => h.detail.templateId)).toEqual(expect.arrayContaining(["C5.09", "C5.02", "C5.03"]));
    expect((await logged(FIRM, "show_procedure_wording")).length).toBeGreaterThan(0);
    expect((await logged(FIRM, "reset_procedure_wording")).length).toBeGreaterThan(0);
  });
});
