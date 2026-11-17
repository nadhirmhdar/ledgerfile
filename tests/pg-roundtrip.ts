import type { Db } from "../src/server/db";

/**
 * One row of every column type the migrations use, read back through a Db. The same function runs against PGlite and against the
 * Postgres adapter, and both must give EXPECTED, so the adapter returns the JavaScript values the code was written against.
 */
export async function typeRoundTrip(db: Db): Promise<Record<string, unknown>> {
  return db.transaction(async (tx) => {
    await tx.exec(`create temporary table rt (
      i8 bigint, i8big bigint, n numeric(3, 2), i int, d date, ts timestamptz, b boolean,
      da date[], ua uuid[], ia bigint[], j jsonb, t text, nul bigint
    ) on commit drop`);
    await tx.query(
      `insert into rt values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, null)`,
      [12345, "9007199254740993", "0.85", 5, "2025-12-31", "2025-12-31T23:30:00Z", true, ["2025-01-01", "2025-02-02"], ["11111111-1111-4111-8111-111111111111"], [1, 2], JSON.stringify({ x: [1, 2] }), "text"],
    );
    const { rows } = await tx.query(`select * from rt`);
    const agg = await tx.query(`select sum(i8) as total, count(*) as n_rows, max(i8) as biggest from rt`);
    return { ...rows[0], total: agg.rows[0].total, nRows: agg.rows[0].n_rows, biggest: agg.rows[0].biggest };
  });
}

/** Describe a value so that two results can be compared exactly, including type: a Date by instant, a bigint by digits. */
export function describeValue(v: unknown): unknown {
  if (v instanceof Date) return `Date:${v.toISOString()}`;
  if (typeof v === "bigint") return `bigint:${v}`;
  if (typeof v === "number") return `number:${v}`;
  if (Array.isArray(v)) return v.map(describeValue);
  if (v !== null && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, describeValue(x)]));
  return v;
}

export const EXPECTED: Record<string, unknown> = {
  i8: "number:12345",
  i8big: "bigint:9007199254740993",
  n: "0.85",
  i: "number:5",
  d: "Date:2025-12-31T00:00:00.000Z",
  ts: "Date:2025-12-31T23:30:00.000Z",
  b: true,
  da: ["Date:2025-01-01T00:00:00.000Z", "Date:2025-02-02T00:00:00.000Z"],
  ua: ["11111111-1111-4111-8111-111111111111"],
  ia: ["number:1", "number:2"],
  j: { x: ["number:1", "number:2"] },
  t: "text",
  nul: null,
  // sum() of a bigint is numeric, which both return as a string, so two amounts can never silently concatenate.
  total: "12345",
  nRows: "number:1",
  biggest: "number:12345",
};
