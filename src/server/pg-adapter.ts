import pg from "pg";
import type { Db, Queryable, Tx } from "./db";
import { redact, withVerifiedTls } from "./config";

/**
 * The Postgres side of the Db interface, for hosted deployments. It is built for a serverless host behind a transaction pooler:
 * one small pool per process, unnamed statements only (node-postgres sends none by default), no session-level SET, and one client
 * held for the whole of a transaction, so the role and firm that withFirm sets with SET LOCAL apply to every statement in it.
 *
 * It must return the same JavaScript values PGlite does, because the rest of the code was written against PGlite. node-postgres
 * differs in three ways, which the parsers below remove:
 *   - bigint: PGlite gives a number, or a BigInt only when it is too big to be exact; node-postgres gives a string, so a sum
 *     of two amounts would concatenate;
 *   - date: PGlite gives midnight UTC; node-postgres gives midnight in the server's local zone, which can shift the day;
 *   - bigint[] and date[]: the same two differences, element by element.
 * numeric stays a string, timestamptz a Date, jsonb an object, int a number and boolean a boolean, as in both.
 */

const OID = { int8: 20, int8Array: 1016, date: 1082, dateArray: 1182, textArray: 1009 } as const;

export const parseBigint = (v: string): number | bigint => {
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : BigInt(v);
};
export const parseDate = (v: string): Date => new Date(`${v}T00:00:00Z`);

/** Elements of an int8[] or date[] are plain tokens (digits, dates or NULL), so a split is enough: nothing is quoted or contains a comma. */
export function parseSimpleArray<T>(v: string, element: (s: string) => T): (T | null)[] {
  const inner = v.replace(/^\{/, "").replace(/\}$/, "");
  if (inner === "") return [];
  return inner.split(",").map((s) => (s === "NULL" ? null : element(s)));
}

export const typeParsers = {
  getTypeParser(oid: number, format?: "text" | "binary"): (v: string) => unknown {
    if (oid === OID.int8) return parseBigint;
    if (oid === OID.int8Array) return (v: string) => parseSimpleArray(v, parseBigint);
    if (oid === OID.date) return parseDate;
    if (oid === OID.dateArray) return (v: string) => parseSimpleArray(v, parseDate);
    return pg.types.getTypeParser(oid, format as "text") as (v: string) => unknown;
  },
};

/** What node-postgres cannot send: a bigint becomes its digits, a Date its ISO instant, inside arrays too. */
export function prepareParam(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(prepareParam);
  return v;
}

function wrap(client: pg.Pool | pg.PoolClient): Queryable {
  return {
    async query(sql, params) {
      const r = await client.query(sql, params === undefined ? undefined : params.map(prepareParam));
      return { rows: r.rows };
    },
    // No parameters, so node-postgres uses the simple protocol, which allows several statements (migrations).
    async exec(sql) {
      await client.query(sql);
    },
  };
}

export interface PostgresOptions {
  /** The most connections this process keeps. Small by default: each serverless instance has its own pool. */
  max?: number;
}

export function createPostgresDb(connectionString: string, options: PostgresOptions = {}): Db {
  const max = options.max ?? (Number(process.env.DATABASE_POOL_MAX) || 3);
  // Verified TLS for every host that is not this machine, whatever the string says: a library upgrade cannot weaken it.
  const pool = new pg.Pool({ connectionString: withVerifiedTls(connectionString), max, types: typeParsers, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 10_000 });
  // An idle client that errors (the pooler closing it) must not crash the process.
  pool.on("error", (e) => console.error("database pool error:", redact(e.message)));
  const base = wrap(pool);
  return {
    ...base,
    async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      // Releasing with an error discards the connection instead of returning it to the pool, which is right when rollback itself fails.
      let broken: Error | undefined;
      try {
        await client.query("begin");
        const result = await fn(wrap(client));
        await client.query("commit");
        return result;
      } catch (e) {
        try {
          await client.query("rollback");
        } catch {
          broken = e instanceof Error ? e : new Error("transaction failed");
        }
        throw e;
      } finally {
        client.release(broken);
      }
    },
    async close() {
      await pool.end();
    },
  };
}
