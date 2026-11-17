import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "../src/server/db";
import { openDatabase } from "../src/server/db";
import { SIGNUP_CLOSED_MESSAGE } from "../src/server/config";

// The action reads cookies and redirects, which only exist inside a request; stand in for them.
let db: Db;
const cookieSet = vi.fn();
class Redirected extends Error {}
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Redirected(`redirect ${to}`), { to });
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("../src/server/session", () => ({
  setSessionCookie: (token: string) => cookieSet(token),
  clearSessionCookie: async () => undefined,
  getSession: async () => {
    throw new Error("not used");
  },
}));
vi.mock("../src/server/db", async (original) => {
  const real = await original<typeof import("../src/server/db")>();
  return { ...real, getDb: async () => db };
});

const form = (email: string) => {
  const f = new FormData();
  f.set("firmName", "Gamma Audit");
  f.set("name", "Gina Admin");
  f.set("email", email);
  f.set("password", "invented-gamma-passphrase");
  f.set("confirm", "invented-gamma-passphrase");
  return f;
};

beforeAll(async () => {
  db = await openDatabase();
}, 60000);
afterEach(() => vi.unstubAllEnvs());

describe("signUpAction and the SIGNUP_OPEN switch", () => {
  it("refuses with the invitation sentence when hosted (closed by default)", async () => {
    vi.stubEnv("VERCEL", "1");
    const { signUpAction } = await import("../src/app/auth-actions");
    const result = await signUpAction({ ok: true, message: "" }, form("closed@gamma.test"));
    expect(result).toEqual({ ok: false, message: SIGNUP_CLOSED_MESSAGE });
    expect((await db.query("select 1 from users where email = 'closed@gamma.test'")).rows).toHaveLength(0);
  });

  it("works locally, where sign-up is open by default", async () => {
    const { signUpAction } = await import("../src/app/auth-actions");
    await expect(signUpAction({ ok: true, message: "" }, form("open@gamma.test"))).rejects.toBeInstanceOf(Redirected);
    expect((await db.query("select 1 from users where email = 'open@gamma.test'")).rows).toHaveLength(1);
    expect(cookieSet).toHaveBeenCalledOnce();
  });

  it("works when hosted and opened with SIGNUP_OPEN=1", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("SIGNUP_OPEN", "1");
    const { signUpAction } = await import("../src/app/auth-actions");
    await expect(signUpAction({ ok: true, message: "" }, form("hostedopen@gamma.test"))).rejects.toBeInstanceOf(Redirected);
    expect((await db.query("select 1 from users where email = 'hostedopen@gamma.test'")).rows).toHaveLength(1);
  });

  it("refuses locally when switched off", async () => {
    vi.stubEnv("SIGNUP_OPEN", "0");
    const { signUpAction } = await import("../src/app/auth-actions");
    expect(await signUpAction({ ok: true, message: "" }, form("off@gamma.test"))).toEqual({ ok: false, message: SIGNUP_CLOSED_MESSAGE });
  });
});
