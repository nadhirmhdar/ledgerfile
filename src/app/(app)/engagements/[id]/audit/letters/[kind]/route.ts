import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import { generateLetter, LETTER_KINDS, type LetterForm, type LetterKind } from "@/server/letters";
import { buildLetterDocx } from "@/server/letters-docx";
import { docxResponse, plainName, sameOriginPost } from "@/server/http";

export const dynamic = "force-dynamic";

/** Download the engagement letter or the representation letter as a Word document, filled from the form. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; kind: string }> }) {
  const session = await getSession();
  const { id, kind } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !LETTER_KINDS.includes(kind as LetterKind)) return new Response("Not found", { status: 404 });

  // The form is posted from the letters page only: refuse a post made from another site.
  if (!sameOriginPost(request)) return new Response("Forbidden", { status: 403 });

  const form: LetterForm = {};
  for (const [key, value] of await request.formData()) if (typeof value === "string") form[key] = value.slice(0, 10000);

  const letter = await withFirm(await getDb(), session.firmId, (tx) => generateLetter(tx, session, id, kind as LetterKind, form));
  if (!letter) return new Response("Not found", { status: 404 });
  const buffer = await buildLetterDocx(letter.title, letter.blocks, { logo: letter.logo });
  return docxResponse(buffer, `${plainName(letter.context.clientName)}-${kind}-letter-${letter.context.periodEnd}.docx`);
}
