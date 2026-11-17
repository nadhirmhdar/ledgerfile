/** Small helpers the Word download routes share. */

/** True when an Origin header names this host. Anything that cannot be read as an address, such as "null", does not. */
export function sameHost(origin: string, host: string | null): boolean {
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** True when a posted form may be accepted: no Origin header, or one that names this host. Used so a form posted from another site is refused. */
export function sameOriginPost(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || sameHost(origin, request.headers.get("x-forwarded-host") ?? request.headers.get("host"));
}

/** Only plain characters in a file name, so the header cannot be broken by a client's name. */
export function plainName(name: string, fallback = "client"): string {
  return name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || fallback;
}

export const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** A Word file as a download. Never cached. */
export function docxResponse(buffer: Buffer, fileName: string): Response {
  return new Response(new Uint8Array(buffer), {
    headers: { "Content-Type": DOCX_TYPE, "Content-Disposition": `attachment; filename="${fileName}"`, "Cache-Control": "no-store" },
  });
}
