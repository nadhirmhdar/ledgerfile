import type { Role } from "../domain/signoff";
import { count } from "./text";

/** How the team and account pages word roles and decide which controls show. Pure: it reads nothing and changes nothing. */

const LABEL: Record<Role, string> = { admin: "Admin", partner: "Partner", reviewer: "Reviewer", preparer: "Preparer" };

/**
 * One sentence on what a role may do. Each one follows the rules in domain/permissions.ts and domain/signoff.ts: everyone does the
 * day-to-day work; reviewing and opening an engagement need reviewer level; taking on a client and locking need partner level, which
 * the firm administrator counts as.
 */
const SUMMARY: Record<Role, string> = {
  preparer: "Does the day-to-day work and signs as preparer.",
  reviewer: "Reviews work and can open engagements.",
  partner: "Signs off, locks engagements and takes on clients.",
  admin: "Partner level, and manages the team.",
};

export const roleLabel = (role: string): string => (role in LABEL ? LABEL[role as Role] : role);
export const roleSummary = (role: string): string => (role in SUMMARY ? SUMMARY[role as Role] : "");

/** The four roles in the order the legend shows them: most senior first. */
export const ROLE_ORDER: Role[] = ["admin", "partner", "reviewer", "preparer"];

/** "5 people: 4 active, 1 deactivated." or "Just you so far." */
export function teamSentence(members: { active: boolean }[]): string {
  if (members.length <= 1) return "Just you so far.";
  const off = members.filter((m) => !m.active).length;
  if (off === 0) return `${count(members.length, "person", "people")}, all active.`;
  return `${count(members.length, "person", "people")}: ${members.length - off} active, ${off} deactivated.`;
}

export interface TeamControls {
  /** The Manage panel at all. */
  manage: boolean;
  roleForm: boolean;
  resetForm: boolean;
  /** Your own row: point to the Account page in place of a reset form. */
  useAccountPage: boolean;
  deactivate: boolean;
  reactivate: boolean;
}

/** What a row shows, for who is looking and whose row it is. Only an administrator sees any control; nobody deactivates or resets themselves here. */
export function teamControls(viewerRole: string, self: boolean, active: boolean): TeamControls {
  const admin = viewerRole === "admin";
  return {
    manage: admin,
    roleForm: admin,
    resetForm: admin && !self,
    useAccountPage: admin && self,
    deactivate: admin && !self && active,
    reactivate: admin && !self && !active,
  };
}
