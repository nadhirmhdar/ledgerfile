import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CAP_MESSAGE, describeAction, guardCsv, NO_FILTERS, redact, summarise, toCsv } from "../src/domain/audit-log";
import { AuditLogView } from "../src/ui/audit-log-view";

const choices = { people: [{ id: "p", name: "Pia" }], engagements: [{ id: "e", label: "Al Noor, 2025-01-01 to 2025-12-31" }], actions: [{ action: "sign_off", label: "Signed a lead sheet" }] };
const entry = { id: 1, at: "2026-03-01 10:00:00", who: "Pia", what: "Signed a lead sheet", action: "sign_off", entity: "lead_sheet", engagementId: "11111111-1111-4111-8111-111111111111", engagement: "Al Noor, 2025-01-01 to 2025-12-31", summary: "Level: reviewer", json: '{\n  "level": "reviewer"\n}' };

describe("the words", () => {
  it("label an action by entity where the same code is used on several things, and fall back to the code in words", () => {
    expect(describeAction("create", "client")).toBe("Added a client");
    expect(describeAction("create", "engagement")).toBe("Created an engagement");
    expect(describeAction("export", "representation_letter")).toBe("Exported a letter");
    expect(describeAction("sign_off", "lead_sheet")).toBe("Signed a lead sheet");
    expect(describeAction("brand_new_thing", "x")).toBe("Brand new thing");
  });
  it("summarise a change as before and after, and leave secrets and the engagement id out", () => {
    expect(summarise({ engagementId: "x", changed: ["name"], before: { name: "A" }, after: { name: "B" } })).toBe("Name: A → B; Changed: [\"name\"]");
    expect(summarise({ password: "p", level: "reviewer" })).toBe("Level: reviewer");
    expect(summarise(null)).toBe("");
    expect(redact({ a: { token: "t" } })).toEqual({ a: { token: "[hidden]" } });
  });
});

describe("the CSV", () => {
  it("guards every formula starter, quotes cells and starts with a BOM", () => {
    for (const v of ["=1+1", "+1", "-1", "@x", "\tx", "\rx"]) expect(guardCsv(v)).toBe(`'${v}`);
    expect(guardCsv("safe")).toBe("safe");
    const csv = toCsv([["a", 'he said "hi"'], ["=x", "y"]]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toBe('﻿"a","he said ""hi"""\r\n"\'=x","y"\r\n');
  });
});

describe("the page body", () => {
  it("shows the empty state, and no export buttons with nothing to export", () => {
    const html = renderToStaticMarkup(<AuditLogView page={{ entries: [], older: null, newer: null }} filters={NO_FILTERS} problems={[]} choices={choices} total={0} />);
    expect(html).toContain("No entries match these filters.");
    expect(html).not.toContain("Download as");
  });
  it("shows the problems, the rows with a fold and a link, the export links with the filters, and Older and Newer", () => {
    const html = renderToStaticMarkup(
      <AuditLogView page={{ entries: [entry], older: "2026-03-01T10:00:00.000000Z|1", newer: "2026-03-01T10:00:00.000000Z|2" }} filters={{ ...NO_FILTERS, action: "sign_off" }} problems={["The start date must be a real date written YYYY-MM-DD, so it was ignored."]} choices={choices} total={1} />,
    );
    expect(html).toContain("Some filters were ignored");
    expect(html).toContain("<details");
    expect(html).toContain('href="/engagements/11111111-1111-4111-8111-111111111111"');
    expect(html).toContain("/firm/audit-log/export?action=sign_off&amp;format=csv");
    expect(html).toContain("older=2026-03-01T10%3A00%3A00.000000Z%7C1");
    expect(html).toContain("newer=");
    expect(html).toContain("Clear the filters");
  });
  it("says to narrow the dates instead of offering an export above the cap", () => {
    const html = renderToStaticMarkup(<AuditLogView page={{ entries: [entry], older: null, newer: null }} filters={NO_FILTERS} problems={[]} choices={choices} total={60000} />);
    expect(html).toContain(CAP_MESSAGE(60000));
    expect(html).not.toContain("Download as");
  });
});
