import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "../src/server/db";
import { openDatabase } from "../src/server/db";
import * as repo from "../src/server/repo";
import { isRealDate, nextPeriod, periodsOverlap } from "../src/domain/client-details";
import { CARRIES_NOTE, type RollRow } from "../src/domain/bulk-rollforward";
import { RollForwardForm } from "../src/app/rollforward-form";
import { EngagementsHeader } from "../src/ui/create-panels";

let db: Db;
let current: { firmId: string; userId: string; role: string; name: string; firmName: string; email: string } | null = null;
vi.mock("../src/server/session", () => ({ getSession: async () => current, getOptionalSession: async () => current }));
vi.mock("../src/server/db", async (original) => {
  const real = await original<typeof import("../src/server/db")>();
  return { ...real, getDb: async () => db };
});

describe("the next period", () => {
  it("is the day after to one year on less a day", () => {
    expect(nextPeriod("2025-12-31")).toEqual({ start: "2026-01-01", end: "2026-12-31" });
    expect(nextPeriod("2025-03-31")).toEqual({ start: "2025-04-01", end: "2026-03-31" });
    expect(nextPeriod("2025-06-30")).toEqual({ start: "2025-07-01", end: "2026-06-30" });
    expect(nextPeriod("2025-09-15")).toEqual({ start: "2025-09-16", end: "2026-09-15" });
  });
  it("keeps the last day of February on the last day across leap years", () => {
    expect(nextPeriod("2023-02-28")).toEqual({ start: "2023-03-01", end: "2024-02-29" });
    expect(nextPeriod("2024-02-29")).toEqual({ start: "2024-03-01", end: "2025-02-28" });
    expect(nextPeriod("2024-02-28")).toEqual({ start: "2024-02-29", end: "2025-02-28" });
  });
  it("gives a full year after a first period that was not twelve months", () => {
    expect(nextPeriod("2025-12-31")).toEqual({ start: "2026-01-01", end: "2026-12-31" });
  });
  it("refuses what is not a date", () => {
    expect(nextPeriod("2025-02-30")).toBeNull();
    expect(isRealDate("2026-02-31")).toBe(false);
    expect(isRealDate("2028-02-29")).toBe(true);
  });
  it("counts both ends in an overlap", () => {
    const a = { start: "2025-01-01", end: "2025-12-31" };
    expect(periodsOverlap(a, { start: "2025-12-31", end: "2026-12-30" })).toBe(true);
    expect(periodsOverlap(a, { start: "2026-01-01", end: "2026-12-31" })).toBe(false);
    expect(periodsOverlap(a, { start: "2024-01-01", end: "2025-01-01" })).toBe(true);
  });
});

const row = (over: Partial<RollRow> & { clientName: string }): RollRow => ({
  clientId: `00000000-0000-4000-8000-0000000000${over.clientName.length}`,
  engagementId: "e",
  periodStart: "2025-01-01",
  periodEnd: "2025-12-31",
  status: "Locked",
  auditEnabled: false,
  proposed: { start: "2026-01-01", end: "2026-12-31" },
  rolledForward: false,
  notEnded: false,
  ...over,
});

describe("the list", () => {
  const html = renderToStaticMarkup(
    <RollForwardForm rows={[row({ clientName: "Open Co", status: "Open", auditEnabled: true }), row({ clientName: "Locked Company", status: "Locked" }), row({ clientName: "Rolled Co LLC", rolledForward: true }), row({ clientName: "New This Year LLC", periodEnd: "2026-12-31", notEnded: true })]} />,
  );
  it("offers the proposal, says when last year's file is open, and disables a client already rolled forward", () => {
    expect(html).toContain("Select all that can be rolled forward");
    expect(html).toContain("0 clients selected of 2 that can be rolled forward");
    expect(html).toContain("Last year&#x27;s file is still open");
    expect(html).toContain("Already rolled forward");
    expect(html.match(/<input id="rf-[^>]*disabled/g)).toHaveLength(2);
    expect(html).toContain("This year&#x27;s file has not ended yet (period ends 2026-12-31)");
    expect(html).toContain('value="2026-01-01"');
    expect(html).toContain("The audit will be on");
    expect(html).toContain("All or none");
    expect(html).toContain("Create 0 engagements");
  });
  it("says exactly what is carried, once, in the words of the result screen", () => {
    expect(CARRIES_NOTE).toBe("Mappings carry forward when you import each trial balance. Bring forward client requests, confirmations and test schedules from each engagement.");
  });
});

describe("the home button", () => {
  it("shows Roll forward to next year only when given the link", () => {
    expect(renderToStaticMarkup(<EngagementsHeader subtitle="x" rollForwardHref="/engagements/roll-forward" />)).toContain('href="/engagements/roll-forward"');
    expect(renderToStaticMarkup(<EngagementsHeader subtitle="x" />)).not.toContain("Roll forward to next year");
  });
});

describe("the page and the action", () => {
  const A = "aaaaaaaa-9191-4000-8000-000000000001";
  const partner = { firmId: A, userId: "aaaaaaaa-9191-4000-8000-000000000061", role: "partner" as const };
  const prep = { firmId: A, userId: "aaaaaaaa-9191-4000-8000-000000000062", role: "preparer" as const };
  beforeAll(async () => {
    db = await openDatabase();
    await db.query("insert into firms (id, name) values ($1, 'Firm')", [A]);
    for (const u of [partner, prep]) await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, A, `${u.userId}@x.test`, u.role, u.role]);
    await db.transaction(async (tx) => {
      await tx.exec("set local role app_user");
      await tx.query("select set_config('app.firm_id', $1, true)", [A]);
      const c = await repo.createClient(tx, partner, "Page Test LLC");
      await repo.createEngagement(tx, partner, c, "2024-01-01", "2024-12-31");
    });
  });
  afterAll(async () => {
    await db.close();
  });
  it("is not found for a preparer and renders for a partner", async () => {
    const { default: Page } = await import("../src/app/(app)/engagements/roll-forward/page");
    current = { ...prep, name: "P", firmName: "F", email: "p@x" };
    await expect(Page()).rejects.toThrow();
    current = { ...partner, name: "P", firmName: "F", email: "p@x" };
    await expect(Page()).resolves.toBeDefined();
  });
  it("refuses a preparer's post, creating nothing", async () => {
    const { rollForwardAction } = await import("../src/app/rollforward-actions");
    const { MAX_ROLL_FORWARD } = await import("../src/domain/bulk-rollforward");
    current = { ...prep, name: "P", firmName: "F", email: "p@x" };
    const form = new FormData();
    form.append("clientId", "00000000-0000-4000-8000-000000000001");
    const r = await rollForwardAction({ ok: true, message: "" }, form);
    expect(r).toEqual({ ok: false, message: "Only a reviewer or partner can create an engagement." });
    expect(MAX_ROLL_FORWARD).toBe(200);
  });
});
