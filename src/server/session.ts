import { DEV_FIRM_ID, DEV_USER_ID } from "./db";
import type { Session } from "./repo";

/**
 * Who is making this request.
 * There is no sign-in yet: every request runs as the seeded demo firm and user.
 * Real authentication replaces the body of this function and nothing else.
 */
export async function getSession(): Promise<Session> {
  return { firmId: DEV_FIRM_ID, userId: DEV_USER_ID };
}
