import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/server/db";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import * as audit from "../src/server/audit";
import { recordOpinion, type OpinionInput } from "../src/server/opinion";
import { generateReport } from "../src/server/report-download";
import { REPORT_NOTICE } from "../src/domain/report";

const FIRM = "aaaaaaaa-8888-4000-8000-000000000001";
const OTHER = "bbbbbbbb-8888-4000-8000-000000000001";
const user = (n: number, role: repo.Session["role"], firmId = FIRM): repo.Session => ({ firmId, userId: `${firmId.slice(0, 8)}-8888-4000-8000-00000000001${n}`, role });
const prep = user(1, "preparer");
const rev = user(2, "reviewer");
const partner = user(3, "partner");
const outsider = user(5, "partner", OTHER);
const TB = [
  { code: "1000", name: "Bank - current account", closingMinor: 15000000, priorMinor: 10000000 },
  { code: "3000", name: "Share capital", closingMinor: -5000000, priorMinor: -5000000 },
  { code: "4000", name: "Sales", closingMinor: -10000000, priorMinor: 0 },
];
const unmodified: OpinionInput = { opinion: "unmodified", basisForModification: "", goingConcern: false, goingConcernNote: "", emphasisOfMatter: "", otherMatter: "", reportDate: "2026-03-15" };

let db: Db;
let engagement: string;
let plain: string;
type T = Parameters<Parameters<typeof withFirm>[2]>[0];
const as = <R,>(s: repo.Session, fn: (tx: T) => Promise<R>) => withFirm(db, s.firmId, fn);
const blockers = async () => (await as(partner, (tx) => audit.getAuditOverview(tx, engagement)))!.blockers;
const DATE_BLOCKER = "Record the date of the auditor's report on the Auditor's report page.";
const downloads = async () => (await db.query<{ user_id: string; detail: { opinion: string } }>("select user_id, detail from audit_log where action = 'download_report' and entity_id = $1 order by id", [engagement])).rows;

beforeAll(async () => {
  db = await openDatabase();
  for (const f of [FIRM, OTHER]) await db.query("insert into firms (id, name) values ($1, $2)", [f, f === FIRM ? "Al Noor Auditing" : "Other Firm"]);
  for (const u of [prep, rev, partner, outsider]) await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, u.firmId, `${u.userId}@x.test`, `${u.role} user`, u.role]);
  await as(partner, async (tx) => {
    const client = await repo.createClient(tx, partner, "Report Co LLC");
    engagement = await repo.createEngagement(tx, partner, client, "2025-01-01", "2025-12-31");
    await repo.importTrialBalance(tx, partner, engagement, "tb.xlsx", TB);
    await repo.approveAllMappings(tx, partner, engagement);
    await audit.setAuditEnabled(tx, partner, engagement, true);
    const c2 = await repo.createClient(tx, partner, "No Audit Co");
    plain = await repo.createEngagement(tx, partner, c2, "2025-01-01", "2025-12-31");
  });
});

afterAll(async () => {
  await db.close();
});

describe("downloading the auditor's report", () => {
  it("is refused when no opinion is recorded, and writes no log entry", async () => {
    const r = await as(partner, (tx) => generateReport(tx, partner, engagement, {}));
    expect(r).toEqual({ kind: "refused", message: expect.stringContaining("No audit opinion is recorded yet") });
    expect(await downloads()).toHaveLength(0);
  });

  it("is not found for another firm and for an engagement with the audit off", async () => {
    await as(partner, (tx) => recordOpinion(tx, partner, engagement, unmodified));
    expect(await as(outsider, (tx) => generateReport(tx, outsider, engagement, {}))).toEqual({ kind: "not_found" });
    expect(await as(partner, (tx) => generateReport(tx, partner, plain, {}))).toEqual({ kind: "not_found" });
    expect(await downloads()).toHaveLength(0);
  });

  it("works for anyone in the firm once an opinion exists, defaults the partner to whoever recorded it, and logs the download", async () => {
    const r = await as(prep, (tx) => generateReport(tx, prep, engagement, { city: "Dubai" }));
    if (r.kind !== "ok") throw new Error("expected a report");
    expect(r.fileName).toBe("Auditors-report-Report-Co-LLC-2025-12-31-draft.docx");
    expect(r.blocks[0]).toEqual({ kind: "para", text: REPORT_NOTICE });
    expect(r.blocks.at(-1)).toEqual({ kind: "signature", lines: ["Al Noor Auditing", "partner user", "Dubai", "15 March 2026"] });
    await as(rev, (tx) => generateReport(tx, rev, engagement, { partner: "Bea Partner" }));
    const log = await downloads();
    expect(log.map((l) => l.user_id)).toEqual([prep.userId, rev.userId]);
    expect(log[0].detail).toEqual({ opinion: "unmodified", format: "docx" });
  });

  it("states a modified opinion with its basis and the going-concern section only when recorded", async () => {
    await as(partner, (tx) => recordOpinion(tx, partner, engagement, { ...unmodified, opinion: "qualified", basisForModification: "Stock was not counted.", goingConcern: true, goingConcernNote: "7" }));
    const r = await as(partner, (tx) => generateReport(tx, partner, engagement, {}));
    if (r.kind !== "ok") throw new Error("expected a report");
    const text = r.blocks.map((b) => (b.kind === "signature" ? b.lines.join(" ") : b.kind === "table" ? "" : b.text)).join("\n");
    expect(text).toContain("Qualified opinion");
    expect(text).toContain("Stock was not counted.");
    expect(text).toContain("Note 7 to the financial statements");
    await as(partner, (tx) => recordOpinion(tx, partner, engagement, { ...unmodified, opinion: "qualified", basisForModification: "Stock was not counted." }));
    const again = await as(partner, (tx) => generateReport(tx, partner, engagement, {}));
    if (again.kind !== "ok") throw new Error("expected a report");
    expect(JSON.stringify(again.blocks)).not.toContain("Material uncertainty related to going concern");
  });

  it("still works once the engagement is locked", async () => {
    await db.query("update engagements set status = 'locked' where id = $1", [engagement]);
    try {
      expect((await as(prep, (tx) => generateReport(tx, prep, engagement, {}))).kind).toBe("ok");
    } finally {
      await db.query("update engagements set status = 'open' where id = $1", [engagement]);
    }
  });
});

describe("the report date and the lock", () => {
  it("raises a blocker when the recorded opinion has no report date, and clears it when one is recorded", async () => {
    expect(await blockers()).not.toContain(DATE_BLOCKER);
    await db.query("update audit_opinions set report_date = null where engagement_id = $1", [engagement]);
    expect(await blockers()).toContain(DATE_BLOCKER);
    // Without a date the report is refused as well.
    expect((await as(partner, (tx) => generateReport(tx, partner, engagement, {}))).kind).toBe("refused");
    await as(partner, (tx) => recordOpinion(tx, partner, engagement, { ...unmodified, reportDate: "2026-03-20" }));
    expect(await blockers()).not.toContain(DATE_BLOCKER);
  });

  it("does not raise the date blocker when there is no opinion (the opinion blocker speaks instead)", async () => {
    await as(partner, async (tx) => {
      const { clearOpinion } = await import("../src/server/opinion");
      await clearOpinion(tx, partner, engagement);
    });
    const b = await blockers();
    expect(b).not.toContain(DATE_BLOCKER);
    expect(b).toContain("Audit: the partner has not recorded the audit opinion.");
  });
});
