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
}

export type PlanResult = { kind: "ok"; plan: ExportPlan } | { kind: "not_found" } | { kind: "too_large"; message: string };

/** Room left for the generated documents and headers when the working papers are checked against the zip limit. */
const HEADROOM = 200 * 1024 * 1024;

/** Partners and administrators only, with the role read again from the database; anyone else, or another firm's engagement, is "not found". */
export async function planExport(tx: Tx, s: Session, engagementId: string): Promise<PlanResult> {
  const who = await tx.query<{ role: Role; active: boolean; name: string }>("select role, active, name from users where id = $1 and firm_id = $2", [s.userId, s.firmId]);
  if (!who.rows[0]?.active || !canLock(who.rows[0].role)) return { kind: "not_found" };
  const engagement = await repo.getEngagement(tx, engagementId);
  if (!engagement) return { kind: "not_found" };
  const papers = await listWorkingPapers(tx, engagementId);
  if (papers.reduce((t, p) => t + p.sizeBytes, 0) > ZIP_MAX_BYTES - HEADROOM) return { kind: "too_large", message: ZIP_LIMIT_MESSAGE };
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
      fileName: `${plainName(engagement.clientName)}-file-${engagement.periodEnd}.zip`,
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

  try {
    const index = await attempt("Index", () => read((tx) => exportIndex(tx, s, id)));
    if (index) yield entry("", "00 Index.xlsx", index.buffer);

    // The statements, exactly as the statements page downloads them (draft labels included).
    for (const format of ["pdf", "docx"] as const) {
      const file = await attempt(`Financial statements (${format})`, async () => {
        const response = await statementsDownload(s, id, "http://export.invalid/", format);
        return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
      });
      if (file) yield entry("01 Financial statements", `${plainName(plan.clientName)}-financial-statements-${plan.periodEnd}.${format}`, file);
    }

    // The auditor's report, when the audit is on and an opinion is recorded.
    for (const format of ["docx", "pdf"] as const) {
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
      for (const kind of LETTER_KINDS) {
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
    const schedules = await read(async (tx) => (await tx.query<{ id: string; reference: string }>("select id, reference from test_schedules where engagement_id = $1 order by area_code, seq", [id])).rows);
    for (const schedule of schedules) {
      const file = await attempt(`Test schedule ${schedule.reference}`, () => read((tx) => exportSchedules(tx, s, id, schedule.id)));
      if (file) yield entry("04 Test schedules", `${schedule.reference} ${file.fileName}`, file.buffer);
    }
    const confirmations = await attempt("Confirmations", () => read((tx) => exportConfirmations(tx, s, id)));
    if (confirmations) yield entry("05 Confirmations", confirmations.fileName, confirmations.buffer);

    // The CURRENT version of every working paper, foldered as the index groups them. Read one at a time.
    const grouped = await read(async (tx) => {
      const built = await buildWorkingPaperIndex(tx, id);
      return (built?.sections ?? []).flatMap((section) =>
        section.entries.filter((e) => e.kind === "file").map((e) => ({ folder: `06 Working papers/${safeName(`${section.code} ${section.title}`)}`, reference: e.reference, fileName: e.title, fileId: e.href.split("/").pop()! })),
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

    const readme = readmeText(plan, contents, problems, now);
    yield entry("", "README.txt", Buffer.from(readme, "utf8"));
    complete = true;
  } finally {
    // Logged whether the download finished or was abandoned part way.
    await read((tx) => audit(tx, s, "export_whole_file", "engagement", id, { files, bytes, complete, notProduced: problems.length })).catch((e) =>
      console.error("whole-file export was not logged:", e instanceof Error ? e.message : "unknown error"),
    );
  }
}

export function readmeText(plan: ExportPlan, contents: string[], problems: string[], now: Date): string {
  const lines = [
    "Engagement file",
    "",
    `Firm: ${plan.firmName}`,
    `Client: ${plan.clientName}`,
    `Period: ${plan.periodStart} to ${plan.periodEnd}`,
    `Engagement status: ${plan.status}`,
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
  ];
  return lines.join("\r\n");
}
