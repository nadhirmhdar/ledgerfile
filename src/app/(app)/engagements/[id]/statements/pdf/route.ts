import { getSession } from "@/server/session";
import { statementsDownload } from "@/server/statements-export";

export const dynamic = "force-dynamic";

/** Download the financial statements as a PDF, the same statements as the Word download. Requires a signed-in user of the engagement's firm. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  return statementsDownload(session, id, request.url, "pdf");
}
