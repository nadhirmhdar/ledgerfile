// Writes the sample client's financial statements to a Word file, without needing the app running.
// Useful for checking how the export looks: npm run sample:statements
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readGrid } from "../src/server/excel";
import { parseTrialBalance } from "../src/domain/tb-parse";
import { proposeMappings } from "../src/domain/mapping";
import { buildStatementPack } from "../src/domain/statement-pack";
import { buildStatementsDocx } from "../src/server/statements-docx";

const file = "samples/falcon-tb-2025.xlsx";
const buf = readFileSync(file);
const parsed = parseTrialBalance(await readGrid(file, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer));
const { suggestions } = proposeMappings(parsed.accounts, new Map());
const group = new Map(suggestions.map((s) => [s.accountCode, s.groupCode]));
const pack = buildStatementPack(
  parsed.accounts.map((a) => ({ ...a, groupCode: group.get(a.code) ?? null, approved: true })),
  { unitMinor: 100 },
);
const docx = await buildStatementsDocx({ clientName: "Falcon Trading LLC (sample)", periodStart: "2025-01-01", periodEnd: "2025-12-31", pack, draft: true });
mkdirSync("samples/output", { recursive: true });
writeFileSync("samples/output/falcon-statements-sample.docx", docx);
console.log(`wrote samples/output/falcon-statements-sample.docx (${docx.length} bytes, checks ${pack.clean ? "pass" : "outstanding"})`);
