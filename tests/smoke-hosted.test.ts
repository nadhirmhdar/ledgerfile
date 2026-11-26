/**
 * The after-deploy check, run against a small local server that answers like the app: the sign-in and sign-out forms with their hidden
 * fields, a session cookie, and pages that all hold an invented client's name and an engagement id, so that a leak would show.
 */
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PAGES, run } from "../scripts/smoke-hosted.mjs";

const EMAIL = "owner@invented.example";
const PASSWORD = "an-invented-password-123";
const COOKIE = "invented-session-token-abc123";
const CLIENT = "Invented Client Trading LLC";
const ENGAGEMENT = "0b9c1d2e-3f40-4a5b-8c6d-7e8f90a1b2c3";

type Options = { role?: "admin" | "partner" | "preparer"; broken?: Record<string, { status?: number; body?: string }>; noEngagement?: boolean; signOutForms?: number };
let options: Options = {};
let requests: { method: string; path: string; body: string }[] = [];
let server: Server;
let base = "";

const signOutForm = '<form action="" encType="multipart/form-data" method="POST"><input type="hidden" name="$ACTION_ID_00aa"/><button class="w-full">Sign out</button></form>';

function shell(main: string): string {
  const role = options.role ?? "admin";
  const links = [
    '<a href="/my-work">My work</a><a href="/clients">Clients</a>',
    role !== "preparer" ? '<a href="/firm/audit-log">Audit log</a>' : "",
    role === "admin" ? '<a href="/firm/methodology">Methodology</a><a href="/firm">Firm</a>' : "",
  ].join("");
  // The navigation repeats page names outside any heading, as the app's does.
  return `<html><body><nav>${links}<span>Engagements My work Clients Firm Audit log Retention Account Lead sheets</span></nav>${signOutForm.repeat(options.signOutForms ?? 1)}<main><p>${CLIENT}</p>${main}</main></body></html>`;
}

const ENGAGEMENT_PATH = `/engagements/${ENGAGEMENT}`;
const pathOf = (p: (typeof PAGES)[number]) => (p.engagement ? ENGAGEMENT_PATH + p.path : p.path);

function page(path: string): string | null {
  const found = PAGES.find((p) => pathOf(p) === path);
  if (!found) return null;
  const { level, text } = found.heading;
  const link = path === "/" && !options.noEngagement ? `<a href="/engagements/roll-forward">Roll forward</a><a href="${ENGAGEMENT_PATH}">${CLIENT}</a>` : "";
  return shell(`${level === 2 ? `<h1>${CLIENT}</h1>` : ""}<h${level} class="x">${text}</h${level}>${link}<p>${ENGAGEMENT}</p>`);
}

const read = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    const parts: Buffer[] = [];
    req.on("data", (c: Buffer) => parts.push(c));
    req.on("end", () => resolve(Buffer.concat(parts).toString("utf8")));
  });

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const path = req.url ?? "/";
    const body = await read(req);
    requests.push({ method: req.method ?? "", path, body });
    const signedIn = (req.headers.cookie ?? "").includes(`lf_session=${COOKIE}`);
    const send = (status: number, html: string, headers: Record<string, string> = {}) => res.writeHead(status, { "content-type": "text/html", ...headers }).end(html);
    if (req.method === "POST") {
      if (req.headers.origin !== base) return send(403, "wrong origin");
      if (path === "/sign-in") {
        const ok = ['name="$ACTION_REF_1"', 'name="$ACTION_1:0"', '{"id":"abc","bound":"$@1"}', EMAIL, PASSWORD].every((part) => body.includes(part));
        if (!ok) return send(200, `<p>The email address or password is incorrect. ${EMAIL}</p>`);
        return send(303, "", { location: "/", "set-cookie": `lf_session=${COOKIE}; Path=/; HttpOnly; SameSite=lax` });
      }
      if (path === "/" && signedIn && body.includes('name="$ACTION_ID_00aa"')) return send(303, "", { location: "/sign-in", "set-cookie": "lf_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT" });
      return send(500, "unexpected post");
    }
    if (path === "/sign-in") {
      return send(200, '<form action="" method="POST"><input type="hidden" name="$ACTION_REF_1"/><input type="hidden" name="$ACTION_1:0" value="{&quot;id&quot;:&quot;abc&quot;,&quot;bound&quot;:&quot;$@1&quot;}"/><input type="email" name="email"/><input type="password" name="password"/><button>Sign in</button></form>');
    }
    if (!signedIn) return send(307, "", { location: "/sign-in" });
    const broken = options.broken?.[path];
    if (broken) return send(broken.status ?? 200, broken.body ?? shell(`<h1>Something went wrong</h1><p>${CLIENT} ${ENGAGEMENT}</p>`));
    const html = page(path);
    return html ? send(200, html) : send(404, "not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => void server.close(() => resolve())));

let spies: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  options = {};
  requests = [];
  spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => {
  // Everything is printed through the one printer: nothing goes to the console directly.
  for (const s of spies) expect(s).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

async function smoke(env: Record<string, string | undefined> = {}, doFetch?: typeof fetch) {
  const lines: string[] = [];
  const code = await run({ SMOKE_BASE_URL: base, SMOKE_EMAIL: EMAIL, SMOKE_PASSWORD: PASSWORD, ...env }, (l) => lines.push(l), doFetch);
  const output = lines.join("\n");
  for (const secret of [base, "127.0.0.1", "http://", "https://", EMAIL, PASSWORD, COOKIE, CLIENT, "Invented", ENGAGEMENT, "/engagements", "Something went wrong", "incorrect"]) expect(output).not.toContain(secret);
  return { code, lines };
}

const posts = () => requests.filter((r) => r.method === "POST").map((r) => r.path);

describe("the after-deploy smoke test", () => {
  it("passes every page for an administrator, with GET requests only besides signing in and out", async () => {
    const { code, lines } = await smoke();
    expect(code).toBe(0);
    expect(lines).toEqual(["PASS Sign in", ...PAGES.map((p) => `PASS ${p.name}`), "PASS Sign out", `${PAGES.length + 2} passed, 0 failed, 0 skipped`]);
    expect(posts()).toEqual(["/sign-in", "/"]);
    expect(requests.filter((r) => r.method !== "POST").every((r) => r.method === "GET")).toBe(true);
    expect(requests.filter((r) => r.method === "GET").map((r) => r.path)).toEqual(["/sign-in", ...PAGES.map(pathOf)]);
    // The sign-out is the last request, and sends nothing but the form's hidden field.
    expect(requests.at(-1)).toMatchObject({ method: "POST", path: "/" });
    expect(requests.at(-1)!.body).toContain('name="$ACTION_ID_00aa"');
  });

  it("covers the pages of the brief", () => {
    expect(PAGES.map((p) => p.name)).toEqual(["Home", "My work", "Clients", "Engagement overview", "Trial balance", "Lead sheets", "Statements", "Audit", "Review", "Index", "Firm", "Audit log", "Retention", "Account"]);
  });

  it("reports a page that answers an error, goes on, signs out and exits non-zero", async () => {
    options = { broken: { [`${ENGAGEMENT_PATH}/statements`]: { status: 500 } } };
    const { code, lines } = await smoke();
    expect(code).toBe(1);
    expect(lines).toContain("FAIL Statements (status 500)");
    expect(lines).toContain("PASS Account");
    expect(lines).toContain("PASS Sign out");
    expect(lines.at(-1)).toBe(`${PAGES.length + 1} passed, 1 failed, 0 skipped`);
  });

  it("fails a page that answers 200 without its heading, and a page that redirects", async () => {
    options = { broken: { [`${ENGAGEMENT_PATH}/lead-sheets`]: {}, "/my-work": { status: 307 } } };
    const { code, lines } = await smoke();
    expect(code).toBe(1);
    expect(lines).toContain("FAIL Lead sheets (heading not found)");
    expect(lines).toContain("FAIL My work (status 307)");
  });

  it("still signs out when the home page fails, and does not guess which pages the role has", async () => {
    options = { broken: { "/": { status: 500 } } };
    const { code, lines } = await smoke();
    expect(code).toBe(1);
    expect(lines).toContain("FAIL Home (status 500)");
    expect(lines).toContain("SKIP Firm (the home page did not load)");
    expect(lines).toContain("FAIL Statements (no engagement found on the home page)");
    expect(lines).toContain("FAIL Sign out (form not found; the session ends by itself when it expires)");
    expect(posts()).toEqual(["/sign-in"]);
  });

  it("skips what the signed-in role is not offered", async () => {
    options = { role: "partner" };
    let result = await smoke();
    expect(result.code).toBe(0);
    expect(result.lines).toContain("SKIP Firm (not offered to this sign-in)");
    expect(result.lines).toContain("PASS Retention");

    options = { role: "preparer" };
    requests = [];
    result = await smoke();
    expect(result.code).toBe(0);
    for (const name of ["Firm", "Audit log", "Retention"]) expect(result.lines).toContain(`SKIP ${name} (not offered to this sign-in)`);
    expect(requests.some((r) => r.path.startsWith("/firm"))).toBe(false);
  });

  it("fails the engagement pages when the home page lists no engagement", async () => {
    options = { noEngagement: true };
    const { code, lines } = await smoke();
    expect(code).toBe(1);
    expect(lines.filter((l) => l.includes("no engagement found"))).toHaveLength(7);
    expect(requests.some((r) => r.path.startsWith("/engagements"))).toBe(false);
  });

  it("posts nothing for sign-out when the form cannot be told apart", async () => {
    options = { signOutForms: 2 };
    const { code, lines } = await smoke();
    expect(code).toBe(1);
    expect(lines).toContain("FAIL Sign out (form not found; the session ends by itself when it expires)");
    expect(posts()).toEqual(["/sign-in"]);
  });

  it("stops at a sign-in that is not accepted, without repeating what the page said", async () => {
    const { code, lines } = await smoke({ SMOKE_PASSWORD: "a-wrong-invented-password" });
    expect(code).toBe(1);
    expect(lines).toEqual(["FAIL Sign in (not accepted, status 200)", "0 passed, 1 failed, 0 skipped"]);
    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual(["GET /sign-in", "POST /sign-in"]);
  });

  it("says no answer for a server that is not there, without the error", async () => {
    const { code, lines } = await smoke({ SMOKE_BASE_URL: "http://127.0.0.1:1" });
    expect(code).toBe(1);
    expect(lines[0]).toBe("FAIL Sign in (no answer)");
  });

  it("stops when a variable is missing", async () => {
    for (const name of ["SMOKE_BASE_URL", "SMOKE_EMAIL", "SMOKE_PASSWORD"]) {
      const { code, lines } = await smoke({ [name]: undefined });
      expect(code).toBe(1);
      expect(lines).toEqual(["Set SMOKE_BASE_URL, SMOKE_EMAIL and SMOKE_PASSWORD"]);
    }
    expect(requests).toEqual([]);
  });

  it("refuses an address that is not https unless it is this computer, before any request", async () => {
    const never = vi.fn<typeof fetch>();
    for (const address of ["http://ledger.invented.example", "ftp://ledger.invented.example", "http://localhost.invented.example"]) {
      const { code, lines } = await smoke({ SMOKE_BASE_URL: address }, never);
      expect(code).toBe(1);
      expect(lines).toEqual(["SMOKE_BASE_URL must be https (http is accepted for localhost only)"]);
    }
    expect((await smoke({ SMOKE_BASE_URL: "not an address" }, never)).lines).toEqual(["SMOKE_BASE_URL is not a valid address"]);
    expect(never).not.toHaveBeenCalled();
  });

  it("looks for headings the app's pages really have", () => {
    const app = "src/app/(app)";
    const engagement = `${app}/engagements/[id]`;
    const source: Record<string, string> = {
      Home: "src/ui/create-panels.tsx",
      "My work": `${app}/my-work/page.tsx`,
      Clients: `${app}/clients/page.tsx`,
      "Engagement overview": `${engagement}/page.tsx`,
      "Trial balance": `${engagement}/trial-balance/page.tsx`,
      "Lead sheets": `${engagement}/lead-sheets/page.tsx`,
      Statements: `${engagement}/statements/page.tsx`,
      Audit: `${engagement}/audit/page.tsx`,
      Review: `${engagement}/review/page.tsx`,
      Index: `${engagement}/index/page.tsx`,
      Firm: `${app}/firm/page.tsx`,
      "Audit log": `${app}/firm/audit-log/page.tsx`,
      Retention: `${app}/firm/retention/page.tsx`,
      Account: `${app}/account/page.tsx`,
    };
    for (const p of PAGES) expect(readFileSync(source[p.name], "utf8"), p.name).toContain(`title="${p.heading.text}"`);
    const layout = readFileSync(`${app}/layout.tsx`, "utf8");
    for (const p of PAGES) if (p.offeredBy) expect(layout).toContain(`href="${p.offeredBy}"`);
  });
});
