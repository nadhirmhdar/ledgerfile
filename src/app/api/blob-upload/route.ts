import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getDb } from "@/server/db";
import { getOptionalSession } from "@/server/session";
import { directUploadAvailable, tokenOptionsFor } from "@/server/direct-upload";

export const dynamic = "force-dynamic";

/**
 * Issues the short-lived token the browser needs to send one file straight to the private Blob store.
 *
 * Never returns a token for a key the server did not issue: the pathname the browser asks for must be the key of an unexpired
 * pending upload of THIS signed-in user (see decideToken). The token is limited to the declared size, cannot overwrite, and expires
 * with the pending row. The completed-upload callback is not used: it needs a public URL and cannot reach a developer's machine, and
 * finishUploadAction (which reads the object itself) is the authority on whether an upload counts.
 */
export async function POST(request: Request) {
  // Not getSession(): that redirects to the sign-in page, which a script call cannot follow. Answer 401 instead.
  const session = await getOptionalSession();
  if (!session) return Response.json({ error: "Sign in again to upload." }, { status: 401 });
  if (!directUploadAvailable()) return Response.json({ error: "Direct upload is not available." }, { status: 404 });

  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return Response.json({ error: "Bad request." }, { status: 400 });
  }
  if (body?.type !== "blob.generate-client-token") return Response.json({ error: "Bad request." }, { status: 400 });

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => tokenOptionsFor(await getDb(), session, pathname),
    });
    return Response.json(result);
  } catch {
    // The reason is deliberately not sent back: it could say whether a key exists.
    return Response.json({ error: "This upload is not allowed." }, { status: 400 });
  }
}
