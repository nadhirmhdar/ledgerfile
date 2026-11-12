import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "./db";
import { getSessionByToken, SESSION_HOURS, type AuthSession } from "./auth";

export const SESSION_COOKIE = "lf_session";

/** The signed-in user, or null. Use on pages that work both signed in and signed out. */
export async function getOptionalSession(): Promise<AuthSession | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return getSessionByToken(await getDb(), token);
}

/** The signed-in user. Anyone not signed in is sent to the sign-in page. */
export async function getSession(): Promise<AuthSession> {
  const session = await getOptionalSession();
  if (!session) redirect("/sign-in");
  return session;
}

export async function setSessionCookie(token: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_HOURS * 60 * 60,
  });
}

export async function clearSessionCookie(): Promise<string | undefined> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  jar.delete(SESSION_COOKIE);
  return token;
}
