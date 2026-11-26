/**
 * A read-only check of a deployed site, run by hand after a deploy: `npm run smoke:hosted` with SMOKE_BASE_URL, SMOKE_EMAIL and
 * SMOKE_PASSWORD set. It signs in as the sign-in form does, opens the pages in PAGES with GET requests, and signs out. Signing in and
 * signing out are the only requests that change anything (the session, and the sign-in line in the audit log). It is not part of CI.
 *
 * The repository is public and the output may be pasted anywhere, so nothing printed here comes from the site or the environment: only
 * the page names below, a status number, and fixed wording. Errors are never printed, because they can carry the address.
 */
import { pathToFileURL } from "node:url";

export type SmokePage = {
  name: string;
  /** The address of the page. For an engagement page it is what follows /engagements/{id}. */
  path: string;
  engagement?: boolean;
  /** The heading that shows the page was drawn. */
  heading: { level: 1 | 2; text: string };
  /** The page is only checked when the home page links here, that is when the signed-in role is offered it. */
  offeredBy?: string;
};

/** Every page that is checked, in order. */
export const PAGES: SmokePage[] = [
  { name: "Home", path: "/", heading: { level: 1, text: "Engagements" } },
  { name: "My work", path: "/my-work", heading: { level: 1, text: "My work" } },
  { name: "Clients", path: "/clients", heading: { level: 1, text: "Clients" } },
  // The overview's main heading is the client's name, so a section heading that is always there is looked for instead.
  { name: "Engagement overview", path: "", engagement: true, heading: { level: 2, text: "Where things stand" } },
  { name: "Trial balance", path: "/trial-balance", engagement: true, heading: { level: 1, text: "Trial balance and mapping" } },
  { name: "Lead sheets", path: "/lead-sheets", engagement: true, heading: { level: 1, text: "Lead sheets" } },
  { name: "Statements", path: "/statements", engagement: true, heading: { level: 1, text: "Financial statements" } },
  { name: "Audit", path: "/audit", engagement: true, heading: { level: 1, text: "Audit planning" } },
  { name: "Review", path: "/review", engagement: true, heading: { level: 1, text: "Review and sign-off" } },
  { name: "Index", path: "/index", engagement: true, heading: { level: 1, text: "Working paper index" } },
  { name: "Firm", path: "/firm", offeredBy: "/firm", heading: { level: 1, text: "Firm" } },
  { name: "Audit log", path: "/firm/audit-log", offeredBy: "/firm/audit-log", heading: { level: 1, text: "Audit log" } },
  // Retention is for the same roles as the audit log.
  { name: "Retention", path: "/firm/retention", offeredBy: "/firm/audit-log", heading: { level: 1, text: "Retention" } },
  { name: "Account", path: "/account", heading: { level: 1, text: "Account" } },
];

const SESSION_COOKIE = "lf_session";
const TIMEOUT_MS = 60_000;
const ENGAGEMENT_LINK = /href="\/engagements\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})["/?#]/i;

const unescapeHtml = (s: string) => s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

const headings = (html: string, level: 1 | 2) =>
  [...html.matchAll(new RegExp(`<h${level}\\b[^>]*>([\\s\\S]*?)</h${level}>`, "g"))].map((m) => unescapeHtml(m[1].replace(/<!--[\s\S]*?-->|<[^>]+>/g, "")).trim());

const forms = (html: string) => [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map((m) => m[0]);

/** The hidden fields Next.js puts in a form so that it works without scripts. Posting them back is how a Server Action is called. */
function hiddenFields(form: string): FormData {
  const data = new FormData();
  for (const [tag] of form.matchAll(/<input\b[^>]*>/g)) {
    if (!/\btype="hidden"/.test(tag)) continue;
    const name = /\bname="([^"]*)"/.exec(tag)?.[1];
    if (name) data.append(unescapeHtml(name), unescapeHtml(/\bvalue="([^"]*)"/.exec(tag)?.[1] ?? ""));
  }
  return data;
}

/** The site's origin, or the fixed reason the address is refused. */
function checkAddress(value: string): { origin: string } | { refused: string } {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { refused: "SMOKE_BASE_URL is not a valid address" };
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return { refused: "SMOKE_BASE_URL must be https (http is accepted for localhost only)" };
  return { origin: url.origin };
}

type Answer = { status: number; html: string; location: string | null };

/** The cookie is kept here, in memory, and sent to the one origin only: redirects are never followed. */
function client(origin: string, doFetch: typeof fetch) {
  const jar = new Map<string, string>();
  async function request(path: string, body?: FormData): Promise<Answer | { error: string }> {
    const headers: Record<string, string> = {};
    if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    // A Server Action is only accepted from the site's own origin.
    if (body) headers.origin = origin;
    try {
      const res = await doFetch(origin + path, { method: body ? "POST" : "GET", body, headers, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
      for (const line of res.headers.getSetCookie()) {
        const pair = line.split(";")[0];
        const at = pair.indexOf("=");
        if (at < 1) continue;
        const name = pair.slice(0, at);
        const value = pair.slice(at + 1);
        if (value) jar.set(name, value);
        else jar.delete(name);
      }
      return { status: res.status, html: await res.text(), location: res.headers.get("location") };
    } catch (e) {
      return { error: e instanceof Error && e.name === "TimeoutError" ? "timed out" : "no answer" };
    }
  }
  return { request, signedIn: () => jar.has(SESSION_COOKIE) };
}

type Env = Record<string, string | undefined>;

/** Run the checks. Prints one line each and a summary, and returns the exit code. */
export async function run(env: Env, print: (line: string) => void, doFetch: typeof fetch = fetch): Promise<number> {
  const base = env.SMOKE_BASE_URL;
  const email = env.SMOKE_EMAIL;
  const password = env.SMOKE_PASSWORD;
  if (!base || !email || !password) {
    print("Set SMOKE_BASE_URL, SMOKE_EMAIL and SMOKE_PASSWORD");
    return 1;
  }
  const address = checkAddress(base);
  if ("refused" in address) {
    print(address.refused);
    return 1;
  }

  let passed = 0;
  let failed = 0;
  let skipped = 0;
  const pass = (name: string) => {
    passed++;
    print(`PASS ${name}`);
  };
  const fail = (name: string, reason: string) => {
    failed++;
    print(`FAIL ${name} (${reason})`);
  };
  const skip = (name: string, reason: string) => {
    skipped++;
    print(`SKIP ${name} (${reason})`);
  };
  const done = () => {
    print(`${passed} passed, ${failed} failed, ${skipped} skipped`);
    return failed ? 1 : 0;
  };
  const stopAtSignIn = (reason: string) => {
    fail("Sign in", reason);
    return done();
  };

  const site = client(address.origin, doFetch);

  // Sign in the way the form does when scripts are off: its hidden fields and what was typed, posted to the same page.
  const signInPage = await site.request("/sign-in");
  if ("error" in signInPage) return stopAtSignIn(signInPage.error);
  if (signInPage.status !== 200) return stopAtSignIn(`status ${signInPage.status}`);
  const signInForm = forms(signInPage.html).find((f) => /\btype="password"/.test(f));
  if (!signInForm) return stopAtSignIn("form not found");
  const typed = hiddenFields(signInForm);
  typed.append("email", email);
  typed.append("password", password);
  const answer = await site.request("/sign-in", typed);
  if ("error" in answer) return stopAtSignIn(answer.error);
  if (!site.signedIn()) return stopAtSignIn(`not accepted, status ${answer.status}`);
  pass("Sign in");

  let home = "";
  let engagement: string | null = null;
  try {
    for (const page of PAGES) {
      if (page.offeredBy && !home) {
        skip(page.name, "the home page did not load");
        continue;
      }
      if (page.offeredBy && !home.includes(`href="${page.offeredBy}"`)) {
        skip(page.name, "not offered to this sign-in");
        continue;
      }
      if (page.engagement && !engagement) {
        fail(page.name, "no engagement found on the home page");
        continue;
      }
      const res = await site.request(page.engagement ? `/engagements/${engagement}${page.path}` : page.path);
      if ("error" in res) fail(page.name, res.error);
      else if (res.status !== 200) fail(page.name, `status ${res.status}`);
      else if (!headings(res.html, page.heading.level).includes(page.heading.text)) fail(page.name, "heading not found");
      else {
        pass(page.name);
        if (page.path === "/" && !page.engagement) {
          home = res.html;
          engagement = ENGAGEMENT_LINK.exec(res.html)?.[1] ?? null;
        }
      }
    }
  } finally {
    await signOut(site, home, pass, fail);
  }
  return done();
}

/** One sign-out request: the form in the header's menu, and nothing else. If it cannot be told apart for certain, nothing is posted. */
async function signOut(site: ReturnType<typeof client>, home: string, pass: (name: string) => void, fail: (name: string, reason: string) => void): Promise<void> {
  let html = home;
  if (!html) {
    const res = await site.request("/");
    if (!("error" in res) && res.status === 200) html = res.html;
  }
  const found = forms(html).filter((f) => />\s*Sign out\s*</.test(f));
  if (found.length !== 1) return fail("Sign out", "form not found; the session ends by itself when it expires");
  const res = await site.request("/", hiddenFields(found[0]));
  if ("error" in res) return fail("Sign out", res.error);
  if (site.signedIn()) return fail("Sign out", `not accepted, status ${res.status}`);
  pass("Sign out");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.env, (line) => console.log(line)).then(
    (code) => (process.exitCode = code),
    () => {
      // Nothing of the error is printed: it can hold the address.
      console.log("FAIL (the check itself stopped)");
      process.exitCode = 1;
    },
  );
}
