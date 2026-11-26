import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PaperHistory, versionLabel } from "../src/ui/paper-history";

const history = [
  { id: "22222222-2222-4222-8222-222222222222", version: 2, fileName: "signed.pdf", sizeBytes: 2048, uploadedByName: "Test Reviewer", uploadedAt: "2026-11-25" },
  { id: "11111111-1111-4111-8111-111111111111", version: 1, fileName: "draft.pdf", sizeBytes: 1024, uploadedByName: "Test Preparer", uploadedAt: "2026-11-24" },
];

describe("a working paper's history", () => {
  it("lists every version, newest first, each with a download link and no remove button", () => {
    const html = renderToStaticMarkup(<PaperHistory engagementId="e1" history={history} />);
    expect(html).toContain("History, 2 versions");
    expect(html.indexOf("Version 2")).toBeLessThan(html.indexOf("Version 1"));
    expect(html).toContain('href="/engagements/e1/files/22222222-2222-4222-8222-222222222222"');
    expect(html).toContain('href="/engagements/e1/files/11111111-1111-4111-8111-111111111111"');
    expect(html.toLowerCase()).not.toContain("remove");
    expect(html).not.toContain("·");
  });
  it("shows nothing for a paper that has never been replaced, and labels only later versions", () => {
    expect(renderToStaticMarkup(<PaperHistory engagementId="e1" history={history.slice(1)} />)).toBe("");
    expect(versionLabel(1)).toBeNull();
    expect(versionLabel(3)).toBe("Version 3");
  });
});
