// Writes a synthetic journal listing for the sample client's 2025 year, for trying journal
// entry testing. It reconciles to samples/falcon-tb-2025.xlsx (retained earnings takes the prior year's
// result and the dividend is the only other equity movement) and includes a few entries with the characteristics
// journal testing looks for. Every name and figure is invented.
import ExcelJS from "exceljs";
import { writeFileSync } from "node:fs";

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile("samples/falcon-tb-2025.xlsx");
const ws = wb.worksheets[0];
const minor = (v) => Math.round((Number(v) || 0) * 100);

// Columns: code, name, debit, credit, prior year (signed). The header is on row 4.
const accounts = [];
for (let r = 5; r <= ws.rowCount; r++) {
  const code = String(ws.getRow(r).getCell(1).value ?? "");
  if (!/^\d+$/.test(code)) continue;
  const row = ws.getRow(r);
  accounts.push({ code, name: String(row.getCell(2).value ?? ""), closing: minor(row.getCell(3).value) - minor(row.getCell(4).value), prior: minor(row.getCell(5).value) });
}

const suspicious = [
  // [entry, date (DD/MM/YYYY), posted by, description, [[code, signed amount in minor units], ...]]
  ["JV-9001", "31/12/2025", "owner", "", [["1100", 25000000], ["4000", -25000000]]],
  ["JV-9002", "03/01/2026", "owner", "Reverse JV-9001", [["4000", 25000000], ["1100", -25000000]]],
  ["JV-9003", "16/08/2025", "owner", "Reclass", [["6300", 1800000], ["4900", -1800000]]],
  ["JV-9004", "30/12/2025", "accountant", "Year-end accrual true-up", [["6200", 432150], ["2100", -432150]]],
];
const suspiciousNet = new Map();
for (const [, date, , , lines] of suspicious) {
  // Entries dated after the year end are in the listing but are not part of the 2025 movement.
  if (!date.endsWith("/2025")) continue;
  for (const [code, amount] of lines) suspiciousNet.set(code, (suspiciousNet.get(code) ?? 0) + amount);
}

// Balance sheet accounts (codes below 4000) move from the prior-year balance; income and expense accounts from zero.
// What the suspicious entries already cover is taken out, and the rest is spread over twelve monthly summary entries.
const movement = accounts.map((a) => ({ ...a, amount: (Number(a.code) < 4000 ? a.closing - a.prior : a.closing) - (suspiciousNet.get(a.code) ?? 0) }));
const retained = movement.find((m) => m.code === "3200");
retained.amount -= movement.reduce((s, m) => s + m.amount, 0);

const nameOf = new Map(accounts.map((a) => [a.code, a.name]));
const money = (m) => (m / 100).toFixed(2);
const out = [["Date", "Journal No", "Account Code", "Account Name", "Description", "Debit", "Credit", "Posted By"]];
const posted = new Map();
for (let month = 1; month <= 12; month++) {
  const entry = `JV-2025-${String(month).padStart(2, "0")}`;
  const date = `28/${String(month).padStart(2, "0")}/2025`;
  // Each month takes a twelfth, rounded down; December takes what is left. Rounding would leave a
  // monthly entry a few fils out of balance, so retained earnings absorbs the difference each month.
  const shares = movement.map((m) => (month === 12 ? m.amount - (posted.get(m.code) ?? 0) : Math.trunc(m.amount / 12)));
  if (month < 12) shares[movement.indexOf(retained)] -= shares.reduce((x, y) => x + y, 0);
  for (const [i, m] of movement.entries()) {
    const amount = shares[i];
    posted.set(m.code, (posted.get(m.code) ?? 0) + amount);
    if (amount === 0) continue;
    out.push([date, entry, m.code, m.name, "Monthly summary of transactions", amount > 0 ? money(amount) : "", amount < 0 ? money(-amount) : "", "accountant"]);
  }
}
for (const [entry, date, user, description, lines] of suspicious) {
  for (const [code, amount] of lines) out.push([date, entry, code, nameOf.get(code) ?? "", description, amount > 0 ? money(amount) : "", amount < 0 ? money(-amount) : "", user]);
}
const quote = (c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
writeFileSync("samples/falcon-journals-2025.csv", out.map((r) => r.map(quote).join(",")).join("\n") + "\n");
console.log(`wrote samples/falcon-journals-2025.csv (${out.length - 1} lines)`);
