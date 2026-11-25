import { getDb, withFirm } from "./db";
import type { Session } from "./repo";
import * as repo from "./repo";
import { buildStatementPack } from "../domain/statement-pack";
import { docxResponse, pdfResponse, plainName } from "./http";
import { buildStatementsDocx } from "./statements-docx";
import { statementsDocument } from "../domain/statements-document";
import { getFileStore } from "./file-store";
import { loadBrandingForOutputs } from "./branding";
import { loadNoteOverrides } from "./note-texts";
import { hasBranding } from "../domain/branding";

export type StatementsFormat = "docx" | "pdf";

/**
 * The financial statements as a download, in Word or PDF. One handler for both: the same access (a signed-in user of the engagement's firm),
 * the same `units` rounding, the same statement pack and the same draft flag, and the same log entry, so the two files cannot differ except
 * in format. Not found when the engagement is another firm's, or has no accounts yet.
 */
export async function statementsDownload(session: Session, id: string, requestUrl: string, format: StatementsFormat): Promise<Response> {
  const { engagement, accounts, branding, noteTexts } = await withFirm(await getDb(), session.firmId, async (tx) => {
    const engagement = await repo.getEngagement(tx, id);
    const accounts = engagement ? await repo.listAccounts(tx, id) : [];
    // The Word download's entry is unchanged; the PDF's says which format it was.
    if (engagement) await repo.audit(tx, session, "export", "financial_statements", id, format === "pdf" ? { format: "pdf" } : undefined);
    // A person's wording for the notes: the same map the statements page uses, so the page, the Word file and the PDF read alike.
    return { engagement, accounts, branding: engagement ? await loadBrandingForOutputs(tx, getFileStore) : null, noteTexts: engagement ? await loadNoteOverrides(tx, id) : {} };
  });
  if (!engagement || accounts.length === 0) return new Response("Not found", { status: 404 });

  // The engagement's own rounding is the default; an explicit ?units= (the page's toggle) overrides it.
  const units = new URL(requestUrl).searchParams.get("units");
  const whole = units === "whole" ? true : units === "exact" ? false : engagement.statementUnit === "whole";
  const pack = buildStatementPack(
    accounts.map((a) => ({ ...a, closingMinor: a.closingMinor + a.adjustmentMinor })),
    { unitMinor: whole ? 100 : 1, currency: engagement.currency ?? undefined, borrowingsCurrent: { current: engagement.borrowingsCurrentMinor, prior: engagement.borrowingsCurrentPriorMinor }, noteTexts },
  );
  const input = {
    clientName: engagement.clientName,
    periodStart: engagement.periodStart,
    periodEnd: engagement.periodEnd,
    pack,
    draft: !pack.clean || engagement.status !== "locked",
  };
  // The statements are the client's: the firm shows only as a discreet header (its logo and name), and only when it has set branding.
  const brand = branding && hasBranding(branding) ? { firmName: branding.firmName, logo: branding.logo } : null;
  const base = `${plainName(engagement.clientName)}-financial-statements-${engagement.periodEnd}`;
  if (format === "docx") return docxResponse(await buildStatementsDocx({ ...input, brand }), `${base}.docx`);
  // pdfkit is loaded only when a PDF is asked for.
  const { renderPdf } = await import("./pdf");
  const buffer = await renderPdf(statementsDocument(input), {
    title: `${engagement.clientName} financial statements ${engagement.periodEnd}`,
    header: `${engagement.clientName}, financial statements, period ${engagement.periodStart} to ${engagement.periodEnd}`,
    brand,
  });
  return pdfResponse(buffer, `${base}.pdf`);
}
