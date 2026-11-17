/**
 * Deployment rules that decide how safe the app is to expose. Pure: every function takes the environment, so the rules are tested
 * without touching process state. Nothing here reads or prints a secret.
 */
type Env = Record<string, string | undefined>;

const set = (v: string | undefined): boolean => !!v && v.trim() !== "";

/**
 * "Hosted" is true when ANY of these is set: DATABASE_URL, LEDGERFILE_HOSTED=1, or VERCEL (which Vercel sets on every deployment).
 * Hosted means a shared database, so the local conveniences (the PGlite folder, open sign-up, demo users) must never apply.
 */
export const isHosted = (env: Env = process.env): boolean => set(env.DATABASE_URL) || env.LEDGERFILE_HOSTED === "1" || set(env.VERCEL);

export class HostedConfigError extends Error {}

/** The login role the hosted app connects as. It owns nothing; the database owner's role must never be the runtime connection. */
export const APP_ROLE = "ledgerfile_app";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
/** A host on this machine only: the one case where a database connection may go without TLS (the CI service container). */
export const isLoopbackHost = (host: string): boolean => LOOPBACK.has(host.toLowerCase()) || host.toLowerCase().endsWith(".localhost");

/**
 * The sslmode for a URL built from parts: certificate-verified TLS for any real host, none only for a loopback host. There is no
 * flag that turns TLS off for a non-loopback host, so a real hosted URL cannot be downgraded by an environment variable.
 */
export const sslModeForHost = (host: string): "verify-full" | "disable" => (isLoopbackHost(host) ? "disable" : "verify-full");

function parseUrl(value: string, what: string): URL {
  try {
    return new URL(value);
  } catch {
    // Never echo the value: it is a connection string.
    throw new HostedConfigError(`${what} is not a valid connection string.`);
  }
}

/** A URL a human gave us must use verified TLS unless it points at this machine. */
export function assertSecureUrl(value: string, what: string): void {
  const u = parseUrl(value, what);
  if (isLoopbackHost(u.hostname)) return;
  const mode = u.searchParams.get("sslmode");
  if (mode !== "require" && mode !== "verify-ca" && mode !== "verify-full") {
    throw new HostedConfigError(`${what} must include sslmode=require (or stricter) for a database that is not on this machine.`);
  }
}

const userOf = (value: string | undefined): string | null => {
  if (!set(value)) return null;
  try {
    return decodeURIComponent(new URL(value!.trim()).username) || null;
  } catch {
    return null;
  }
};

/**
 * The database users that hold owner-level rights, as far as the environment shows: the Neon integration's PGUSER, and the user in
 * the direct and migration connection strings. The runtime must never connect as any of them.
 */
export function ownerUsers(env: Env = process.env): Set<string> {
  const out = new Set<string>();
  for (const u of [env.PGUSER?.trim(), userOf(env.DATABASE_URL_UNPOOLED), userOf(env.DATABASE_URL_MIGRATIONS), userOf(env.POSTGRES_URL_NON_POOLING)]) if (u) out.add(u);
  return out;
}

/**
 * The runtime connection string, or null when the app should use the local PGlite folder. By precedence:
 *
 *   1. LEDGERFILE_DATABASE_URL: an explicit runtime URL (any host, for example Supabase's transaction pooler, as ledgerfile_app).
 *   2. The Neon integration's parts: PGHOST (the POOLED host) and PGDATABASE, with ledgerfile_app and LEDGERFILE_APP_PASSWORD, built
 *      here with verified TLS. The integration's own DATABASE_URL and PGUSER/PGPASSWORD hold the OWNER's credentials and are NOT used.
 *   3. DATABASE_URL set by hand (the Supabase setup): used as given.
 *
 * It fails closed. Hosted with none of these, or with Neon's parts but no LEDGERFILE_APP_PASSWORD, refuses to start rather than fall
 * back to PGlite or to the owner's URL. A URL whose user is a known owner user is refused, so the injected DATABASE_URL can never
 * be the runtime connection by accident.
 */
export function databaseUrl(env: Env = process.env): string | null {
  const owners = ownerUsers(env);
  const checked = (url: string, what: string): string => {
    assertSecureUrl(url, what);
    const user = userOf(url);
    if (user && owners.has(user)) throw new HostedConfigError(`${what} connects as the database owner. The app must connect as ${APP_ROLE}.`);
    return url;
  };
  if (set(env.LEDGERFILE_DATABASE_URL)) return checked(env.LEDGERFILE_DATABASE_URL!.trim(), "LEDGERFILE_DATABASE_URL");
  if (set(env.PGHOST) && set(env.PGDATABASE)) {
    if (!set(env.LEDGERFILE_APP_PASSWORD)) {
      throw new HostedConfigError(`The database is Neon's, whose injected DATABASE_URL is the owner's. Set LEDGERFILE_APP_PASSWORD so the app connects as ${APP_ROLE} (run \`npm run db:setup-hosted\` once to create it).`);
    }
    const host = env.PGHOST!.trim();
    const port = set(env.PGPORT) ? `:${env.PGPORT!.trim()}` : "";
    const url = `postgres://${APP_ROLE}:${encodeURIComponent(env.LEDGERFILE_APP_PASSWORD!)}@${host}${port}/${encodeURIComponent(env.PGDATABASE!.trim())}?sslmode=${sslModeForHost(host)}`;
    return checked(url, "The runtime connection");
  }
  if (set(env.DATABASE_URL)) return checked(env.DATABASE_URL!.trim(), "DATABASE_URL");
  if (isHosted(env)) throw new HostedConfigError("This deployment is hosted but no runtime database connection is set. Refusing to start on the local development database.");
  return null;
}

/** The connection for migrations and setup: the DIRECT owner connection. */
export function migrationUrl(env: Env = process.env): string | null {
  for (const v of [env.DATABASE_URL_MIGRATIONS, env.DATABASE_URL_UNPOOLED, env.POSTGRES_URL_NON_POOLING, env.DATABASE_URL]) if (set(v)) return v!.trim();
  return null;
}

/**
 * Why LEDGERFILE_APP_PASSWORD must not be used, as sentences that never contain it. Empty when it is fine: at least 24 characters, and
 * neither a sample password nor the public demo password.
 */
export function appPasswordProblems(env: Env = process.env): string[] {
  const v = env.LEDGERFILE_APP_PASSWORD;
  if (!v) return ["LEDGERFILE_APP_PASSWORD is not set."];
  const problems: string[] = [];
  if (v.length < 24) problems.push("LEDGERFILE_APP_PASSWORD is shorter than 24 characters.");
  else if (passwordEntropyBits(v) < 60) problems.push("LEDGERFILE_APP_PASSWORD is too predictable (Neon needs at least 60 bits of entropy): use a long random string.");
  // Neon's rule for a role password set through SQL (https://neon.com/docs/manage/roles, https://neon.com/docs/manage/database-access): at
  // least 12 characters with lowercase, uppercase, a number and a symbol, and no character more than twice in a row. It does not publish its
  // estimator, so the safe shape is stated here and the password is refused up front rather than by Neon in the middle of a build.
  const missing = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((r) => !r.test(v)).length;
  if (missing > 0) problems.push("LEDGERFILE_APP_PASSWORD needs a lowercase letter, an uppercase letter, a number and a symbol (Neon refuses a role password without all four).");
  if (/(.)\1\1/.test(v)) problems.push("LEDGERFILE_APP_PASSWORD repeats a character three times in a row (Neon refuses that).");
  if (v === PUBLIC_DEMO_PASSWORD) problems.push("LEDGERFILE_APP_PASSWORD is the public demo password.");
  for (const k of ["SAMPLE_ADMIN_PASSWORD", "SAMPLE_PARTNER_PASSWORD", "SAMPLE_REVIEWER_PASSWORD", "SAMPLE_PREPARER_PASSWORD"]) {
    if (env[k] && env[k] === v) problems.push(`LEDGERFILE_APP_PASSWORD is the same as ${k}.`);
  }
  return problems;
}

/** Whether new firms may register. Open locally by default, closed by default when hosted; SIGNUP_OPEN=1 or 0 overrides either way. */
export function signupOpen(env: Env = process.env): boolean {
  const v = env.SIGNUP_OPEN?.trim().toLowerCase();
  if (v === undefined || v === "") return !isHosted(env);
  return v === "1" || v === "true" || v === "yes" || v === "on";
}
export const SIGNUP_CLOSED_MESSAGE = "New firm accounts are by invitation. Ask your administrator.";

/** The published demo password. It is public, so a hosted site must never accept it. */
export const PUBLIC_DEMO_PASSWORD = "ledgerfile-demo-only";

/**
 * The largest file an upload may carry, in bytes. One value for every upload entry point, read by the browser check and the server
 * check alike. Locally 10 MB. Hosted on Vercel a function request body is capped at about 4.5 MB, so uploads are held to 4 MB
 * (leaving room for the form overhead) until uploads go straight to storage.
 */
export const LOCAL_UPLOAD_BYTES = 10 * 1024 * 1024;
export const HOSTED_UPLOAD_BYTES = 4 * 1024 * 1024;
export const maxUploadBytes = (env: Env = process.env): number => (isHosted(env) ? HOSTED_UPLOAD_BYTES : LOCAL_UPLOAD_BYTES);
/** "10 MB" or "4 MB". */
export const uploadLimitLabel = (env: Env = process.env): string => `${Math.round(maxUploadBytes(env) / 1024 / 1024)} MB`;
export const uploadTooLargeMessage = (env: Env = process.env): string => `The file is larger than ${uploadLimitLabel(env)}.`;

/**
 * A working paper sent straight from the browser to the private Blob store never passes through a function, so the function's
 * request-body limit does not apply to it. One constant for the server's checks, the token it issues and the size the form shows.
 * Spreadsheet imports are read on the server and keep the smaller limit above.
 */
export const DIRECT_UPLOAD_BYTES = 50 * 1024 * 1024;
export const DIRECT_UPLOAD_LABEL = `${DIRECT_UPLOAD_BYTES / 1024 / 1024} MB`;
/** How long the browser has to send a file after the server has said it may. */
export const PENDING_UPLOAD_MINUTES = 15;

/** Replace anything that looks like a connection string, and any configured secret value, so an error can be logged safely. */
export function redact(text: string, env: Env = process.env): string {
  let out = text.replace(/\bpostgres(?:ql)?:\/\/[^\s'"]*/gi, "postgres://[redacted]");
  for (const key of ["DATABASE_URL", "DATABASE_URL_UNPOOLED", "DATABASE_URL_MIGRATIONS", "LEDGERFILE_DATABASE_URL", "PGPASSWORD", "SUPABASE_SERVICE_ROLE_KEY", "BLOB_READ_WRITE_TOKEN", "TEST_DATABASE_URL"]) {
    const v = env[key]?.trim();
    if (v && v.length >= 6) out = out.split(v).join("[redacted]");
  }
  // Passwords are removed as typed AND in the forms they take inside SQL text and URLs: a quote-doubled literal, one with backslashes
  // doubled too (what node-postgres escapeLiteral writes), and the URL-encoded form.
  for (const key of ["LEDGERFILE_APP_PASSWORD", "SAMPLE_ADMIN_PASSWORD", "SAMPLE_PARTNER_PASSWORD", "SAMPLE_REVIEWER_PASSWORD", "SAMPLE_PREPARER_PASSWORD"]) {
    const v = env[key];
    if (!v || v.length < 6) continue;
    const forms = [v, v.replace(/'/g, "''"), v.replace(/\\/g, "\\\\").replace(/'/g, "''"), encodeURIComponent(v)];
    // Longest first, so a form that contains another is removed whole.
    for (const f of [...new Set(forms)].sort((a, b) => b.length - a.length)) out = out.split(f).join("[redacted]");
  }
  return out;
}

/** Neon rejects a password set through SQL below 60 bits of entropy. A conservative estimate: length times the size of the character pool, and a floor on distinct characters. */
export function passwordEntropyBits(password: string): number {
  const pool = (/[a-z]/.test(password) ? 26 : 0) + (/[A-Z]/.test(password) ? 26 : 0) + (/[0-9]/.test(password) ? 10 : 0) + (/[^a-zA-Z0-9]/.test(password) ? 33 : 0);
  if (pool === 0 || new Set(password).size < 8) return 0;
  return password.length * Math.log2(pool);
}

/** Never weakens a URL: for any host that is not on this machine, sslmode becomes verify-full (require, verify-ca, disable, or none included). */
export function withVerifiedTls(connectionString: string): string {
  let u: URL;
  try {
    u = new URL(connectionString);
  } catch {
    return connectionString;
  }
  if (isLoopbackHost(u.hostname)) return connectionString;
  u.searchParams.set("sslmode", "verify-full");
  return u.toString();
}

/**
 * Refuses to run a development server (next dev) against a database that is not on this machine. A pulled Vercel environment, or a
 * stray variable, could otherwise point a local dev server at the production database as ledgerfile_app, on hosted-mode settings and
 * real client data. LEDGERFILE_ALLOW_REMOTE_DEV=1 allows it knowingly. The message names no host, user or secret.
 */
export function assertDevSafe(env: Env = process.env): void {
  if (env.NODE_ENV !== "development" || env.LEDGERFILE_ALLOW_REMOTE_DEV === "1") return;
  const url = databaseUrl(env);
  if (url && !isLoopbackHost(parseUrl(url, "The runtime connection").hostname)) {
    throw new HostedConfigError("This development server would connect to a database that is not on this machine. Remove the hosted variables from your local environment, or set LEDGERFILE_ALLOW_REMOTE_DEV=1 if you mean it.");
  }
}
