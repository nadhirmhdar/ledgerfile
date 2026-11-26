/** A piece of text: plain, or a [bracketed placeholder] the preparer has to fill in. */
export interface TextPiece {
  text: string;
  placeholder: boolean;
}

/**
 * Splits text on [square brackets], so the placeholders can be highlighted. The text is kept exactly: joining the pieces gives the
 * original back. A bracket that is never closed is left as plain text.
 */
export function splitBrackets(text: string): TextPiece[] {
  const pieces: TextPiece[] = [];
  const re = /\[[^\][]*\]/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) pieces.push({ text: text.slice(last, at), placeholder: false });
    pieces.push({ text: m[0], placeholder: true });
    last = at + m[0].length;
  }
  if (last < text.length) pieces.push({ text: text.slice(last), placeholder: false });
  return pieces;
}

/** How many placeholders a note still has. The one definition: the notes page, the statements page and the statement check all use it. */
export const placeholderCount = (texts: string[]): number => texts.reduce((n, t) => n + splitBrackets(t).filter((p) => p.placeholder).length, 0);
