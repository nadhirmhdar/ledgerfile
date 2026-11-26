import { getDb, withFirm, type Tx } from "./db";
import * as repo from "./repo";
import { audit, type Session } from "./repo";
import { canLock, type Role } from "../domain/signoff";
import { exportIndex } from "./wp-index-export";
import { buildWorkingPaperIndex } from "./wp-index";
import { statementsDownload } from "./statements-export";
import { generateReport } from "./report-download";
import { generateLetter, getLetterContext, LETTER_KINDS } from "./letters";
import { buildLetterDocx } from "./letters-docx";
import { exportSchedules } from "./schedule-export";
import { exportConfirmations } from "./confirmation-export";
import { exportLog } from "./audit-log";
import { listWorkingPapers, readWorkingPaper } from "./working-papers";
import { exportMaxBytes } from "./config";
import { SECTIONS, sectionOfCode, UNFILED } from "../domain/wp-index";
import { getFileStore, type FileStore } from "./file-store";
import { plainName } from "./http";
import { safeName, uniquePath, ZIP_MAX_BYTES, ZIP_LIMIT_MESSAGE, type ZipEntry } from "./zip";

/**
 * The whole engagement file for inspection, as the entries of a zip: every document comes from the generator the application already uses for it (never
 * a second version), and only the CURRENT version of each working paper is included. Entries are produced one at a time, each reading what it needs in its
 * own short transaction, so nothing is held for longer than one entry.
 */

export interface ExportPlan {
  engagementId: string;
  clientName: string;
  periodStart: string;
  periodEnd: string;
  firmName: string;
  by: string;
  status: string;
  fileName: string;
  /** The index section this download is of, or null for the whole file. */
  section: { code: string; title: string } | null;
}

export type PlanResult = { kind: "ok"; plan: ExportPlan } | { kind: "not_found" } | { kind: "too_large"; message: string };

/** Where each generated document sits in the index, so a section download takes the right ones. */
const STATEMENTS_SECTION = "G";
const REPORT_SECTION = "E";
const LETTER_SECTION: Record<(typeof LETTER_KINDS)[number], string> = { engagement: "A", representation: "D" };
/** A generated document is small next to uploaded evidence; this is the size assumed for each before it is produced. */
const GENERATED_BYTES = 15 * 1024;
const LOG_ENTRY_BYTES = 300;

export const overCapMessage = (cap: number) =>
  `The whole file is larger than ${formatBytes(cap)}, so it cannot be downloaded in one piece. Download it by section instead.`;
export const formatBytes = (n: number): string => (n >= 1024 * 1024 * 1024 ? `${(n / 1024 / 1024 / 1024).toFixed(1)} GB` : n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export interface SizeEstimate {
  files: number;
  bytes: number;
}
export interface ExportOutline {
  whole: SizeEstimate;
  /** The sections that hold something to download, in index order. */
  sections: ({ code: string; title: string } & SizeEstimate)[];
}

/**
 * About how many files and bytes each download will be, from stored sizes and counts only: nothing is generated to measure it. Working papers are their
 * recorded sizes; each generated document is assumed small; the audit log CSV is estimated from its number of entries; README is one more file.
 */
export async function outlineExport(tx: Tx, engagementId: string): Promise<ExportOutline | null> {
  const index = await buildWorkingPaperIndex(tx, engagementId);
  if (!index) return null;
  const papers = await listWorkingPapers(tx, engagementId);
  const sizeOf = new Map(papers.map((p) => [p.id, p.sizeBytes]));
  const per = new Map<string, SizeEstimate>();
  const add = (section: string, bytes: number, files = 1) => {
    const now = per.get(section) ?? { files: 0, bytes: 0 };
    per.set(section, { files: now.files + files, bytes: now.bytes + bytes });
  };
  for (const section of index.sections) for (const e of section.entries) if (e.kind === "file") add(section.code, sizeOf.get(e.href.split("/").pop()!) ?? 0);

  const facts = (
    await tx.query<{ accounts: number; audited: boolean; opinion: boolean; logged: number }>(
      `select (select count(*)::int from accounts where engagement_id = $1) as accounts, e.audit_enabled as audited,
              exists (select 1 from audit_opinions where engagement_id = $1) as opinion,
              (select count(*)::int from audit_log where entity_id = $1) as logged
       from engagements e where e.id = $1`,
      [engagementId],
    )
  ).rows[0];
  if (facts.accounts > 0) add(STATEMENTS_SECTION, 2 * GENERATED_BYTES, 2);
  if (facts.audited && facts.opinion) add(REPORT_SECTION, 2 * GENERATED_BYTES, 2);
  if (facts.audited) for (const kind of LETTER_KINDS) add(LETTER_SECTION[kind], GENERATED_BYTES);
  const schedules = await tx.query<{ areaCode: string; n: number }>('select area_code as "areaCode", count(*)::int as n from test_schedules where engagement_id = $1 group by area_code', [engagementId]);
  for (const r of schedules.rows) add(sectionOfCode(r.areaCode) ?? UNFILED, r.n * GENERATED_BYTES, r.n);
  const confirmed = facts.audited ? await tx.query<{ areaCode: string }>('select distinct area_code as "areaCode" from confirmations where engagement_id = $1', [engagementId]) : { rows: [] };
  const confirmationSections = new Set(confirmed.rows.map((r) => sectionOfCode(r.areaCode) ?? UNFILED));

  const log = facts.logged * LOG_ENTRY_BYTES;
  const always = { files: 2, bytes: log + 1500 };
  const total = [...per.values()].reduce((t, x) => ({ files: t.files + x.files, bytes: t.bytes + x.bytes }), { files: 0, bytes: 0 });
  // The whole file also holds the index and the confirmations workbook once.
  const whole = {
    files: total.files + always.files + 1 + (facts.audited ? 1 : 0),
    bytes: total.bytes + always.bytes + GENERATED_BYTES + (facts.audited ? GENERATED_BYTES : 0),
  };
  for (const code of confirmationSections) add(code, GENERATED_BYTES);
  const sections = SECTIONS.filter((d) => per.has(d.code)).map((d) => {
    const own = per.get(d.code)!;
    return { code: d.code, title: d.title, files: own.files + always.files, bytes: own.bytes + always.bytes };
  });
  return { whole, sections };
}

/** Room left for the generated documents and headers when the working papers are checked against the zip limit. */
const HEADROOM = 200 * 1024 * 1024;

/** Partners and administrators only, with the role read again from the database; anyone else, or another firm's engagement, is "not found". */
export async function planExport(tx: Tx, s: Session, engagementId: string, sectionCode: string | null = null, cap: number = exportMaxBytes()): Promise<PlanResult> {
  const who = await tx.query<{ role: Role; active: boolean; name: string }>("select role, active, name from users where id = $1 and firm_id = $2", [s.userId, s.firmId]);
  if (!who.rows[0]?.active || !canLock(who.rows[0].role)) return { kind: "not_found" };
  const engagement = await repo.getEngagement(tx, engagementId);
  if (!engagement) return { kind: "not_found" };
  const outline = (await outlineExport(tx, engagementId))!;
  const section = sectionCode === null ? null : (outline.sections.find((x) => x.code === sectionCode) ?? undefined);
  if (section === undefined) return { kind: "not_found" };
  // The cap is on the whole file; a section is how a larger file is taken. Both stay inside the classic zip limit.
  if (section === null && outline.whole.bytes > cap) return { kind: "too_large", message: overCapMessage(cap) };
  if ((section ?? outline.whole).bytes > ZIP_MAX_BYTES - HEADROOM) return { kind: "too_large", message: ZIP_LIMIT_MESSAGE };
  const firm = (await tx.query<{ name: string }>("select name from firms where id = $1", [s.firmId])).rows[0]?.name ?? "";
  return {
    kind: "ok",
    plan: {
      engagementId,
      clientName: engagement.clientName,
      periodStart: engagement.periodStart,
      periodEnd: engagement.periodEnd,
      firmName: firm,
      by: who.rows[0].name,
      status: engagement.status,
      section: section ? { code: section.code, title: section.title } : null,
      fileName: `${plainName(engagement.clientName)}-file-${engagement.periodEnd}${section ? `-section-${plainName(section.code)}` : ""}.zip`,
    },
  };
}

const NOT_READ = "This item could not be produced when the file was downloaded.";

/**
 * The zip's entries, in order, then the audit log CSV and README.txt. The download itself is audit-logged when the stream ends (or is abandoned),
 * with the number of files and their total bytes.
 */
export async function* fileExportEntries(s: Session, plan: ExportPlan, store: () => FileStore = getFileStore, now: Date = new Date()): AsyncGenerator<ZipEntry> {
  const id = plan.engagementId;
  const db = await getDb();
  const read = <T,>(work: (tx: Tx) => Promise<T>) => withFirm(db, s.firmId, work);
  const taken = new Set<string>();
  const contents: string[] = [];
  const problems: string[] = [];
  let files = 0;
  let bytes = 0;
  let complete = false;

  const entry = (folder: string, name: string, data: Uint8Array | Buffer): ZipEntry => {
    const path = uniquePath(folder === "" ? safeName(name) : `${folder}/${safeName(name)}`, taken);
    contents.push(path);
    files += 1;
    bytes += data.length;
    return { name: path, data };
  };
  /** A document that cannot be produced is named in README.txt rather than stopping the whole download. */
  const attempt = async <T,>(what: string, work: () => Promise<T>): Promise<T | null> => {
    try {
      return await work();
    } catch (e) {
      console.error("whole-file export:", what, e instanceof Error ? e.message : "unknown error");
      problems.push(`${what}: ${NOT_READ}`);
      return null;
    }
  };

  const only = plan.section?.code ?? null;
  const wants = (section: string) => only === null || only === section;
  try {
    if (only === null) {
      const index = await attempt("Index", () => read((tx) => exportIndex(tx, s, id)));
      if (index) yield entry("", "00 Index.xlsx", index.buffer);
    }

    // The statements, exactly as the statements page downloads them (draft labels included).
    for (const format of wants(STATEMENTS_SECTION) ? (["pdf", "docx"] as const) : []) {
      const file = await attempt(`Financial statements (${format})`, async () => {
        const response = await statementsDownload(s, id, "http://export.invalid/", format);
        return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
      });
      if (file) yield entry("01 Financial statements", `${plainName(plan.clientName)}-financial-statements-${plan.periodEnd}.${format}`, file);
    }

    // The auditor's report, when the audit is on and an opinion is recorded.
    for (const format of wants(REPORT_SECTION) ? (["docx", "pdf"] as const) : []) {
      const report = await attempt(`Auditor's report (${format})`, () =>
        read(async (tx) => {
          const r = await generateReport(tx, s, id, {}, format, store);
          if (r.kind !== "ok") return null;
          if (format === "pdf") {
            const { renderPdf } = await import("./pdf");
            return { name: r.fileName, data: await renderPdf(r.blocks, { title: r.title, header: r.header, logo: r.logo }) };
          }
          return { name: r.fileName, data: await buildLetterDocx(r.title, r.blocks, { logo: r.logo }) };
        }),
      );
      if (report) yield entry("02 Auditor's report", report.name, report.data);
    }

    // Every letter the letters page can produce, as it produces them with nothing typed in.
    if (await read((tx) => getLetterContext(tx, id))) {
      for (const kind of LETTER_KINDS.filter((k) => wants(LETTER_SECTION[k]))) {
        const letter = await attempt(`${kind} letter`, () =>
          read(async (tx) => {
            const l = await generateLetter(tx, s, id, kind, {}, store);
            if (!l) return null;
            return { name: `${plainName(l.context.clientName)}-${kind}-letter-${l.context.periodEnd}.docx`, data: await buildLetterDocx(l.title, l.blocks, { logo: l.logo }) };
          }),
        );
        if (letter) yield entry("03 Letters", letter.name, letter.data);
      }
    }

    // Each test schedule's own export, then the confirmations.
    const schedules = await read(async (tx) => (await tx.query<{ id: string; reference: string; areaCode: string }>('select id, reference, area_code as "areaCode" from test_schedules where engagement_id = $1 order by area_code, seq', [id])).rows);
    for (const schedule of schedules.filter((x) => wants(sectionOfCode(x.areaCode) ?? UNFILED))) {
      const file = await attempt(`Test schedule ${schedule.reference}`, () => read((tx) => exportSchedules(tx, s, id, schedule.id)));
      if (file) yield entry("04 Test schedules", `${schedule.reference} ${file.fileName}`, file.buffer);
    }
    // The confirmations workbook covers every area; a section takes it when that section has confirmations.
    const takesConfirmations =
      only === null || (await read(async (tx) => (await tx.query<{ areaCode: string }>('select distinct area_code as "areaCode" from confirmations where engagement_id = $1', [id])).rows.some((r) => (sectionOfCode(r.areaCode) ?? UNFILED) === only)));
    const confirmations = takesConfirmations ? await attempt("Confirmations", () => read((tx) => exportConfirmations(tx, s, id))) : null;
    if (confirmations) yield entry("05 Confirmations", confirmations.fileName, confirmations.buffer);

    // The CURRENT version of every working paper, foldered as the index groups them. Read one at a time.
    const grouped = await read(async (tx) => {
      const built = await buildWorkingPaperIndex(tx, id);
      return (built?.sections ?? []).filter((section) => wants(section.code)).flatMap((section) =>
        section.entries.filter((e) => e.kind === "file").map((e) => ({ folder: `06 Working papers/${safeName(sectionFolder(section))}`, reference: e.reference, fileName: e.title, fileId: e.href.split("/").pop()! })),
      );
    });
    for (const paper of grouped) {
      const file = await attempt(`Working paper ${paper.fileName}`, () => read((tx) => readWorkingPaper(tx, store(), id, paper.fileId)));
      if (file) yield entry(paper.folder, paper.fileName, file.data);
      else if (!problems.some((p) => p.startsWith(`Working paper ${paper.fileName}:`))) problems.push(`Working paper ${paper.fileName}: ${NOT_READ}`);
    }

    // This engagement's audit log entries only, in the firm audit-log export's columns.
    const log = await attempt("Audit log", () => read((tx) => exportLog(tx, s, { person: null, engagement: id, action: null, from: null, to: null }, "csv")));
    if (log) {
      if (log.ok) yield entry("", "Audit log.csv", Buffer.from(log.body as string, "utf8"));
      else problems.push(`Audit log: ${log.message}`);
    }

    // README is written last and ends with the number of entries in the zip, itself included, so a cut-off download can be told from a whole one.
    const readme = readmeText(plan, contents, problems, now);
    yield entry("", "README.txt", Buffer.from(readme, "utf8"));
    complete = true;
  } finally {
    // Logged whether the download finished or was abandoned part way.
    await read((tx) => audit(tx, s, "export_whole_file", "engagement", id, { files, bytes, complete, notProduced: problems.length, ...(only ? { section: only } : {}) })).catch((e) =>
      console.error("whole-file export was not logged:", e instanceof Error ? e.message : "unknown error"),
    );
  }
}

/** "C5 Trade receivables" for a coded section; the title alone where the code is a word (Unfiled, General). */
const sectionFolder = (s: { code: string; title: string }) => (/^[A-Z]{3,}$/.test(s.code) ? s.title : `${s.code} ${s.title}`);

export function readmeText(plan: ExportPlan, contents: string[], problems: string[], now: Date): string {
  const lines = [
    "Engagement file",
    "",
    `Firm: ${plan.firmName}`,
    `Client: ${plan.clientName}`,
    `Period: ${plan.periodStart} to ${plan.periodEnd}`,
    `Engagement status: ${plan.status}`,
    ...(plan.section ? [`This download holds one index section only: ${plan.section.code} ${plan.section.title}.`] : []),
    `Produced: ${now.toISOString().slice(0, 16).replace("T", " ")} UTC`,
    `Produced by: ${plan.by}`,
    `Files, not counting this one: ${contents.length}`,
    "",
    "Contents",
    ...contents.map((c) => `  ${c}`),
    "",
    "Notes",
    "  Only the current version of each working paper is included; earlier versions stay in the application.",
    "  Generated documents are as the application produces them now, including any draft labels.",
    "  Audit log.csv holds this engagement's entries only.",
    ...(problems.length > 0 ? ["", "Not included", ...problems.map((p) => `  ${p}`)] : []),
    "",
    "A complete zip ends with this README, whose last line states the number of files in the zip. If it is missing or does not match, the download was cut off.",
    "",
    `End of file: ${contents.length + 1} entries`,
  ];
  return lines.join("\r\n");
}
