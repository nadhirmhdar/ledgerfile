// Writes synthetic trial balances for a made-up company, for trying the import.
// No real client data: every name and figure here is invented.
import ExcelJS from "exceljs";
import { mkdirSync } from "node:fs";

const rows = [
  // code, name, 2024 balance, 2025 balance (debit positive, credit negative)
  ["1000", "Emirates Bank current account - AED", 412350.75, 538120.4],
  ["1010", "Petty cash", 5000, 4200],
  ["1100", "Trade receivables", 684200, 912450.25],
  ["1110", "Allowance for doubtful debts", -34000, -41500],
  ["1150", "Prepaid rent", 60000, 65000],
  ["1160", "Refundable deposits", 25000, 25000],
  ["1200", "Inventories - finished goods", 356780.5, 401230],
  ["1500", "Furniture and fixtures", 180000, 195000],
  ["1510", "Motor vehicles", 240000, 240000],
  ["1590", "Accumulated depreciation", -152000, -218500],
  ["2000", "Trade payables", -398450.25, -455780.65],
  ["2100", "Accrued expenses", -72300, -88900],
  ["2150", "VAT payable", -31250, -42600],
  ["2200", "Due to related parties", -150000, -120000],
  ["2300", "Bank loan", -300000, -240000],
  ["2400", "Provision for end of service benefits", -96500, -118750],
  ["3000", "Share capital", -300000, -300000],
  // The reserve is the same at both year-ends: no transfer is booked in 2025, so the statutory reserve (a separate equity group) and retained earnings
  // each roll forward from last year with nothing in between that the prior-year checks cannot see.
  ["3100", "Statutory reserve", -45000, -45000],
  // Both retained earnings figures are filled in below: 2024 balances the trial balance; 2025 is last year's closing balance.
  ["3200", "Retained earnings", 0, 0],
  // Dividends paid in 2025, in the retained earnings group. The amount is filled in below as the figure that balances 2025.
  ["3300", "Dividends paid", 0, 0],
  ["4000", "Sales", -3250000, -3890400],
  ["4900", "Other income", -12500, -18250],
  ["5000", "Cost of goods sold", 2112500, 2489856],
  ["6000", "Salaries and wages", 486000, 532400],
  ["6100", "Office rent", 120000, 130000],
  ["6200", "Utilities", 28400, 31150],
  ["6300", "Professional fees", 35000, 42000],
  ["6400", "Depreciation expense", 60000, 66500],
  ["6500", "Bank charges", 4250, 5120],
  ["6600", "Interest on loan", 21000, 17400],
  ["6700", "Marketing and advertising", 0, 38500],
  ["7000", "Project Falcon clearing", 0, 0],
];

const re = rows.find((r) => r[0] === "3200");
const dividends = rows.find((r) => r[0] === "3300");
const total = (col) => rows.reduce((s, r) => s + Math.round(r[col] * 100), 0);
const profit = (col) => -rows.filter((r) => /^[4-7]/.test(r[0])).reduce((s, r) => s + Math.round(r[col] * 100), 0);

// 2024: the first year's trial balance is balanced through retained earnings, as before.
re[2] = -total(2) / 100;
// 2025: retained earnings (taken before this year's result, as every trial balance here is) open at last year's closing balance: the 2024 balance
// plus the 2024 profit. Nothing else moves them except the dividend, which is the figure that balances 2025.
const closing2024 = -Math.round(re[2] * 100) + profit(2);
re[3] = -closing2024 / 100;
dividends[3] = -total(3) / 100;
if (dividends[3] <= 0) throw new Error("The 2025 dividend should be a debit; check the figures above.");
console.log(`2024 closing retained earnings ${closing2024 / 100}; 2025 dividends paid ${dividends[3]}`);

mkdirSync("samples", { recursive: true });

async function write(file, yearCol, priorCol, title, drop = []) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Trial balance");
  ws.addRow(["Falcon Trading LLC (sample data)"]);
  ws.addRow([title]);
  ws.addRow([]);
  ws.addRow(priorCol ? ["Account Code", "Account Name", "Debit", "Credit", "Prior Year"] : ["Account Code", "Account Name", "Debit", "Credit"]);
  let dr = 0;
  let cr = 0;
  for (const r of rows) {
    if (drop.includes(r[0])) continue;
    const v = r[yearCol];
    if (v === 0 && (!priorCol || r[priorCol] === 0)) continue;
    const line = [r[0], r[1], v > 0 ? v : null, v < 0 ? -v : null];
    if (priorCol) line.push(r[priorCol]);
    ws.addRow(line);
    if (v > 0) dr += v;
    else cr -= v;
  }
  ws.addRow(["Total", "", Math.round(dr * 100) / 100, Math.round(cr * 100) / 100]);
  ws.getColumn(2).width = 42;
  for (const c of [3, 4, 5]) {
    ws.getColumn(c).width = 16;
    ws.getColumn(c).numFmt = "#,##0.00";
  }
  await wb.xlsx.writeFile(`samples/${file}`);
  console.log(`wrote samples/${file}`);
}

await write("falcon-tb-2024.xlsx", 2, null, "Trial balance at 31 December 2024", ["6700"]);
await write("falcon-tb-2025.xlsx", 3, 2, "Trial balance at 31 December 2025");
