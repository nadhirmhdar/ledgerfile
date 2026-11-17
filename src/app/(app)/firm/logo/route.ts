import { getDb, withFirm } from "@/server/db";
import { getOptionalSession } from "@/server/session";
import { getFileStore } from "@/server/file-store";
import { readLogo } from "@/server/branding";

export const dynamic = "force-dynamic";

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });

/**
 * The firm's logo, for the Firm page's preview. Served only to a signed-in user of THAT firm (the firm is the session's own, never a parameter),
 * never cached, never sniffed. There is no public URL for a logo: a signed-out request, another firm's user, or a firm with no logo all get 404.
 */
export async function GET() {
  // Not getSession(): that redirects to the sign-in page, which an image request cannot follow. A signed-out request is simply not found.
  const session = await getOptionalSession();
  if (!session) return notFound();
  let logo: Awaited<ReturnType<typeof readLogo>>;
  try {
    logo = await withFirm(await getDb(), session.firmId, (tx) => readLogo(tx, getFileStore));
  } catch (e) {
    console.error("firm logo failed:", e instanceof Error ? e.message : "unknown error");
    return notFound();
  }
  if (!logo) return notFound();
  return new Response(new Uint8Array(logo.data), {
    headers: {
      "Content-Type": logo.contentType,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
