import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readGrid } from "../src/server/excel";
import { parseTrialBalance } from "../src/domain/tb-parse";
import { proposeMappings } from "./rule-mapping";

const load = (name: string) => {
  const buf = readFileSync(`samples/${name}`);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
};

describe("Excel import", () => {
  it("reads the 2025 sample workbook into a balanced trial balance with comparatives", async () => {
    const parsed = parseTrialBalance(await readGrid("falcon-tb-2025.xlsx", load("falcon-tb-2025.xlsx")));
    expect(parsed.errors).toEqual([]);
    expect(parsed.balanced).toBe(true);
    expect(parsed.accounts).toHaveLength(31);
    const receivables = parsed.accounts.find((a) => a.code === "1100");
    expect(receivables).toMatchObject({ closingMinor: 91245025, priorMinor: 68420000 });
    const sales = parsed.accounts.find((a) => a.code === "4000");
    expect(sales?.closingMinor).toBe(-389040000);
  });

  it("maps every sample account by rule", async () => {
    const parsed = parseTrialBalance(await readGrid("falcon-tb-2024.xlsx", load("falcon-tb-2024.xlsx")));
    expect(parsed.balanced).toBe(true);
    const { suggestions, unmapped } = proposeMappings(parsed.accounts, new Map());
    expect(unmapped).toEqual([]);
    const group = (code: string) => suggestions.find((s) => s.accountCode === code)?.groupCode;
    expect(group("1000")).toBe("CASH");
    expect(group("1110")).toBe("TRADEREC");
    expect(group("1590")).toBe("PPE");
    expect(group("2200")).toBe("RPPAY");
    expect(group("2400")).toBe("EOSB");
    expect(group("5000")).toBe("COS");
    expect(group("6400")).toBe("DEPN");
    expect(group("6600")).toBe("FINCOST");
  });

  it("rejects unsupported and unreadable files with a clear message", async () => {
    await expect(readGrid("tb.xls", new ArrayBuffer(8))).rejects.toThrow(/\.xls files are not supported/);
    await expect(readGrid("tb.pdf", new ArrayBuffer(8))).rejects.toThrow(/Excel \(\.xlsx\) or CSV/);
    await expect(readGrid("tb.xlsx", new TextEncoder().encode("not a zip").buffer as ArrayBuffer)).rejects.toThrow(/could not be read/);
    await expect(readGrid("tb.xlsx", new ArrayBuffer(0))).rejects.toThrow(/empty/);
  });
});
