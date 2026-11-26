import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/server/db";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import * as review from "../src/server/review";
import { LOCK_REASON_WORDS, checkLockReason } from "../src/domain/prior-year-checks";
import { adoptedLabel, stateFrom, type AdoptionRecord } from "../src/domain/methodology-adoption";
import { MethodologyLabel } from "../src/ui/methodology-label";
import { DRAFT_LABEL, DRAFT_LABEL_TITLE } from "../src/ui/methodology-view";
import { LIBRARY_STATUS } from "../src/domain/audit";
import { Callout } from "../src/ui/feedback";

// Invented firm and people.
const A = "aaaaaaaa-8585-4000-8000-000000000001";
const user = (n: number, role: repo.Session["role"]): repo.Session => ({ firmId: A, userId: `${A.slice(0, 8)}-8585-4000-8000-00000000008${n}`, role });
const prep = user(1, "preparer");
const rev = user(2, "reviewer");
const partner = user(3, "partner");

// Last year, as signed: bank 1,500,000, capital 500,000, sales 1,000,000.
const LAST_YEAR = [
  { code: "1000", name: "Bank - current account", closingMinor: 1500000, priorMinor: null },
  { code: "3000", name: "Share capital", closingMinor: -500000, priorMinor: null },
  { code: "4000", name: "Sales", closingMinor: -1000000, priorMinor: null },
];
/** This year, whose comparative column balances but is not last year's: bank 1,400,000 against the signed 1,500,000. */
const THIS_YEAR_DIFFERENT = [
  { code: "1000", name: "Bank - current account", closingMinor: 2000000, priorMinor: 1400000 },
  { code: "3000", name: "Share capital", closingMinor: -500000, priorMinor: -500000 },
  { code: "4000", name: "Sales", closingMinor: -1500000, priorMinor: -900000 },
];
const THIS_YEAR_SAME = THIS_YEAR_DIFFERENT.map((a, i) => ({ ...a, priorMinor: LAST_YEAR[i].closingMinor }));

let db: Db;
type T = Parameters<Parameters<typeof withFirm>[2]>[0];
const as = <R,>(s: repo.Session, fn: (tx: T) => Promise<R>) => withFirm(db, s.firmId, fn);
let n = 0;

/** This year's engagement, linked to a last year's file that is signed (locked), open, or absent, with every lead sheet signed and so ready to lock. */
async function ready(opts: { priorState: "locked" | "open"; thisYear: typeof THIS_YEAR_DIFFERENT }): Promise<string> {
  const client = await as(partner, (tx) => repo.createClient(tx, partner, `Lock Reason ${++n} LLC`));
  const prior = await as(partner, async (tx) => {
    const id = await repo.createEngagement(tx, partner, client, "2024-01-01", "2024-12-31");
    await repo.importTrialBalance(tx, partner, id, "ly.xlsx", LAST_YEAR);
    await repo.approveAllMappings(tx, partner, id);
    return id;
  });
  if (opts.priorState === "locked") await db.query("update engagements set status = 'locked', locked_by = $2, locked_at = now() where id = $1", [prior, partner.userId]);
  const id = await as(partner, async (tx) => {
    const e = await repo.createEngagement(tx, partner, client, "2025-01-01", "2025-12-31");
    await repo.importTrialBalance(tx, partner, e, "ty.xlsx", opts.thisYear);
    await repo.approveAllMappings(tx, partner, e);
    return e;
  });
  const sheets = (await as(prep, (tx) => review.getOverview(tx, id)))!.leadSheets;
  for (const s of sheets) {
    await as(prep, (tx) => review.signOff(tx, prep, id, s.groupCode, "preparer"));
    await as(rev, (tx) => review.signOff(tx, rev, id, s.groupCode, "reviewer"));
  }
  return id;
}
const lock = (id: string, reason?: string) => as(partner, (tx) => review.lockEngagement(tx, partner, id, reason));
const lockEntry = async (id: string) => (await db.query<{ detail: Record<string, unknown> }>("select detail from audit_log where action = 'lock' and entity_id = $1", [id])).rows[0].detail;

beforeAll(async () => {
  db = await openDatabase();
  await db.query("insert into firms (id, name) values ($1, 'Firm')", [A]);
  for (const u of [prep, rev, partner]) await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, A, `${u.userId}@x.test`, `${u.role} user`, u.role]);
});
afterAll(async () => {
  await db.close();
});

describe("Owner decision (2026-11-25): locking with a signed-comparatives difference needs a reason", () => {
  it("refuses without a reason, or with one that is too short or too long, and the file stays open", async () => {
    const id = await ready({ priorState: "locked", thisYear: THIS_YEAR_DIFFERENT });
    const needed = await as(partner, (tx) => review.lockExplanationNeeded(tx, A, id));
    expect(needed?.items.length).toBeGreaterThan(0);
    await expect(lock(id)).rejects.toThrow(LOCK_REASON_WORDS);
    await expect(lock(id, "  no ")).rejects.toThrow(LOCK_REASON_WORDS);
    await expect(lock(id, "x".repeat(501))).rejects.toThrow(/too long/);
    expect((await as(partner, (tx) => review.getOverview(tx, id)))!.status).toBe("open");
  });

  it("locks with a reason, and records it in the lock's audit entry with the differing lines", async () => {
    const id = await ready({ priorState: "locked", thisYear: THIS_YEAR_DIFFERENT });
    const needed = await as(partner, (tx) => review.lockExplanationNeeded(tx, A, id));
    await lock(id, "  Last year's bank balance was restated after the audit.  ");
    expect((await as(partner, (tx) => review.getOverview(tx, id)))!.status).toBe("locked");
    const entry = await lockEntry(id);
    expect(entry.comparativesDifference).toMatchObject({ reason: "Last year's bank balance was restated after the audit.", lines: needed!.items });
    expect((entry.comparativesDifference as { lines: string[] }).lines.length).toBeGreaterThan(0);
    expect(entry.methodologyAdoption).toBe("none");
  });

  it("needs no reason when last year is not signed, and records none", async () => {
    const id = await ready({ priorState: "open", thisYear: THIS_YEAR_DIFFERENT });
    expect(await as(partner, (tx) => review.lockExplanationNeeded(tx, A, id))).toBeNull();
    await lock(id);
    expect((await lockEntry(id)).comparativesDifference).toBeUndefined();
  });

  it("needs no reason when last year is signed and the comparatives agree, and ignores a reason given", async () => {
    const id = await ready({ priorState: "locked", thisYear: THIS_YEAR_SAME });
    expect(await as(partner, (tx) => review.lockExplanationNeeded(tx, A, id))).toBeNull();
    await lock(id, "A reason nobody asked for.");
    expect((await lockEntry(id)).comparativesDifference).toBeUndefined();
  });

  it("still lets only a partner lock, and the pure rule is 5 to 500 characters", async () => {
    const id = await ready({ priorState: "locked", thisYear: THIS_YEAR_DIFFERENT });
    await expect(as(rev, (tx) => review.lockEngagement(tx, rev, id, "A perfectly good reason."))).rejects.toThrow(/Only a partner/);
    expect(checkLockReason("12345")).toEqual({ ok: true, reason: "12345" });
    expect(checkLockReason("1234").ok).toBe(false);
    expect(checkLockReason("x".repeat(500)).ok).toBe(true);
    expect(checkLockReason("x".repeat(501)).ok).toBe(false);
  });
});

describe("Owner decision (2026-11-25): a current adoption replaces the draft label on methodology procedures only", () => {
  const now = { version: "0.1", fingerprint: "a".repeat(64), changeCount: 0 };
  const rec: AdoptionRecord = { id: 1, kind: "adopted", version: "0.1", fingerprint: "a".repeat(64), changeCount: 0, statement: "x", note: null, reason: null, by: "Pia Partner", at: "2026-03-01" };
  const withdrawn: AdoptionRecord = { ...rec, id: 2, kind: "withdrawn", statement: null, reason: "Because" };
  const draft = (
    <Callout variant="draft" title={DRAFT_LABEL_TITLE}>
      {DRAFT_LABEL} ({LIBRARY_STATUS})
    </Callout>
  );
  const render = (state: ReturnType<typeof stateFrom>) => renderToStaticMarkup(<MethodologyLabel state={state} draft={draft} />);

  it("shows the adopted line and no draft label while the adoption is current", () => {
    expect(adoptedLabel(stateFrom([rec], now))).toBe("Adopted by the firm on 2026-03-01 (library v0.1)");
    const html = render(stateFrom([rec], now));
    expect(html).toContain("Adopted by the firm on 2026-03-01 (library v0.1)");
    expect(html).not.toContain("unreviewed AI draft");
    expect(html).not.toContain(LIBRARY_STATUS);
    expect(html).not.toMatch(/reviewed by|approved by/i);
  });

  it("brings the draft label back, word for word, when the methodology changed since, the adoption is withdrawn, or there is none", () => {
    for (const state of [stateFrom([rec], { ...now, fingerprint: "b".repeat(64) }), stateFrom([rec], { ...now, version: "0.2" }), stateFrom([withdrawn, rec], now), stateFrom([], now)]) {
      expect(adoptedLabel(state)).toBeNull();
      expect(render(state)).toBe(renderToStaticMarkup(draft));
      expect(render(state)).toContain("The library is an unreviewed AI draft.");
    }
  });

  it("is used by exactly the four places that show the library status, and by nothing else", () => {
    const src = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
    for (const p of ["src/app/(app)/firm/methodology/page.tsx", "src/app/(app)/engagements/[id]/audit/page.tsx", "src/app/(app)/engagements/[id]/audit/[area]/page.tsx", "src/app/(app)/engagements/[id]/audit/journals/page.tsx"]) {
      expect(src(p), p).toContain("MethodologyLabel");
      expect(src(p), p).toContain("LIBRARY_STATUS");
    }
    // Every other draft label never reads the adoption: report, letters, notes and policies, the planning questionnaire and the planning assistant.
    for (const p of [
      "src/app/(app)/engagements/[id]/audit/report/page.tsx",
      "src/app/(app)/engagements/[id]/audit/letters/page.tsx",
      "src/app/(app)/engagements/[id]/audit/questionnaire/page.tsx",
      "src/app/(app)/engagements/[id]/statements/page.tsx",
      "src/app/(app)/firm/planning/page.tsx",
      "src/app/(app)/engagements/[id]/requests/page.tsx",
      "src/app/note-passage.tsx",
      "src/ui/planning-assistant.tsx",
    ]) {
      expect(src(p), p).not.toMatch(/MethodologyLabel|adoptedLabel|methodology-adoption/);
    }
  });
});
