/** The words and limits of rolling clients forward, shared by the server and the page. Pure. */

export const MAX_ROLL_FORWARD = 200;
export const ROLLED_FORWARD = "Already rolled forward";
export const STILL_OPEN = "Last year's file is still open";
export const CARRIES_NOTE = "Mappings carry forward when you import each trial balance. Bring forward client requests, confirmations and test schedules from each engagement.";

export interface RollRow {
  clientId: string;
  clientName: string;
  engagementId: string;
  periodStart: string;
  periodEnd: string;
  /** In words: Open, Locked or Archived. */
  status: "Open" | "Locked" | "Archived";
  auditEnabled: boolean;
  proposed: { start: string; end: string };
  /** Another engagement of the client starts after this one ends, so the client cannot be rolled forward again from here. */
  rolledForward: boolean;
}

export interface RollProblem {
  clientId: string;
  clientName: string;
  message: string;
}

export interface Created {
  engagementId: string;
  clientId: string;
  clientName: string;
  start: string;
  end: string;
}
