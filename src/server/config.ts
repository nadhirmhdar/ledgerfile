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

/**
 * The Postgres connection string, or null when the app should use the local PGlite folder. A hosted deployment with no
 * DATABASE_URL fails closed: falling back to PGlite would mean an empty, open-signup database on a serverless host.
 */
export function databaseUrl(env: Env = process.env): string | null {
  if (set(env.DATABASE_URL)) return env.DATABASE_URL!.trim();
  if (isHosted(env)) throw new HostedConfigError("This deployment is hosted but DATABASE_URL is not set. Refusing to start on the local development database.");
  return null;
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

/** Replace anything that looks like a connection string, and any configured secret value, so an error can be logged safely. */
export function redact(text: string, env: Env = process.env): string {
  let out = text.replace(/\bpostgres(?:ql)?:\/\/[^\s'"]*/gi, "postgres://[redacted]");
  for (const key of ["DATABASE_URL", "DATABASE_URL_MIGRATIONS", "SUPABASE_SERVICE_ROLE_KEY", "TEST_DATABASE_URL"]) {
    const v = env[key]?.trim();
    if (v && v.length >= 6) out = out.split(v).join("[redacted]");
  }
  return out;
}
