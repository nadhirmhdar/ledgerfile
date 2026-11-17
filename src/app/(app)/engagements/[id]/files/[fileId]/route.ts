import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import { getFileStore } from "@/server/file-store";
import { streamBytes } from "@/server/stream";
import * as repo from "@/server/repo";
import { readWorkingPaper } from "@/server/working-papers";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Download a working paper. Requires a signed-in user of the engagement's firm; each download is logged. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  const session = await getSession();
  const { id, fileId } = await params;
  if (!UUID.test(id) || !UUID.test(fileId)) return new Response("Not found", { status: 404 });

  let paper: Awaited<ReturnType<typeof readWorkingPaper>>;
  try {
    paper = await withFirm(await getDb(), session.firmId, async (tx) => {
      // The bytes are read and checked against the stored hash here, before anything is logged or sent: a file that has
      // changed is refused with no download entry.
      const found = await readWorkingPaper(tx, getFileStore(), id, fileId);
      if (found) await repo.audit(tx, session, "download", "working_paper", fileId, { engagementId: id });
      return found;
    });
  } catch (e) {
    // Only a file that no longer matches its record is reported as such; anything else is a plain failure.
    if (e instanceof Error && /does not match its record/.test(e.message)) {
      return new Response("This file failed its integrity check and cannot be downloaded.", { status: 409 });
    }
    console.error("working paper download failed:", e instanceof Error ? e.message : "unknown error");
    return new Response("The file could not be downloaded.", { status: 500 });
  }
  if (!paper) return new Response("Not found", { status: 404 });

  // Uploaded files are untrusted. They are always sent as a download of unspecified type, never
  // displayed in the page, and the name in the header is reduced to plain characters.
  // The body is a stream: a function's response body is capped at about 4.5 MB, but the platform documents that the cap
  // "doesn't apply to streamed responses", and a file uploaded directly can be up to 50 MB.
  const ascii = paper.fileName.replace(/[^A-Za-z0-9._ -]/g, "_");
  return new Response(streamBytes(paper.data), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(paper.data.byteLength),
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(paper.fileName)}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "no-store",
    },
  });
}
