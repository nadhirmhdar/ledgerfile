import { MIN_PASSWORD_LENGTH } from "./auth";
import { PUBLIC_DEMO_PASSWORD } from "./config";

/** The invented people of the sample firm. Emails are fixed and invented (@ledgerfile.test); passwords come from the owner's environment. */
export const SAMPLE_USERS = [
  { id: "00000000-0000-4000-8000-000000000002", email: "demo@ledgerfile.test", name: "Demo Admin", role: "admin", env: "SAMPLE_ADMIN_PASSWORD" },
  { id: "00000000-0000-4000-8000-000000000003", email: "partner@ledgerfile.test", name: "Test Partner", role: "partner", env: "SAMPLE_PARTNER_PASSWORD" },
  { id: "00000000-0000-4000-8000-000000000004", email: "reviewer@ledgerfile.test", name: "Test Reviewer", role: "reviewer", env: "SAMPLE_REVIEWER_PASSWORD" },
  { id: "00000000-0000-4000-8000-000000000005", email: "preparer@ledgerfile.test", name: "Test Preparer", role: "preparer", env: "SAMPLE_PREPARER_PASSWORD" },
] as const;

type Env = Record<string, string | undefined>;

/**
 * Why the hosted sample seed must not run, as plain sentences that name the variable and never its value. Empty when every
 * password is present, long enough, not the public demo default, and different from the others.
 */
export function samplePasswordProblems(env: Env = process.env): string[] {
  const problems: string[] = [];
  const seen = new Map<string, string>();
  for (const u of SAMPLE_USERS) {
    const v = env[u.env];
    if (v === undefined || v === "") problems.push(`${u.env} is not set.`);
    else if (v.length < MIN_PASSWORD_LENGTH) problems.push(`${u.env} is shorter than ${MIN_PASSWORD_LENGTH} characters.`);
    else if (v === PUBLIC_DEMO_PASSWORD) problems.push(`${u.env} is the public demo password.`);
    else if (seen.has(v)) problems.push(`${u.env} is the same as ${seen.get(v)}.`);
    else seen.set(v, u.env);
  }
  return problems;
}
