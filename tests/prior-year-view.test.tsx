import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { priorYearChecks } from "../src/domain/prior-year-checks";
import { buildStatements } from "../src/domain/statements";
import { buildHomeModel, type HomeInput } from "../src/ui/engagement-home";
import { PriorYearChecks, priorYearAttention } from "../src/ui/prior-year-view";

const acc = (groupCode: string, name: string, closingMinor: number, priorMinor: number) => ({ groupCode, name, closingMinor, priorMinor, approved: true });
// Last year: bank 1,000, capital 400, retained 100, sales 300, expenses 100 (result 200). This year's opening retained earnings should be 300.
const lastYear = [acc("CASH", "Bank", 100000, 0), acc("SHARECAP", "Share capital", -40000, 0), acc("RETAINED", "Retained earnings", -10000, 0), acc("REVENUE", "Sales", -30000, 0), acc("ADMIN", "Admin", 10000, 0)];
// This year's accounts with no comparative column at all (priorMinor null).
const same0 = () => [acc("CASH", "Bank", 150000, 0), acc("SHARECAP", "Share capital", -40000, 0), acc("RETAINED", "Retained earnings", -30000, 0), acc("REVENUE", "Sales", -50000, 0), acc("ADMIN", "Admin", 20000, 0)].map((a) => ({ ...a, priorMinor: null as unknown as number }));
const run = (thisYear: ReturnType<typeof acc>[], signed = false) =>
  priorYearChecks({
    current: buildStatements(thisYear),
    prior: buildStatements(lastYear),
    currentAccounts: thisYear.map((a) => ({ groupCode: a.groupCode, name: a.name, closingMinor: a.closingMinor })),
    priorSigned: signed,
  });

describe("the checks as pure functions", () => {
  const same = [acc("CASH", "Bank", 150000, 100000), acc("SHARECAP", "Share capital", -40000, -40000), acc("RETAINED", "Retained earnings", -30000, -10000), acc("REVENUE", "Sales", -50000, -30000), acc("ADMIN", "Admin", 20000, 10000)];
  it("pass when everything agrees, and are warnings", () => {
    const checks = run(same);
    expect(checks.map((c) => c.passed)).toEqual([true, true]);
    expect(checks.map((c) => c.severity)).toEqual(["warning", "warning"]);
  });
  it("name the line when a comparative differs, and the totals it changes", () => {
    const [a] = run(same.map((x) => (x.groupCode === "REVENUE" ? { ...x, priorMinor: -25000 } : x)));
    expect(a.passed).toBe(false);
    expect(a.items).toContain("Revenue: this year's comparative 250.00, last year 300.00, difference minus 50.00");
  });
  it("count the lines past five as 'and N more'", () => {
    const [a] = run(same.map((x) => ({ ...x, priorMinor: (x.priorMinor ?? 0) + 1 })));
    expect(a.items!.at(-1)).toMatch(/^and \d+ more$/);
    expect(a.items).toHaveLength(6);
  });
  it("treat a line missing from one side as zero", () => {
    const [a] = run([...same, acc("TRADEREC", "Receivables", 5000, 7000)]);
    expect(a.items!.join("\n")).toContain("Trade and other receivables: this year's comparative 70.00, last year 0.00, difference 70.00");
  });
  it("add a dividend account back to the opening balance, so a dividend paid this year is no difference", () => {
    const withDividend = [...same.filter((x) => x.groupCode !== "CASH"), acc("CASH", "Bank", 130000, 100000), acc("RETAINED", "Dividends paid", 20000, 0)];
    expect(run(withDividend)[1].passed).toBe(true);
    const named = withDividend.map((x) => (x.name === "Dividends paid" ? { ...x, name: "Distribution to owners" } : x));
    expect(run(named)[1].passed).toBe(false);
  });
  it("say which basis last year's figures have", () => {
    expect(run(same, true)[0].label).toBe("Comparative figures agree to last year's signed figures");
    expect(run(same, false)[0].label).toContain("not yet locked");
  });
});

describe("a trial balance with no comparative column", () => {
  it("gets one sentence, still a warning, instead of every line", () => {
    const [a, b] = run(same0());
    expect(a.passed).toBe(false);
    expect(a.severity).toBe("warning");
    expect(a.detail).toBe("This year's trial balance has no comparative figures, so the statements show no comparatives. Last year's file has them: bring them in with the trial balance (the Prior Year column) when it is imported.");
    expect(a.items).toBeUndefined();
    expect(b.severity).toBe("warning");
  });
  it("links to the trial balance in the page block", () => {
    const [a] = run(same0());
    const html = renderToStaticMarkup(<PriorYearChecks engagementId="11111111-1111-4111-8111-111111111111" result={{ linked: true, priorSigned: false, checks: [a] }} />);
    expect(html).toContain("has no comparative figures");
    expect(html).toContain('href="/engagements/11111111-1111-4111-8111-111111111111/trial-balance"');
  });
});

describe("the page block", () => {
  it("says in one line when there is no link", () => {
    expect(renderToStaticMarkup(<PriorYearChecks engagementId="e" result={{ linked: false }} />)).toContain("Not linked to last year&#x27;s file, so the prior-year checks do not run.");
  });
  it("shows a warning with words, says it does not block locking, and shows passed checks as passed", () => {
    const bad = renderToStaticMarkup(<PriorYearChecks engagementId="e" result={{ linked: true, priorSigned: false, checks: [{ label: "A", passed: false, detail: "Because.", severity: "warning" }, { label: "B", passed: true, severity: "warning" }] }} />);
    expect(bad).toContain("Needs attention");
    expect(bad).toContain("Passed");
    expect(bad).toContain("they do not stop the file being locked");
    expect(bad).toContain("not yet locked");
    const good = renderToStaticMarkup(<PriorYearChecks engagementId="e" result={{ linked: true, priorSigned: true, checks: [{ label: "A", passed: true, severity: "warning" }] }} />);
    expect(good).toContain("last year&#x27;s signed figures");
    expect(good).not.toContain("Needs attention");
  });
});

describe("the overview", () => {
  const input = (attention: string[], status = "open"): HomeInput => ({
    engagementId: "11111111-1111-4111-8111-111111111111",
    role: "partner",
    status,
    lockedByName: null,
    lockedAt: null,
    accounts: { total: 5, unmapped: 0, toAccept: 0 },
    audit: { enabled: false, materialitySet: false, materialityStale: false, areas: [], approval: "none", approvalNotReady: null },
    review: { leadSheets: [], openPoints: 0, ready: true, blockers: [] },
    papers: { total: 0, reviewed: 0 },
    requests: { total: 0, open: 0, overdue: 0, received: 0, notApplicable: 0 },
    confirmations: { total: 0, notSent: 0, awaitingReply: 0, agreed: 0, differs: 0, noReply: 0, prepared: 0, reviewed: 0 },
    priorYearAttention: attention,
  });
  it("lists the warnings as needs attention and does not count them as things left before the lock", () => {
    const m = buildHomeModel(input(["Comparative figures agree to last year's figures (that file is not yet locked)"]));
    expect(m.attention).toHaveLength(1);
    expect(m.attention[0].href).toBe("/engagements/11111111-1111-4111-8111-111111111111/statements");
    expect(m.toDoTotal).toBe(0);
    expect(m.summary).toBe("Ready to lock.");
    expect(buildHomeModel(input([], "open")).attention).toEqual([]);
    expect(buildHomeModel(input(["x"], "locked")).attention).toEqual([]);
  });
  it("takes only the failed checks", () => {
    expect(priorYearAttention({ linked: true, priorSigned: true, checks: [{ label: "A", passed: false }, { label: "B", passed: true }] }).map((c) => c.label)).toEqual(["A"]);
    expect(priorYearAttention({ linked: false })).toEqual([]);
    expect(priorYearAttention(null)).toEqual([]);
  });
});
