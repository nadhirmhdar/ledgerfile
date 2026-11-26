import { renderToStaticMarkup } from "react-dom/server";
import { prerender } from "react-dom/static";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "../src/server/db";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import type { PriorYearResult } from "../src/server/prior-year-checks";
import type { Check } from "../src/domain/statements";
import { PriorYearChecks } from "../src/ui/prior-year-view";
import { SignedPriorSection } from "../src/ui/signed-prior-section";
import StatementsPage from "../src/app/(app)/engagements/[id]/statements/page";

/** "Needs attention" is said once in a box whose title says it: by the title, never again by a badge beside the check. Invented data throughout. */

let db: Db;
let session: repo.Session;
vi.mock("../src/server/session", () => ({ getSession: async () => session, getOptionalSession: async () => session }));
vi.mock("../src/server/db", async (original) => {
  const real = await original<typeof import("../src/server/db")>();
  return { ...real, getDb: async () => db };
});
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() }));
vi.mock("next/navigation", async (original) => ({ ...(await original<typeof import("next/navigation")>()), usePathname: () => "/", useRouter: () => ({ refresh() {}, push() {}, replace() {} }) }));

const times = (html: string, words: string) => html.split(words).length - 1;
const warning = (label: string, passed: boolean): Check => ({ label, passed, severity: "warning", detail: passed ? undefined : "1 figure differs:", items: passed ? undefined : ["Revenue: difference 1.00"] });

describe("the checks against last year", () => {
  const result = (a: boolean, b: boolean): PriorYearResult => ({ linked: true, priorSigned: true, checks: [warning("Comparative figures agree to last year's signed figures", a), warning("Opening retained earnings equal last year's closing", b)] });
  const render = (r: PriorYearResult) => renderToStaticMarkup(<PriorYearChecks result={r} engagementId="e" />);

  it("says 'Needs attention' exactly once for one or two failing warnings, keeping each label, detail and item", () => {
    for (const r of [result(false, true), result(false, false)]) {
      const html = render(r);
      expect(times(html, "Needs attention")).toBe(1);
      expect(html).toContain("Comparative figures agree to last year");
      expect(html).toContain("1 figure differs:");
      expect(html).toContain("Revenue: difference 1.00");
    }
    expect(render(result(false, true))).toContain("Passed");
  });

  it("shows no warning when both pass", () => {
    const html = render(result(true, true));
    expect(times(html, "Needs attention")).toBe(0);
    expect(times(html, "Passed")).toBe(2);
  });
});

describe("the signed prior-year figures", () => {
  const rows = [{ key: "CASH", label: "Cash", comparative: "1.00", saved: "" }];
  const render = (check: Check) => renderToStaticMarkup(<SignedPriorSection engagementId="e" check={check} rows={rows} canEnter={false} />);

  it("says 'Needs attention' exactly once when failing, and not at all when passing", () => {
    const failing = render(warning("Comparative figures agree to the signed prior-year statements", false));
    expect(times(failing, "Needs attention")).toBe(1);
    expect(failing).toContain("1 figure differs:");
    expect(failing).toContain("Revenue: difference 1.00");
    const passing = render(warning("Comparative figures agree to the signed prior-year statements", true));
    expect(times(passing, "Needs attention")).toBe(0);
    expect(passing).toContain("Passed");
  });
});

describe("the statements page's own checks box", () => {
  const A = "aaaaaaaa-8989-4000-8000-000000000001";
  const partner: repo.Session = { firmId: A, userId: "aaaaaaaa-8989-4000-8000-000000000061", role: "partner" };
  const TB = [
    { code: "1000", name: "Bank - current account", closingMinor: 1500000, priorMinor: null },
    { code: "3000", name: "Share capital", closingMinor: -500000, priorMinor: null },
    { code: "4000", name: "Sales", closingMinor: -1000000, priorMinor: null },
  ];
  type T = Parameters<Parameters<typeof withFirm>[2]>[0];
  const as = <R,>(fn: (tx: T) => Promise<R>) => withFirm(db, A, fn);
  let n = 0;
  /** A first-year engagement with no comparatives, so the only warning box on the page is the statements' own. */
  const engagement = (approve: boolean) =>
    as(async (tx) => {
      const client = await repo.createClient(tx, partner, `Badge Trading ${++n} LLC`);
      const e = await repo.createEngagement(tx, partner, client, "2025-01-01", "2025-12-31");
      await repo.importTrialBalance(tx, partner, e, "tb.xlsx", TB);
      if (approve) await repo.approveAllMappings(tx, partner, e);
      return e;
    });
  // The page holds async server components, which only React's async renderer can finish.
  const page = async (id: string) => new Response((await prerender(await StatementsPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }))).prelude).text();

  beforeAll(async () => {
    db = await openDatabase();
    await db.query("insert into firms (id, name) values ($1, 'Firm')", [A]);
    await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, 'p@x.test', 'Pia Partner', 'partner')", [partner.userId, A]);
    session = partner;
  });
  afterAll(async () => {
    await db.close();
  });

  it("with only warnings failing, the box is titled 'Needs attention' and says it exactly once", async () => {
    const html = await page(await engagement(true));
    expect(times(html, "Needs attention")).toBe(1);
    expect(html).not.toContain("Checks to put right");
    expect(html).toContain("placeholder");
    expect(html).toContain("Passed");
  });

  it("with an error failing, the box keeps its title and every badge as before", async () => {
    const html = await page(await engagement(false));
    expect(html).toContain("Checks to put right");
    expect(html).toContain("Failed");
    // The warning rows keep their badge here: the box's title does not say it.
    expect(times(html, "Needs attention")).toBeGreaterThanOrEqual(1);
  });
});
