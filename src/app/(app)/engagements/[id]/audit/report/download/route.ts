import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import { buildLetterDocx } from "@/server/letters-docx";
import { generateReport, type ReportForm } from "@/server/report-download";
import { docxResponse, sameOriginPost } from "@/server/http";

export const dynamic = "force-dynamic";

/**
 * Download the auditor's report as a Word document (an unreviewed draft), generated from the recorded opinion. Anyone in the firm who can
 * open the engagement may download it, and so may anyone once it is locked. Refused when no opinion is recorded.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  // The form is posted from the report page only: refuse a post made from another site.
  if (!sameOriginPost(request)) return new Response("Forbidden", { status: 403 });

  const form: ReportForm = {};
  for (const [key, value] of await request.formData()) if (typeof value === "string" && (key === "partner" || key === "city")) form[key] = value.slice(0, 1000);

  const report = await withFirm(await getDb(), session.firmId, (tx) => generateReport(tx, session, id, form));
  if (report.kind === "not_found") return new Response("Not found", { status: 404 });
  if (report.kind === "refused") return new Response(report.message, { status: 409, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  return docxResponse(await buildLetterDocx(report.title, report.blocks), report.fileName);
}
