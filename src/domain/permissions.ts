import { canLock, canReview, type Role } from "./signoff";

/**
 * What each role may do, beyond the review rules in signoff.ts.
 *
 * Everyone in the firm can do the day-to-day work on an engagement: import a trial
 * balance, map accounts, post journals, respond to review points and export statements.
 * The restrictions are on decisions that belong to more senior people:
 *
 * - taking on a client is a partner decision (the firm administrator counts as partner-level);
 * - opening an engagement is for a reviewer or partner;
 * - a posted journal can be deleted by the person who posted it, or by a reviewer or partner.
 */
export const canCreateClient = (role: Role) => canLock(role);
export const canCreateEngagement = (role: Role) => canReview(role);
export const canDeleteJournal = (role: Role, isAuthor: boolean) => isAuthor || canReview(role);

export const CLIENT_REFUSAL = "Only a partner can add a client.";
export const ENGAGEMENT_REFUSAL = "Only a reviewer or partner can create an engagement.";
export const JOURNAL_DELETE_REFUSAL = "Only the person who posted this entry, or a reviewer or partner, can delete it.";
