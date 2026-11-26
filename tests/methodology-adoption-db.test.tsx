import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/server/db";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import * as review from "../src/server/review";
import * as fm from "../src/server/firm-methodology";
import { adoptMethodology, CURRENT_LIBRARY, getAdoption, loadAdoptions, methodologyNow, withdrawAdoption } from "../src/server/methodology-adoption";
import { LIBRARY_STATUS, LIBRARY_VERSION, AREA_BY_CODE } from "../src/domain/audit";
import { ADOPT_STATEMENT, adoptionLine, canonicalJson, changedWarning, NOT_CONFIRMED, NOTHING_CHANGED, stateFrom } from "../src/domain/methodology-adoption";
import { DRAFT_LABEL, DRAFT_LABEL_TITLE } from "../src/ui/methodology-view";
import { AdoptionSection } from "../src/ui/adoption-section";

let db: Db;
const A = "aaaaaaaa-6262-4000-8000-000000000001";
const B = "bbbbbbbb-6262-4000-8000-000000000001";
const user = (firm: string, n: number, role: repo.Session["role"]): repo.Session => ({ firmId: firm, userId: `${firm.slice(0, 8)}-6262-4000-8000-00000000008${n}`, role });
const partner = user(A, 1, "partner");
const admin = user(A, 2, "admin");
const reviewer = user(A, 3, "reviewer");
const preparer = user(A, 4, "preparer");
const partnerB = user(B, 1, "partner");
type T = Parameters<Parameters<typeof withFirm>[2]>[0];
const as = <R,>(s: repo.Session, fn: (tx: T) => Promise<R>) => withFirm(db, s.firmId, fn);
const adopt = (s: repo.Session, note?: string, confirmed = true, source = CURRENT_LIBRARY) => as(s, (tx) => adoptMethodology(tx, s, { confirmed, note }, source));
const state = (s = partner, source = CURRENT_LIBRARY) => as(s, async (tx) => (await getAdoption(tx, source)).state);
const audits = async (action: string, firm = A) => (await db.query<{ detail: Record<string, unknown>; user_id: string }>("select detail, user_id from audit_log where firm_id = $1 and action = $2 order by id", [firm, action])).rows;

beforeAll(async () => {
  db = await openDatabase();
  for (const f of [A, B]) await db.query("insert into firms (id, name) values ($1, 'Firm')", [f]);
  for (const u of [partner, admin, reviewer, preparer, partnerB]) await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, u.firmId, `${u.userId}@x.test`, `${u.role} ${u.userId.slice(-1)}`, u.role]);
});

afterAll(async () => {
  await db.close();
});

describe("the library version and the table", () => {
  it("reads the version from the library's own version field", () => {
    expect(LIBRARY_VERSION).toBe("0.1");
    expect(JSON.parse(readFileSync(path.join(process.cwd(), "src/domain/methodology-library.json"), "utf8")).version).toBe("0.1");
  });
  it("is append-only for the application role, and another firm's rows are not seen", async () => {
    await adopt(partnerB);
    const app = (firm: string, sql: string) =>
      db.transaction(async (tx) => {
        await tx.exec("set local role app_user");
        await tx.query("select set_config('app.firm_id', $1, true)", [firm]);
        return tx.query(sql);
      });
    await expect(app(B, "update methodology_adoptions set note = 'x'")).rejects.toThrow(/permission denied/);
    await expect(app(B, "delete from methodology_adoptions")).rejects.toThrow(/permission denied/);
    expect((await app(A, "select 1 from methodology_adoptions")).rows).toHaveLength(0);
    // Another firm's adoption never shows as ours.
    expect((await state()).kind).toBe("none");
    expect(await as(partner, (tx) => loadAdoptions(tx))).toEqual([]);
  });
});

describe("adopting", () => {
  it("lets a partner adopt, storing the exact statement, and logs it", async () => {
    const id = await adopt(partner, "Reviewed at the partners' meeting.");
    const h = await as(partner, (tx) => loadAdoptions(tx));
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ id, kind: "adopted", version: "0.1", statement: ADOPT_STATEMENT, note: "Reviewed at the partners' meeting.", reason: null, changeCount: 0 });
    expect(h[0].fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect((await state()).kind).toBe("current");
    const log = await audits("methodology_adopt");
    expect(log[0]).toMatchObject({ user_id: partner.userId, detail: { adoptionId: id, libraryVersion: "0.1", fingerprint: h[0].fingerprint, firmChanges: 0, replaces: null } });
  });

  it("refuses a repeat when nothing has changed", async () => {
    await expect(adopt(partner)).rejects.toThrow(NOTHING_CHANGED);
    expect(await as(partner, (tx) => loadAdoptions(tx))).toHaveLength(1);
  });

  it("refuses a preparer and a reviewer, reading the role from the database; the administrator is partner-level, as NOT_PARTNER has it", async () => {
    for (const s of [preparer, reviewer]) await expect(adopt(s), s.role).rejects.toThrow(fm.NOT_PARTNER);
    await expect(adopt({ ...preparer, role: "partner" })).rejects.toThrow(fm.NOT_PARTNER);
    // The firm administrator counts as partner-level for the methodology (the rule is canLock), so the rule as it stands lets them.
    const adminFirm = "dddddddd-6262-4000-8000-000000000001";
    await db.query("insert into firms (id, name) values ($1, 'Admin Firm')", [adminFirm]);
    const adminOnly = user(adminFirm, 1, "admin");
    await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, 'a@x.test', 'Admin', 'admin')", [adminOnly.userId, adminFirm]);
    await expect(adopt(adminOnly)).resolves.toBeGreaterThan(0);
  });

  it("requires the confirmation to be ticked, on the server, and a note within the limit", async () => {
    const f = "eeeeeeee-6262-4000-8000-000000000001";
    await db.query("insert into firms (id, name) values ($1, 'E Firm')", [f]);
    const p = user(f, 1, "partner");
    await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, 'e@x.test', 'E Partner', 'partner')", [p.userId, f]);
    await expect(adopt(p, undefined, false)).rejects.toThrow(NOT_CONFIRMED);
    await expect(adopt(p, "x".repeat(1001))).rejects.toThrow(/note is too long/);
    expect(await as(p, (tx) => loadAdoptions(tx))).toEqual([]);
    await expect(adopt(p, "fine")).resolves.toBeGreaterThan(0);
  });
});

describe("changed since adoption", () => {
  const sample = () => {
    const proc = AREA_BY_CODE.get("C1")!.procedures[0];
    return { id: proc.id, text: proc.text, evidence: proc.evidence, reference: proc.reference };
  };

  it("moves to changed when the firm rewords a procedure, hides one or adds its own, and each change alters the fingerprint", async () => {
    const f = "ffffffff-6262-4000-8000-000000000001";
    await db.query("insert into firms (id, name) values ($1, 'F Firm')", [f]);
    const p = user(f, 1, "partner");
    await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, 'f@x.test', 'F Partner', 'partner')", [p.userId, f]);
    await adopt(p);
    const fingerprints = new Set([(await as(p, (tx) => methodologyNow(tx))).fingerprint]);
    const s = sample();

    await as(p, (tx) => fm.editProcedure(tx, p, s.id, { body: `${s.text} (our wording)`, evidence: s.evidence, reference: s.reference }));
    let st = await state(p);
    expect(st.kind).toBe("changed");
    if (st.kind === "changed") expect(st.what).toEqual(["the firm now has 1 change (it had 0 when adopted)"]);
    fingerprints.add((await as(p, (tx) => methodologyNow(tx))).fingerprint);

    await as(p, (tx) => fm.hideProcedure(tx, p, AREA_BY_CODE.get("C1")!.procedures[1].id));
    expect((await as(p, (tx) => methodologyNow(tx))).changeCount).toBe(2);
    fingerprints.add((await as(p, (tx) => methodologyNow(tx))).fingerprint);

    await as(p, (tx) => fm.addProcedure(tx, p, "C1", { tier: "core", assertions: [AREA_BY_CODE.get("C1")!.procedures[0].assertions[0]], body: "Our own procedure.", evidence: "Working paper", reference: "" }));
    fingerprints.add((await as(p, (tx) => methodologyNow(tx))).fingerprint);
    expect(fingerprints.size).toBe(4);

    st = await state(p);
    expect(st.kind).toBe("changed");
    if (st.kind === "changed") {
      expect(changedWarning(st.adoption, st.what)).toMatch(/^The methodology has changed since it was adopted on \d{4}-\d{2}-\d{2}: the firm now has 3 changes \(it had 0 when adopted\)\. Record adoption again to cover the current version\.$/);
      expect(adoptionLine(st)).toMatch(/^Adopted for this firm on \d{4}-\d{2}-\d{2} \(library v0\.1\); the methodology has changed since\.$/);
    }
    // Adopting again covers it, keeps the old adoption in the history and says which it replaces.
    const second = await adopt(p);
    expect((await state(p)).kind).toBe("current");
    expect(await as(p, (tx) => loadAdoptions(tx))).toHaveLength(2);
    expect((await audits("methodology_adopt", f)).at(-1)!.detail).toMatchObject({ adoptionId: second, firmChanges: 3, replaces: expect.any(Number) });
    // Going back to the library's wording changes the fingerprint again.
    await as(p, (tx) => fm.resetProcedure(tx, p, s.id));
    expect((await state(p)).kind).toBe("changed");
  });

  it("moves to changed when the library version changes, and when its content changes under the same version", async () => {
    const f = "99999999-6262-4000-8000-000000000001";
    await db.query("insert into firms (id, name) values ($1, 'G Firm')", [f]);
    const p = user(f, 1, "partner");
    await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, 'g@x.test', 'G Partner', 'partner')", [p.userId, f]);
    await adopt(p);
    const newer = { version: "0.2", library: CURRENT_LIBRARY.library };
    const st = await state(p, newer);
    expect(st.kind).toBe("changed");
    if (st.kind === "changed") expect(st.what).toEqual(["the library changed from version 0.1 to version 0.2"]);
    const edited = { version: "0.1", library: { ...(CURRENT_LIBRARY.library as object), extra: "a library edit" } };
    const st2 = await state(p, edited);
    expect(st2.kind).toBe("changed");
    if (st2.kind === "changed") expect(st2.what).toEqual(["the library or the firm's changes differ from what was adopted"]);
    // Adopting against the new version is allowed, and names the new version.
    const id = await adopt(p, undefined, true, newer);
    expect((await as(p, (tx) => loadAdoptions(tx)))[0]).toMatchObject({ id, version: "0.2" });
    expect((await state(p, newer)).kind).toBe("current");
  });

  it("gives the same fingerprint for the same content however it was built", () => {
    expect(canonicalJson({ b: 1, a: [{ d: 1, c: 2 }] })).toBe(canonicalJson({ a: [{ c: 2, d: 1 }], b: 1 }));
  });
});

describe("withdrawing", () => {
  it("needs a reason, makes the state not adopted, keeps the history, and cannot be repeated", async () => {
    const f = "88888888-6262-4000-8000-000000000001";
    await db.query("insert into firms (id, name) values ($1, 'H Firm')", [f]);
    const p = user(f, 1, "partner");
    const r = user(f, 2, "reviewer");
    for (const [u, role] of [[p, "partner"], [r, "reviewer"]] as const) await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, f, `${role}@h.test`, `H ${role}`, role]);
    await expect(as(p, (tx) => withdrawAdoption(tx, p, "Not adopted, nothing to withdraw."))).rejects.toThrow(/nothing to withdraw/);
    await adopt(p);
    await expect(as(r, (tx) => withdrawAdoption(tx, r, "A good reason here"))).rejects.toThrow(fm.NOT_PARTNER);
    await expect(as(p, (tx) => withdrawAdoption(tx, p, "  "))).rejects.toThrow("Give the reason for withdrawing the adoption; it is recorded.");
    await expect(as(p, (tx) => withdrawAdoption(tx, p, "x".repeat(1001)))).rejects.toThrow(/too long/);
    await as(p, (tx) => withdrawAdoption(tx, p, "Firm policy is under review."));
    const st = await state(p);
    expect(st.kind).toBe("none");
    const h = await as(p, (tx) => loadAdoptions(tx));
    expect(h.map((x) => x.kind)).toEqual(["withdrawn", "adopted"]);
    expect(h[0]).toMatchObject({ reason: "Firm policy is under review.", statement: null });
    expect((await audits("methodology_withdraw", f))[0].detail).toMatchObject({ reason: "Firm policy is under review.", withdrawsAdoption: h[1].id });
    await expect(as(p, (tx) => withdrawAdoption(tx, p, "Again with a reason."))).rejects.toThrow(/nothing to withdraw/);
    // Adopting again after a withdrawal is allowed even though nothing changed.
    await expect(adopt(p)).resolves.toBeGreaterThan(0);
  });
});

describe("the draft label", () => {
  it("keeps the draft label wording, as the fallback whenever the adoption is not current, and the line beside it", () => {
    expect(DRAFT_LABEL_TITLE).toBe("The library is an unreviewed AI draft.");
    expect(DRAFT_LABEL).toBe("The procedures below come from a library that was drafted with AI and has not been reviewed. Check them against the standards and your firm's own policy before you rely on them. Any change your firm makes here is your firm's own responsibility.");
    expect(LIBRARY_STATUS).toBe("AI draft v0.1: not reviewed, not approved for use on any engagement");
    const src = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
    const firmPage = src("src/app/(app)/firm/methodology/page.tsx");
    expect(firmPage).toContain("{DRAFT_LABEL} ({LIBRARY_STATUS})");
    expect(firmPage).toMatch(/\{adoptionLine\(adoption\.state\)\}/);
    const auditPage = src("src/app/(app)/engagements/[id]/audit/page.tsx");
    expect(auditPage).toContain("Methodology content: ${LIBRARY_STATUS}");
    expect(auditPage).toContain("until a qualified person has reviewed and approved that library.");
    expect(auditPage).toMatch(/\{adoptionLine\(adoption\)\}/);
    // The pages that show the status on every procedure do not carry the adoption line.
    expect(src("src/app/(app)/engagements/[id]/audit/[area]/page.tsx")).not.toContain("adoptionLine");
    expect(src("src/app/(app)/engagements/[id]/audit/[area]/page.tsx")).toContain("Methodology content: ${LIBRARY_STATUS}");
  });
  it("says only what the firm recorded, and never that anyone else reviewed it", () => {
    const rec = { id: 1, kind: "adopted" as const, version: "0.1", fingerprint: "a".repeat(64), changeCount: 0, statement: ADOPT_STATEMENT, note: null, reason: null, by: "Pia Partner", at: "2026-03-01" };
    const now = { version: "0.1", fingerprint: "a".repeat(64), changeCount: 0 };
    expect(adoptionLine(stateFrom([], now))).toBe("Not adopted for this firm.");
    expect(adoptionLine(stateFrom([rec], now))).toBe("Adopted for this firm on 2026-03-01 (library v0.1).");
    expect(adoptionLine(stateFrom([rec], { ...now, fingerprint: "b".repeat(64) }))).toContain("the methodology has changed since");
    expect(adoptionLine(stateFrom([{ ...rec, kind: "withdrawn", statement: null, reason: "Because" }, rec], now))).toBe("Not adopted for this firm.");
    for (const s of [stateFrom([], now), stateFrom([rec], now)]) expect(adoptionLine(s)).not.toMatch(/review(ed)? by|approved/i);
  });
  it("renders the section in each state, with the history, and the draft notice is not part of it", () => {
    const rec = { id: 2, kind: "adopted" as const, version: "0.1", fingerprint: "a".repeat(64), changeCount: 3, statement: ADOPT_STATEMENT, note: "Partners agreed.", reason: null, by: "Pia Partner", at: "2026-03-01" };
    const now = { version: "0.1", fingerprint: "a".repeat(64), changeCount: 3 };
    const none = renderToStaticMarkup(<AdoptionSection state={stateFrom([], now)} history={[]} changeCount={3} version="0.1" mayEdit />);
    expect(none).toContain("It is not adopted for this firm.");
    expect(none).toContain("Record adoption for this firm");
    expect(none).toContain(ADOPT_STATEMENT.replaceAll("'", "&#x27;"));
    expect(none).toContain("I confirm");
    expect(none).toContain("3 changes");
    const current = renderToStaticMarkup(<AdoptionSection state={stateFrom([rec], now)} history={[rec]} changeCount={3} version="0.1" mayEdit />);
    expect(current).toContain("Adopted for this firm by Pia Partner on 2026-03-01, library v0.1.");
    expect(current).toContain("Withdraw adoption");
    expect(current).toContain("Partners agreed.");
    const changed = renderToStaticMarkup(<AdoptionSection state={stateFrom([rec], { ...now, version: "0.2", fingerprint: "c".repeat(64) })} history={[rec]} changeCount={3} version="0.2" mayEdit />);
    expect(changed).toContain("Changed since it was adopted");
    expect(changed).toContain("the library changed from version 0.1 to version 0.2");
    expect(changed).toContain("Record adoption again");
    const readOnly = renderToStaticMarkup(<AdoptionSection state={stateFrom([], now)} history={[]} changeCount={3} version="0.1" mayEdit={false} />);
    expect(readOnly).toContain("A partner records adoption.");
    expect(readOnly).not.toContain("I confirm");
    for (const html of [none, current, changed, readOnly]) expect(html).not.toContain(DRAFT_LABEL_TITLE);
  });
});

describe("the lock", () => {
  const TB = [
    { code: "1000", name: "Bank - current account", closingMinor: 15000000, priorMinor: 5000000 },
    { code: "3000", name: "Share capital", closingMinor: -5000000, priorMinor: -5000000 },
    { code: "4000", name: "Sales", closingMinor: -10000000, priorMinor: 0 },
  ];
  async function lockable(firm: { p: repo.Session; prep: repo.Session; rev: repo.Session }, name: string): Promise<string> {
    const id = await as(firm.p, async (tx) => {
      const c = await repo.createClient(tx, firm.p, name);
      const e = await repo.createEngagement(tx, firm.p, c, "2025-01-01", "2025-12-31");
      await repo.importTrialBalance(tx, firm.p, e, "tb.xlsx", TB);
      await repo.approveAllMappings(tx, firm.p, e);
      return e;
    });
    const sheets = (await as(firm.p, (tx) => review.getOverview(tx, id)))!.leadSheets.map((l) => l.groupCode);
    for (const g of sheets) {
      await as(firm.prep, (tx) => review.signOff(tx, firm.prep, id, g, "preparer"));
      await as(firm.rev, (tx) => review.signOff(tx, firm.rev, id, g, "reviewer"));
    }
    return id;
  }
  it("records the adoption that was current, or none, and does not change locking", async () => {
    const f = "77777777-6262-4000-8000-000000000001";
    await db.query("insert into firms (id, name) values ($1, 'L Firm')", [f]);
    const p = user(f, 1, "partner");
    const prep = user(f, 2, "preparer");
    const rev = user(f, 3, "reviewer");
    for (const u of [p, prep, rev]) await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, f, `${u.role}@l.test`, `L ${u.role}`, u.role]);
    const lockOf = async (id: string) => (await db.query<{ detail: Record<string, unknown> }>("select detail from audit_log where entity_id = $1 and action = 'lock'", [id])).rows[0].detail;

    const one = await lockable({ p, prep, rev }, "Lock One LLC");
    await as(p, (tx) => review.lockEngagement(tx, p, one));
    expect(await lockOf(one)).toEqual({ methodologyAdoption: "none" });

    const adoptionId = await adopt(p);
    const two = await lockable({ p, prep, rev }, "Lock Two LLC");
    await as(p, (tx) => review.lockEngagement(tx, p, two));
    expect(await lockOf(two)).toEqual({ methodologyAdoption: { id: adoptionId, version: "0.1", changedSinceAdoption: false } });

    // A change after adoption does not stop the lock; it is recorded.
    const s = AREA_BY_CODE.get("C1")!.procedures[0];
    await as(p, (tx) => fm.editProcedure(tx, p, s.id, { body: `${s.text} (changed)`, evidence: s.evidence, reference: s.reference }));
    const three = await lockable({ p, prep, rev }, "Lock Three LLC");
    await as(p, (tx) => review.lockEngagement(tx, p, three));
    expect(await lockOf(three)).toEqual({ methodologyAdoption: { id: adoptionId, version: "0.1", changedSinceAdoption: true } });
  });
});
