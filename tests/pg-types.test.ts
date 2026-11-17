import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/server/db";
import { parseBigint, parseDate, parseSimpleArray, prepareParam, typeParsers } from "../src/server/pg-adapter";
import { describeValue, EXPECTED, typeRoundTrip } from "./pg-roundtrip";

describe("the Postgres type parsers match what PGlite returns", () => {
  it("bigint is a number when exact and a BigInt only when it would lose digits", () => {
    expect(parseBigint("12345")).toBe(12345);
    expect(parseBigint("-7")).toBe(-7);
    expect(parseBigint("9007199254740991")).toBe(9007199254740991);
    expect(parseBigint("9007199254740993")).toBe(BigInt("9007199254740993"));
    expect(parseBigint("-9007199254740993")).toBe(BigInt("-9007199254740993"));
  });
  it("date is midnight UTC, whatever zone the server is in", () => {
    expect(parseDate("2025-12-31").toISOString()).toBe("2025-12-31T00:00:00.000Z");
    expect(parseDate("2025-01-01").toISOString()).toBe("2025-01-01T00:00:00.000Z");
  });
  it("arrays of bigint and date are parsed element by element", () => {
    expect(parseSimpleArray("{1,2,9007199254740993}", parseBigint)).toEqual([1, 2, BigInt("9007199254740993")]);
    expect(parseSimpleArray("{}", parseBigint)).toEqual([]);
    expect(parseSimpleArray("{1,NULL}", parseBigint)).toEqual([1, null]);
    expect(parseSimpleArray("{2025-01-01,2025-02-02}", parseDate).map((d) => d?.toISOString())).toEqual(["2025-01-01T00:00:00.000Z", "2025-02-02T00:00:00.000Z"]);
  });
  it("is chosen by type for exactly bigint, bigint[], date and date[], and leaves the rest to node-postgres", () => {
    expect(typeParsers.getTypeParser(20)).toBe(parseBigint);
    expect((typeParsers.getTypeParser(1016) as (v: string) => unknown)("{1,2}")).toEqual([1, 2]);
    expect(typeParsers.getTypeParser(1082)).toBe(parseDate);
    expect((typeParsers.getTypeParser(1182) as (v: string) => unknown[])("{2025-01-01}")[0]).toEqual(new Date("2025-01-01T00:00:00Z"));
    // numeric stays text, int4 a number, bool a boolean, as in PGlite.
    expect(typeParsers.getTypeParser(1700)("0.85")).toBe("0.85");
    expect(typeParsers.getTypeParser(23)("5")).toBe(5);
    expect(typeParsers.getTypeParser(16)("t")).toBe(true);
  });
  it("sends what node-postgres cannot: bigint as digits, a Date as an instant", () => {
    expect(prepareParam(BigInt("9007199254740993"))).toBe("9007199254740993");
    expect(prepareParam(new Date("2025-12-31T00:00:00Z"))).toBe("2025-12-31T00:00:00.000Z");
    expect(prepareParam([BigInt(1), BigInt(2)])).toEqual(["1", "2"]);
    expect(prepareParam("x")).toBe("x");
    expect(prepareParam(null)).toBeNull();
  });
});

describe("PGlite, the reference", () => {
  it("returns the values the adapter is built to match, for every column type", async () => {
    const db = await openDatabase();
    const got = describeValue(await typeRoundTrip(db));
    expect(got).toEqual(EXPECTED);
    await db.close();
  });
});
