import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import { generateLetter, LETTER_KINDS, type LetterForm, type LetterKind } from "@/server/letters";
import { buildLetterDocx } from "@/server/letters-docx";

export const dynamic = "force-dynamic";

/** Download the engagement letter or the representation letter as a Word document, filled from the form. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; kind: string }> }) {
  const session = await getSession();
  const { id, kind } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !LETTER_KINDS.includes(kind as LetterKind)) return new Response("Not found", { status: 404 });

  // The form is posted from the letters page only: refuse a post made from another site.
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== (request.headers.get("x-forwarded-host") ?? request.headers.get("host"))) return new Response("Forbidden", { status: 403 });

  const form: LetterForm = {};
  for (const [key, value] of await request.formData()) if (typeof value === "string") form[key] = value.slice(0, 10000);

  const letter = await withFirm(await getDb(), session.firmId, (tx) => generateLetter(tx, session, id, kind as LetterKind, form));
  if (!letter) return new Response("Not found", { status: 404 });
  const buffer = await buildLetterDocx(letter.title, letter.blocks);

  // Only plain characters in the file name, so the header cannot be broken by a client's name.
  const safeName = letter.context.clientName.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "client";
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${safeName}-${kind}-letter-${letter.context.periodEnd}.docx"`,
      "Cache-Control": "no-store",
    },
  });
}
