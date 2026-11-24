import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/server/db";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import { importClients } from "../src/server/client-import";
import { CLIENT_REFUSAL } from "../src/domain/permissions";

const FIRM = "aaaaaaaa-3636-4000-8000-000000000001";
const OTHER = "bbbbbbbb-3636-4000-8000-000000000001";
const user = (n: number, role: repo.Session["role"], firmId = FIRM): repo.Session => ({ firmId, userId: `${firmId.slice(0, 8)}-3636-4000-8000-00000000001${n}`, role });
const partner = user(1, "partner");
const preparer = user(2, "preparer");
const otherPartner = user(3, "partner", OTHER);

let db: Db;
type T = Parameters<Parameters<typeof withFirm>[2]>[0];
const as = <R,>(s: repo.Session, fn: (tx: T) => Promise<R>) => withFirm(db, s.firmId, fn);
const names = async (firm: string) => (await db.query<{ name: string }>("select name from clients where firm_id = $1 order by name", [firm])).rows.map((r) => r.name);

beforeAll(async () => {
  db = await openDatabase();
  for (const firm of [FIRM, OTHER]) await db.query("insert into firms (id, name) values ($1, 'Firm')", [firm]);
  for (const u of [partner, preparer, otherPartner]) {
    await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, u.firmId, `${u.userId}@x.test`, `${u.role} ${u.userId.slice(-1)}`, u.role]);
  }
});

afterAll(async () => {
  await db.close();
});

describe("adding a client with the form's rule", () => {
  it("stores the cleaned name: trimmed, with inner spaces collapsed", async () => {
    await as(partner, (tx) => repo.createClient(tx, partner, "  Falcon   Trading \t LLC  "));
    expect(await names(FIRM)).toEqual(["Falcon Trading LLC"]);
  });

  it("refuses the same name in a different case or with extra spaces, and says which client it is", async () => {
    for (const again of ["Falcon Trading LLC", "FALCON TRADING LLC", "falcon trading llc", "  Falcon    Trading   LLC ", "Falcon\tTrading LLC"]) {
      await expect(as(partner, (tx) => repo.createClient(tx, partner, again)), again).rejects.toThrow("Falcon Trading LLC is already a client.");
    }
    expect(await names(FIRM)).toEqual(["Falcon Trading LLC"]);
  });

  it("does not refuse a different name, even a similar one", async () => {
    await as(partner, (tx) => repo.createClient(tx, partner, "Falcon Trading"));
    expect(await names(FIRM)).toEqual(["Falcon Trading", "Falcon Trading LLC"]);
  });

  it("is not blocked by another firm's client of the same name, and does not see it", async () => {
    await as(otherPartner, (tx) => repo.createClient(tx, otherPartner, "Al Noor Contracting"));
    await as(partner, (tx) => repo.createClient(tx, partner, "al noor  contracting"));
    expect(await names(FIRM)).toContain("al noor contracting");
    expect(await names(OTHER)).toEqual(["Al Noor Contracting"]);
    await expect(as(otherPartner, (tx) => repo.createClient(tx, otherPartner, "AL NOOR CONTRACTING"))).rejects.toThrow("Al Noor Contracting is already a client.");
  });

  it("still refuses someone who may not add a client, before it looks at the names", async () => {
    await expect(as(preparer, (tx) => repo.createClient(tx, preparer, "Falcon Trading LLC"))).rejects.toThrow(CLIENT_REFUSAL);
  });

  it("logs the cleaned name", async () => {
    const { rows } = await db.query<{ detail: { name: string } }>("select detail from audit_log where firm_id = $1 and action = 'create' and entity = 'client' order by id", [FIRM]);
    expect(rows[0].detail.name).toBe("Falcon Trading LLC");
  });
});

describe("the form and the import share one rule and one lock", () => {
  it("an import, then a form add of the same name, is refused", async () => {
    const result = await as(partner, (tx) => importClients(tx, partner, ["Delta Works", "  Omega   Ltd "]));
    expect(result.added).toBe(2);
    await expect(as(partner, (tx) => repo.createClient(tx, partner, "delta WORKS"))).rejects.toThrow("Delta Works is already a client.");
    await expect(as(partner, (tx) => repo.createClient(tx, partner, "Omega Ltd"))).rejects.toThrow("Omega Ltd is already a client.");
  });

  it("a form add, then an import of the same name, reports it as already a client and adds nothing", async () => {
    await as(partner, (tx) => repo.createClient(tx, partner, "Gamma Holdings"));
    const result = await as(partner, (tx) => importClients(tx, partner, ["GAMMA  holdings", "Sigma Co"]));
    expect(result.counts).toMatchObject({ add: 1, existing: 1 });
    expect((await names(FIRM)).filter((n) => n.toLowerCase().startsWith("gamma"))).toEqual(["Gamma Holdings"]);
  });

  it("takes the one per-firm lock, named neutrally, and releases it at commit", async () => {
    await as(partner, (tx) => repo.lockClients(tx, FIRM));
    await as(partner, async (tx) => {
      await tx.query("select pg_advisory_xact_lock(hashtext($1))", [`clients:${FIRM}`]);
    });
  });

  it("a form add and an import of the same name at the same time leave one copy", async () => {
    const both = await Promise.allSettled([as(partner, (tx) => repo.createClient(tx, partner, "Zenith Group")), as(partner, (tx) => importClients(tx, partner, ["zenith  group"]))]);
    expect(both.filter((r) => r.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
    for (const r of both) if (r.status === "rejected") expect(String(r.reason)).toMatch(/is already a client/);
    expect((await names(FIRM)).filter((n) => n.toLowerCase().replace(/\s+/g, " ") === "zenith group")).toHaveLength(1);
  });

  it("two form adds of the same name at the same time leave one copy", async () => {
    const both = await Promise.allSettled([as(partner, (tx) => repo.createClient(tx, partner, "Apex Ltd")), as(partner, (tx) => repo.createClient(tx, partner, "APEX  LTD"))]);
    expect(both.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect((await names(FIRM)).filter((n) => n.toLowerCase() === "apex ltd")).toHaveLength(1);
  });
});
