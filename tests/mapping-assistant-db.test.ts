import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/server/db";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import * as assistant from "../src/server/mapping-assistant";
import { assist, HIGH } from "../src/domain/mapping-assistant";
import { buildStatements } from "../src/domain/statements";
import { CLIENT_A, CLIENT_B, type Row } from "./mapping-assistant-fixture";

const X = "aaaaaaaa-3737-4000-8000-000000000001";
const Y = "bbbbbbbb-3737-4000-8000-000000000001";
const Z = "cccccccc-3737-4000-8000-000000000001";
const user = (n: number, role: repo.Session["role"], firmId: string): repo.Session => ({ firmId, userId: `${firmId.slice(0, 8)}-3737-4000-8000-00000000001${n}`, role });
const prep = user(1, "preparer", X);
const partnerX = user(2, "partner", X);
const partnerY = user(3, "partner", Y);
const partnerZ = user(4, "partner", Z);

let db: Db;
type T = Parameters<Parameters<typeof withFirm>[2]>[0];
const as = <R,>(s: repo.Session, fn: (tx: T) => Promise<R>) => withFirm(db, s.firmId, fn);

/** A client with one engagement and a trial balance. With `approve`, every account is mapped the way the fixture says, as a person's own choice. */
async function engagement(s: repo.Session, clientName: string, rows: Row[], approve: boolean, period: [string, string] = ["2025-01-01", "2025-12-31"]): Promise<string> {
  return as(s, async (tx) => {
    const client = await repo.createClient(tx, s, clientName);
    const id = await repo.createEngagement(tx, s, client, period[0], period[1]);
    await repo.importTrialBalance(tx, s, id, "tb.xlsx", rows.map(([code, name, closingMinor]) => ({ code, name, closingMinor, priorMinor: null })));
    if (approve) {
      const accounts = await repo.listAccounts(tx, id);
      for (const [code, , , group] of rows) await repo.setMapping(tx, s, accounts.find((a) => a.code === code)!.id, group);
    }
    return id;
  });
}
const mappings = async (id: string) => (await db.query<{ code: string; group_code: string; source: string; confidence: string; approved: boolean; reason: string | null; approved_by: string | null; approved_at: string | null }>("select a.code, m.group_code, m.source, m.confidence::text, m.approved, m.reason, m.approved_by, m.approved_at from mappings m join accounts a on a.id = m.account_id where a.engagement_id = $1 order by a.code", [id])).rows;
const logs = async (firm: string, action: string) => (await db.query<{ detail: Record<string, number>; user_id: string }>("select detail, user_id from audit_log where firm_id = $1 and action = $2 order by id", [firm, action])).rows;
const reviewedCheck = async (s: repo.Session, id: string) => buildStatements(await as(s, (tx) => repo.listAccounts(tx, id))).checks.find((c) => c.label === "Every mapping has been reviewed")!;

let engB: string;

beforeAll(async () => {
  db = await openDatabase();
  for (const firm of [X, Y, Z]) await db.query("insert into firms (id, name) values ($1, 'Firm')", [firm]);
  for (const u of [prep, partnerX, partnerY, partnerZ]) {
    await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, u.firmId, `${u.userId}@x.test`, `${u.role} ${u.userId.slice(-1)}`, u.role]);
  }
  await engagement(partnerX, "Client A", CLIENT_A, true, ["2024-01-01", "2024-12-31"]);
  engB = await engagement(partnerX, "Client B", CLIENT_B, false);
});

afterAll(async () => {
  await db.close();
});

describe("suggesting again", () => {
  it("places what the firm's approved mappings and the wording support, and says so for each", async () => {
    const accounts = await as(prep, (tx) => repo.listAccounts(tx, engB));
    const expected = assist({ accounts: accounts.map((a) => ({ code: a.code, name: a.name, closingMinor: a.closingMinor })), examples: CLIENT_A.map(([code, name, closingMinor, groupCode]) => ({ code, name, closingMinor, groupCode: groupCode! })) });
    const placed = expected.filter((p) => p.kind === "suggest");
    const result = await as(prep, (tx) => assistant.suggestAgain(tx, prep, engB));
    expect(result).toEqual({ placed: placed.length, high: placed.filter((p) => p.kind === "suggest" && p.band === "high").length, medium: placed.filter((p) => p.kind === "suggest" && p.band === "medium").length, low: placed.filter((p) => p.kind === "suggest" && p.band === "low").length, declined: expected.length - placed.length });
    expect(result.placed).toBeGreaterThan(40);

    const rows = (await mappings(engB)).filter((m) => m.source === "assistant");
    expect(rows).toHaveLength(result.placed);
    for (const m of rows) {
      expect(m.approved, m.code).toBe(false);
      expect(m.approved_by).toBeNull();
      expect(m.reason!.length).toBeGreaterThan(10);
      const p = expected.find((e) => e.accountCode === m.code)!;
      expect(p.kind === "suggest" && p.groupCode).toBe(m.group_code);
    }
  });

  it("does not change an account by itself: nothing is accepted and the check on statements still fails", async () => {
    const check = await reviewedCheck(prep, engB);
    expect(check.passed).toBe(false);
    expect(check.detail).toMatch(/suggested mapping\(s\) are not yet accepted/);
  });

  it("logs counts only", async () => {
    const [run] = await logs(X, "suggest");
    expect(Object.keys(run.detail).sort()).toEqual(["declined", "high", "low", "medium", "placed"]);
    expect(run.user_id).toBe(prep.userId);
  });

  it("lists the unmapped accounts it would not place, with a reason", async () => {
    const list = await as(prep, (tx) => assistant.couldNotPlace(tx, prep, engB));
    expect(list.map((u) => u.code)).toEqual(expect.arrayContaining(["900", "901"]));
    for (const u of list) expect(u.reason.length).toBeGreaterThan(10);
    expect(list.find((u) => u.code === "900")!.reason).toContain("No wording match");
  });

  it("running it again with nothing changed gives the same suggestions", async () => {
    const before = await mappings(engB);
    await as(prep, (tx) => assistant.suggestAgain(tx, prep, engB));
    expect(await mappings(engB)).toEqual(before);
  });
});

describe("accepting suggestions records the person and the time", () => {
  it("accept all high-confidence accepts only the high band, as that person", async () => {
    const before = await mappings(engB);
    const high = before.filter((m) => m.source === "assistant" && !m.approved && Number(m.confidence) >= HIGH);
    expect(high.length).toBeGreaterThan(0);
    expect(await as(prep, (tx) => assistant.acceptHighConfidence(tx, prep, engB))).toBe(high.length);
    const after = await mappings(engB);
    for (const m of after) {
      if (high.some((h) => h.code === m.code)) expect(m, m.code).toMatchObject({ approved: true, approved_by: prep.userId });
      else if (m.source === "assistant") expect(m.approved, m.code).toBe(false);
    }
    expect(after.filter((m) => m.approved_by === prep.userId).every((m) => m.approved_at !== null)).toBe(true);
    expect((await logs(X, "accept_high"))[0].detail).toEqual({ count: high.length });
  });

  it("accepting one suggestion records who and when, and refuses one that is already accepted", async () => {
    const next = (await mappings(engB)).find((m) => m.source === "assistant" && !m.approved)!;
    const accounts = await as(prep, (tx) => repo.listAccounts(tx, engB));
    const id = accounts.find((a) => a.code === next.code)!.id;
    await as(partnerX, (tx) => assistant.acceptMapping(tx, partnerX, id));
    expect((await mappings(engB)).find((m) => m.code === next.code)).toMatchObject({ approved: true, approved_by: partnerX.userId });
    await expect(as(partnerX, (tx) => assistant.acceptMapping(tx, partnerX, id))).rejects.toThrow(/no suggestion to accept/);
  });

  it("suggest again never changes an accepted mapping", async () => {
    const accepted = (await mappings(engB)).filter((m) => m.approved);
    await as(prep, (tx) => assistant.suggestAgain(tx, prep, engB));
    expect((await mappings(engB)).filter((m) => m.approved)).toEqual(accepted);
  });

  it("a person's own choice and accept-all record them too, and the check on statements is unchanged: it passes only when every account is mapped and accepted", async () => {
    const accounts = await as(prep, (tx) => repo.listAccounts(tx, engB));
    for (const a of accounts.filter((x) => x.groupCode === null)) await as(prep, (tx) => repo.setMapping(tx, prep, a.id, "ADMIN"));
    expect((await reviewedCheck(prep, engB)).passed).toBe(false);
    await as(prep, (tx) => repo.approveAllMappings(tx, prep, engB));
    expect((await reviewedCheck(prep, engB)).passed).toBe(true);
    const rows = await mappings(engB);
    expect(rows.every((m) => m.approved && m.approved_by !== null && m.approved_at !== null)).toBe(true);
    expect(rows.filter((m) => m.source === "manual").every((m) => m.approved_by === prep.userId)).toBe(true);
  });

  it("refuses to suggest or accept on a locked engagement", async () => {
    await db.query("update engagements set status = 'locked' where id = $1", [engB]);
    await expect(as(prep, (tx) => assistant.suggestAgain(tx, prep, engB))).rejects.toThrow(/locked/);
    await expect(as(prep, (tx) => assistant.acceptHighConfidence(tx, prep, engB))).rejects.toThrow(/locked/);
    expect(await as(prep, (tx) => assistant.couldNotPlace(tx, prep, engB))).toEqual([]);
    await db.query("update engagements set status = 'open' where id = $1", [engB]);
  });
});

describe("a firm's learning never crosses to another firm", () => {
  const deposits: Row[] = [["1900", "Sundry deposits", 4000, null]];
  const only = (id: string) => db.query<{ group_code: string; source: string }>("select m.group_code, m.source from mappings m join accounts a on a.id = m.account_id where a.engagement_id = $1 and m.source = 'assistant'", [id]).then((r) => r.rows);

  it("identical accounts get different suggestions from each firm's own approved choices, and none from a firm with no history", async () => {
    await engagement(partnerX, "Old client X", [["1900", "Sundry deposits", 4000, "TRADEREC"]], true, ["2023-01-01", "2023-12-31"]);
    await engagement(partnerY, "Old client Y", [["1900", "Sundry deposits", 4000, "CASH"]], true, ["2023-01-01", "2023-12-31"]);
    const nowX = await engagement(partnerX, "New client X", deposits, false);
    const nowY = await engagement(partnerY, "New client Y", deposits, false);
    const nowZ = await engagement(partnerZ, "New client Z", deposits, false);
    for (const [s, id] of [[partnerX, nowX], [partnerY, nowY], [partnerZ, nowZ]] as const) {
      await as(s, (tx) => assistant.suggestAgain(tx, s, id));
    }
    expect(await only(nowX)).toEqual([{ group_code: "TRADEREC", source: "assistant" }]);
    expect(await only(nowY)).toEqual([{ group_code: "CASH", source: "assistant" }]);
    expect(await only(nowZ)).toEqual([]);
    expect((await as(partnerZ, (tx) => assistant.couldNotPlace(tx, partnerZ, nowZ))).map((u) => u.code)).toEqual(["1900"]);
  });

  it("another firm's engagement is not visible to the assistant at all", async () => {
    await expect(as(partnerY, (tx) => assistant.suggestAgain(tx, partnerY, engB))).rejects.toThrow(/Engagement not found/);
    const mine = await as(partnerY, (tx) => tx.query("select 1 from mappings where firm_id = $1", [X]));
    expect(mine.rows).toHaveLength(0);
  });
});

describe("what is recorded", () => {
  it("keeps 'ai' and 'manual' as sources, adds 'assistant', and refuses any other", async () => {
    const id = await engagement(partnerZ, "Source client", [["1", "Petty cash", 1, "CASH"]], false);
    const accountId = (await db.query<{ id: string }>("select id from accounts where engagement_id = $1", [id])).rows[0].id;
    await db.query("update mappings set source = 'ai' where account_id = $1", [accountId]);
    await db.query("update mappings set source = 'assistant' where account_id = $1", [accountId]);
    await expect(db.query("update mappings set source = 'guess' where account_id = $1", [accountId])).rejects.toThrow();
    await expect(db.query("update mappings set reason = $2 where account_id = $1", [accountId, "x".repeat(501)])).rejects.toThrow();
  });

  it("keeps the reason and the approver when the trial balance is imported again", async () => {
    const id = await engagement(partnerZ, "Reimport client", [["2", "Petty cash", 1, null], ["3", "Share capital", -1, null]], false);
    await as(partnerZ, (tx) => assistant.suggestAgain(tx, partnerZ, id));
    await as(partnerZ, (tx) => assistant.acceptHighConfidence(tx, partnerZ, id));
    const before = await mappings(id);
    await as(partnerZ, (tx) => repo.importTrialBalance(tx, partnerZ, id, "tb2.xlsx", [{ code: "2", name: "Petty cash", closingMinor: 1, priorMinor: null }, { code: "3", name: "Share capital", closingMinor: -1, priorMinor: null }]));
    expect(await mappings(id)).toEqual(before);
    expect(before.find((m) => m.source === "assistant")!.reason).toBeTruthy();
  });
});
