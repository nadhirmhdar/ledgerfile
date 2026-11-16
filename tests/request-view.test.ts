import { describe, expect, it } from "vitest";
import { filterRequests, parseAreaFilter, parseSearch, parseStatus, requestMeta, requestResults, requestsSentence, rowControls, statusCounts, type RequestLike } from "../src/ui/request-view";

const r = (reference: string, description: string, status: RequestLike["status"], areaCode: string | null, overdue = false): RequestLike => ({ reference, description, status, overdue, areaCode });
const rows = [
  r("R-1", "Bank statements for March", "open", "C6", true),
  r("R-2", "Signed engagement letter", "received", null),
  r("R-3", "Debtors listing", "open", "C5"),
  r("R-4", "Fixed asset register", "not_applicable", "C1"),
  r("R-5", "Bank confirmation letter", "open", "C6"),
  r("R-6", "Board minutes", "received", null),
];
const refs = (x: { rows: RequestLike[] }) => x.rows.map((y) => y.reference);

describe("filters", () => {
  it("keeps the given order and shows everything by default", () => {
    expect(refs(filterRequests(rows))).toEqual(["R-1", "R-2", "R-3", "R-4", "R-5", "R-6"]);
  });
  it("filters by each status, and by overdue", () => {
    expect(refs(filterRequests(rows, { status: "open" }))).toEqual(["R-1", "R-3", "R-5"]);
    expect(refs(filterRequests(rows, { status: "received" }))).toEqual(["R-2", "R-6"]);
    expect(refs(filterRequests(rows, { status: "not_applicable" }))).toEqual(["R-4"]);
    expect(refs(filterRequests(rows, { status: "overdue" }))).toEqual(["R-1"]);
  });
  it("filters by area, with general meaning no area", () => {
    expect(refs(filterRequests(rows, { area: "C6" }))).toEqual(["R-1", "R-5"]);
    expect(refs(filterRequests(rows, { area: "general" }))).toEqual(["R-2", "R-6"]);
    expect(refs(filterRequests(rows, { area: "C99" }))).toEqual([]);
  });
  it("searches the reference or description, in any case", () => {
    expect(refs(filterRequests(rows, { q: "bank" }))).toEqual(["R-1", "R-5"]);
    expect(refs(filterRequests(rows, { q: "r-3" }))).toEqual(["R-3"]);
    expect(refs(filterRequests(rows, { q: "LETTER" }))).toEqual(["R-2", "R-5"]);
  });
  it("combines status, area and search", () => {
    expect(refs(filterRequests(rows, { status: "open", area: "C6", q: "confirmation" }))).toEqual(["R-5"]);
    expect(refs(filterRequests(rows, { status: "received", area: "C6" }))).toEqual([]);
    expect(refs(filterRequests(rows, { status: "overdue", q: "bank" }))).toEqual(["R-1"]);
  });
  it("reports shown of total, and returns nothing rather than failing", () => {
    expect(filterRequests(rows, { status: "open" })).toMatchObject({ shown: 3, total: 6 });
    expect(filterRequests(rows, { q: "zzz" })).toMatchObject({ rows: [], shown: 0, total: 6 });
    expect(filterRequests([], {})).toMatchObject({ rows: [], shown: 0, total: 0 });
    expect(requestResults(3, 6)).toBe("Showing 3 of 6 requests.");
    expect(requestResults(1, 1)).toBe("Showing 1 of 1 request.");
  });
});

describe("chip counts", () => {
  it("count every status for the chosen area and search", () => {
    expect(statusCounts(rows)).toEqual({ all: 6, open: 3, overdue: 1, received: 2, notApplicable: 1 });
    expect(statusCounts(rows, { area: "C6" })).toEqual({ all: 2, open: 2, overdue: 1, received: 0, notApplicable: 0 });
    expect(statusCounts(rows, { area: "general" })).toEqual({ all: 2, open: 0, overdue: 0, received: 2, notApplicable: 0 });
    expect(statusCounts(rows, { q: "bank" })).toMatchObject({ all: 2, open: 2 });
    expect(statusCounts([])).toEqual({ all: 0, open: 0, overdue: 0, received: 0, notApplicable: 0 });
  });
});

describe("reading the address", () => {
  it("accepts the known statuses and treats anything else as all", () => {
    expect(parseStatus("open")).toBe("open");
    expect(parseStatus("overdue")).toBe("overdue");
    expect(parseStatus("not_applicable")).toBe("not_applicable");
    expect(parseStatus("received")).toBe("received");
    expect(parseStatus("x")).toBe("");
    expect(parseStatus(undefined)).toBe("");
    expect(parseStatus(["open", "received"])).toBe("open");
  });
  it("keeps the area as given, including general, and trims the search", () => {
    expect(parseAreaFilter("general")).toBe("general");
    expect(parseAreaFilter("C6")).toBe("C6");
    expect(parseAreaFilter(undefined)).toBe("");
    expect(parseSearch("  bank ")).toBe("bank");
    expect(parseSearch("x".repeat(300))).toHaveLength(100);
  });
});

describe("wording", () => {
  it("says where the list stands", () => {
    expect(requestsSentence({ total: 50, open: 46, overdue: 3, received: 1, notApplicable: 3 })).toBe("46 open, 3 overdue, 1 received, 3 not applicable.");
    expect(requestsSentence({ total: 5, open: 5, overdue: 0, received: 0, notApplicable: 0 })).toBe("5 open.");
    expect(requestsSentence({ total: 0, open: 0, overdue: 0, received: 0, notApplicable: 0 })).toBe("No requests yet.");
  });
  it("describes a row in one muted line", () => {
    expect(requestMeta({ requestedByName: "Pat", requestedOn: "2026-01-02", dueOn: "2026-02-01", receivedOn: null, files: 0 })).toBe("Asked by Pat on 2026-01-02, due 2026-02-01");
    expect(requestMeta({ requestedByName: "Pat", requestedOn: "2026-01-02", dueOn: null, receivedOn: "2026-01-20", files: 2 })).toBe("Asked by Pat on 2026-01-02, no due date, received 2026-01-20, 2 files");
    expect(requestMeta({ requestedByName: "Pat", requestedOn: "2026-01-02", dueOn: null, receivedOn: null, files: 1 })).toContain("1 file");
  });
});

describe("a row's controls", () => {
  it("offers an open request the inline received form, not applicable, link, edit and delete", () => {
    expect(rowControls({ status: "open", files: 0, unlinkedAvailable: 3 }, false)).toEqual({ inlineReceived: true, notApplicable: true, reopen: false, link: true, unlink: false, edit: true, delete: true });
  });
  it("does not allow deleting an open request that has files, and offers unlinking them", () => {
    expect(rowControls({ status: "open", files: 2, unlinkedAvailable: 0 }, false)).toMatchObject({ delete: false, unlink: true, link: false });
  });
  it("offers a received or not applicable request a reopen, and no delete or inline form", () => {
    for (const status of ["received", "not_applicable"] as const) {
      expect(rowControls({ status, files: 0, unlinkedAvailable: 1 }, false)).toEqual({ inlineReceived: false, notApplicable: false, reopen: true, link: true, unlink: false, edit: true, delete: false });
    }
  });
  it("offers nothing on a locked engagement", () => {
    for (const status of ["open", "received", "not_applicable"] as const) {
      expect(rowControls({ status, files: 1, unlinkedAvailable: 1 }, true)).toEqual({ inlineReceived: false, notApplicable: false, reopen: false, link: false, unlink: false, edit: false, delete: false });
    }
  });
});
