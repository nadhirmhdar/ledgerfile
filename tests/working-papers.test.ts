import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDatabase, withFirm } from "../src/server/db";
import { localFileStore, type FileStore } from "../src/server/file-store";
import * as repo from "../src/server/repo";
import * as audit from "../src/server/audit";
import * as papers from "../src/server/working-papers";
import * as review from "../src/server/review";
import { AREA_BY_CODE, assertionsOf } from "../src/domain/audit";
import { sampleSize } from "../src/domain/sampling";

const FIRM = "aaaaaaaa-4444-4000-8000-000000000001";
const OTHER = "bbbbbbbb-4444-4000-8000-000000000001";
const user = (n: number, role: repo.Session["role"], firmId = FIRM): repo.Session => ({ firmId, userId: `${firmId.slice(0, 8)}-4444-4000-8000-00000000001${n}`, role });
const prep = user(1, "preparer");
const prep2 = user(2, "preparer");
const rev = user(3, "reviewer");
const partner = user(4, "partner");
const outsider = user(5, "partner", OTHER);
const bytes = (text: string) => new TextEncoder().encode(text);

let db: PGlite;
let root: string;
let store: FileStore;
let engagement: string;
type T = Parameters<Parameters<typeof withFirm>[2]>[0];
const as = <R,>(s: repo.Session, fn: (tx: T) => Promise<R>) => withFirm(db, s.firmId, fn);
const upload = (s: repo.Session, input: Partial<Parameters<typeof papers.addWorkingPaper>[4]>) =>
  as(s, (tx) => papers.addWorkingPaper(tx, s, store, engagement, { targetKind: "engagement", target: null, fileName: "bank-confirmation.pdf", data: bytes("%PDF sample"), description: "", ...input }));
const remove = async (u: repo.Session, id: string) => {
  const removed = await as(u, (tx) => papers.removeWorkingPaper(tx, u, id));
  await store.remove(removed.storageKey);
};
const storedFiles = () => readdirSync(root, { recursive: true }).filter((f) => /[0-9a-f-]{36}[\\/][0-9a-f-]{36}$/.test(String(f))).length;

beforeAll(async () => {
  db = await openDatabase();
  root = mkdtempSync(path.join(tmpdir(), "ledgerfile-papers-"));
  store = localFileStore(root);
  for (const firm of [FIRM, OTHER]) await db.query("insert into firms (id, name) values ($1, 'Firm')", [firm]);
  for (const u of [prep, prep2, rev, partner, outsider]) {
    await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, u.firmId, `${u.userId}@x.test`, `${u.role} ${u.userId.slice(-1)}`, u.role]);
  }
  await as(partner, async (tx) => {
    const client = await repo.createClient(tx, partner, "Papers Co");
    engagement = await repo.createEngagement(tx, partner, client, "2025-01-01", "2025-12-31");
    await repo.importTrialBalance(tx, partner, engagement, "tb.xlsx", [
      { code: "1000", name: "Bank - current account", closingMinor: 100000, priorMinor: null },
      { code: "3000", name: "Share capital", closingMinor: -100000, priorMinor: null },
    ]);
    await audit.setAuditEnabled(tx, partner, engagement, true);
  });
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("file names", () => {
  it("keeps only a plain file name", () => {
    expect(papers.cleanFileName("C:\\Users\\me\\Desktop\\Bank  confirmation.pdf")).toBe("Bank confirmation.pdf");
    expect(papers.cleanFileName("../../etc/passwd")).toBe("passwd");
    expect(papers.cleanFileName('bad<>:"|?*name.xlsx')).toBe("badname.xlsx");
    expect(papers.cleanFileName("...hidden.txt")).toBe("hidden.txt");
    const long = papers.cleanFileName("a".repeat(300) + ".pdf");
    expect(long.length).toBe(150);
    expect(long.endsWith(".pdf")).toBe(true);
  });
});

describe("the file store", () => {
  it("refuses keys that are not two identifiers, and never overwrites", async () => {
    await expect(store.put("../outside", bytes("x"))).rejects.toThrow(/Invalid storage key/);
    await expect(store.get("a/b/../../c")).rejects.toThrow(/Invalid storage key/);
    const key = `${FIRM}/${OTHER}`;
    await store.put(key, bytes("first"));
    await expect(store.put(key, bytes("second"))).rejects.toThrow();
    expect(new TextDecoder().decode((await store.get(key))!)).toBe("first");
    await store.remove(key);
    expect(await store.get(key)).toBeNull();
  });
});

describe("working papers", () => {
  let general: string;

  it("stores a file against the engagement, a lead sheet and a procedure", async () => {
    general = await upload(prep, { description: "Signed by the bank on 5 January" });
    await upload(prep, { targetKind: "lead_sheet", target: "CASH", fileName: "bank-rec.xlsx" });
    const [procedure] = await as(prep, (tx) => audit.listProcedures(tx, engagement, "A1"));
    await upload(rev, { targetKind: "procedure", target: procedure.id, fileName: "acceptance-form.docx" });

    const list = await as(prep, (tx) => papers.listWorkingPapers(tx, engagement));
    expect(list.map((w) => [w.fileName, w.targetLabel, w.uploadedByName])).toEqual([
      ["bank-confirmation.pdf", "General", "preparer 1"],
      ["bank-rec.xlsx", "Cash and bank balances", "preparer 1"],
      ["acceptance-form.docx", "Procedure A1.01", "reviewer 3"],
    ]);
    expect(list[0]).toMatchObject({ sizeBytes: 11, description: "Signed by the bank on 5 January" });
    expect(list[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(storedFiles()).toBe(3);
  });

  it("returns exactly what was uploaded, and refuses a file changed on disk", async () => {
    const read = await as(prep, (tx) => papers.readWorkingPaper(tx, store, engagement, general));
    expect(read?.fileName).toBe("bank-confirmation.pdf");
    expect(new TextDecoder().decode(read!.data)).toBe("%PDF sample");

    const tampered = await upload(prep, { fileName: "tamper.txt", data: bytes("original") });
    writeFileSync(path.join(root, FIRM, tampered), "changed");
    await expect(as(prep, (tx) => papers.readWorkingPaper(tx, store, engagement, tampered))).rejects.toThrow(/does not match its record/);
    await remove(prep, tampered);
  });

  it("refuses unsafe or unsuitable uploads and leaves nothing behind", async () => {
    const before = storedFiles();
    await expect(upload(prep, { fileName: "macro.exe" })).rejects.toThrow(/file type is not accepted/);
    await expect(upload(prep, { fileName: "page.html" })).rejects.toThrow(/file type is not accepted/);
    await expect(upload(prep, { fileName: "noextension" })).rejects.toThrow(/file type is not accepted/);
    await expect(upload(prep, { data: new Uint8Array(0) })).rejects.toThrow(/empty/);
    await expect(upload(prep, { data: new Uint8Array(papers.MAX_FILE_BYTES + 1) })).rejects.toThrow(/larger than 10 MB/);
    await expect(upload(prep, { targetKind: "lead_sheet", target: "NOPE" })).rejects.toThrow(/lead sheet/);
    await expect(upload(prep, { targetKind: "procedure", target: "00000000-0000-4000-8000-000000000000" })).rejects.toThrow(/not on this engagement/);
    await expect(upload(prep, { targetKind: "elsewhere" })).rejects.toThrow(/what the file supports/);
    expect(storedFiles()).toBe(before);
  });

  it("is removed by its uploader or a reviewer, not by another preparer", async () => {
    const mine = await upload(prep, { fileName: "draft.txt" });
    await expect(remove(prep2, mine)).rejects.toThrow(/Only the person who uploaded/);
    await remove(rev, mine);
    expect(await as(prep, (tx) => papers.readWorkingPaper(tx, store, engagement, mine))).toBeNull();
    expect(storedFiles()).toBe(3);
  });

  it("counts attached evidence as work: the procedure survives a re-rating and the audit cannot be turned off", async () => {
    const rate = (level: string) => Object.fromEntries(assertionsOf(AREA_BY_CODE.get("C6")!).map((a) => [a, level]));
    await as(rev, (tx) => audit.setAreaRisks(tx, rev, engagement, "C6", rate("significant")));
    const loaded = await as(prep, (tx) => audit.listProcedures(tx, engagement, "C6"));
    const significant = loaded.find((p) => p.tier === "significant")!;
    const other = loaded.find((p) => p.tier === "significant" && p.id !== significant.id)!;
    const file = await upload(prep, { targetKind: "procedure", target: significant.id, fileName: "direct-bank-statement.pdf" });

    await as(rev, (tx) => audit.setAreaRisks(tx, rev, engagement, "C6", rate("low")));
    const after = await as(prep, (tx) => audit.listProcedures(tx, engagement, "C6"));
    expect(after.some((p) => p.id === significant.id)).toBe(true);
    expect(after.some((p) => p.id === other.id)).toBe(false);
    await expect(as(partner, (tx) => audit.setAuditEnabled(tx, partner, engagement, false))).rejects.toThrow(/cannot be turned off/);

    // Evidence a completed procedure relies on cannot be pulled until the procedure is reopened.
    await as(prep, (tx) => audit.updateProcedure(tx, prep, significant.id, { status: "done", workDone: "Statement obtained from the bank.", conclusion: "Agrees." }));
    await expect(remove(prep, file)).rejects.toThrow(/completed procedure/);
    await expect(remove(rev, file)).rejects.toThrow(/completed procedure/);
    await as(prep, (tx) => audit.updateProcedure(tx, prep, significant.id, { status: "open", workDone: "Statement obtained from the bank.", conclusion: "" }));
    await remove(prep, file);
  });

  it("keeps a lead sheet's evidence once the lead sheet is signed off", async () => {
    await as(partner, (tx) => repo.approveAllMappings(tx, partner, engagement));
    const list = await as(prep, (tx) => papers.listWorkingPapers(tx, engagement));
    const cashFile = list.find((w) => w.fileName === "bank-rec.xlsx")!;
    await as(prep, (tx) => review.signOff(tx, prep, engagement, "CASH", "preparer"));
    await expect(remove(prep, cashFile.id)).rejects.toThrow(/signed off/);
    await as(prep, (tx) => review.withdrawSignOff(tx, prep, engagement, "CASH", "preparer"));
    await remove(prep, cashFile.id);
    await upload(prep, { targetKind: "lead_sheet", target: "CASH", fileName: "bank-rec.xlsx" });
  });

  it("is invisible and closed to another firm", async () => {
    expect(await as(outsider, (tx) => papers.listWorkingPapers(tx, engagement))).toEqual([]);
    expect(await as(outsider, (tx) => papers.readWorkingPaper(tx, store, engagement, general))).toBeNull();
    await expect(remove(outsider, general)).rejects.toThrow(/not found/);
    await expect(as(outsider, (tx) => papers.addWorkingPaper(tx, outsider, store, engagement, { targetKind: "engagement", target: null, fileName: "x.pdf", data: bytes("x"), description: "" }))).rejects.toThrow(/not found/);
    expect(storedFiles()).toBe(3);
  });

  it("is frozen once the engagement is locked, but can still be read", async () => {
    await db.query("update engagements set status = 'locked' where id = $1", [engagement]);
    await expect(upload(prep, { fileName: "late.pdf" })).rejects.toThrow(/locked/);
    await expect(remove(rev, general)).rejects.toThrow(/locked/);
    expect((await as(prep, (tx) => papers.readWorkingPaper(tx, store, engagement, general)))?.fileName).toBe("bank-confirmation.pdf");
  });
});

describe("sample size", () => {
  const base = { populationMinor: 50000000, performanceMaterialityMinor: 5000000, risk: "moderate" as const, otherEvidence: false };
  it("scales with the population, the risk and other evidence", () => {
    expect(sampleSize(base)).toMatchObject({ size: 20, factor: 2, calculated: 20, notes: [] });
    expect(sampleSize({ ...base, risk: "high" })).toMatchObject({ size: 30 });
    expect(sampleSize({ ...base, risk: "high", otherEvidence: true })).toMatchObject({ size: 20 });
    expect(sampleSize({ ...base, risk: "low", otherEvidence: true })).toMatchObject({ size: 5, calculated: 5 });
  });
  it("applies the minimum, and flags a sample too large to be sensible", () => {
    const small = sampleSize({ ...base, populationMinor: 1000000 });
    expect(small).toMatchObject({ size: 5, calculated: 1 });
    expect("notes" in small && small.notes[0]).toContain("minimum of 5");
    const large = sampleSize({ ...base, populationMinor: 500000000, risk: "high" });
    expect(large).toMatchObject({ size: 300 });
    expect("notes" in large && large.notes[0]).toContain("reconsider the approach");
    expect(sampleSize({ ...base, populationMinor: 0 })).toMatchObject({ size: 0 });
  });
  it("needs materiality and a valid population", () => {
    expect(sampleSize({ ...base, performanceMaterialityMinor: 0 })).toEqual({ error: expect.stringContaining("Set materiality first") });
    expect(sampleSize({ ...base, populationMinor: -1 })).toEqual({ error: expect.stringContaining("positive number") });
  });
});
