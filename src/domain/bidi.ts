/**
 * Our own reduced form of the Unicode Bidirectional Algorithm (UAX #9), enough to print names that mix Arabic, Latin and digits on one line.
 * Pure: no I/O, no fonts.
 *
 * Covered: the paragraph direction (P2, P3) or a given one; the weak types (W1–W7); bracket pairs for ( ) and [ ] only (N0); neutrals
 * (N1, N2); implicit levels (I1, I2); trailing white space and separators (L1); reordering (L2); mirroring of ( ) [ ] in right-to-left
 * text (L4).
 *
 * Left out: explicit embeddings, overrides and isolates (LRE, RLE, LRO, RLO, PDF, LRI, RLI, FSI, PDI). Those characters are treated as
 * neutrals. Other bracket pairs are ordinary neutrals. The character classes below are those of the scripts a name here can be in; any
 * other letter counts as left-to-right.
 */

export type Direction = "ltr" | "rtl";

type BidiClass = "L" | "R" | "AL" | "EN" | "AN" | "ES" | "ET" | "CS" | "NSM" | "BN" | "B" | "S" | "WS" | "ON";

const between = (c: number, from: number, to: number) => c >= from && c <= to;

export function bidiClass(ch: string): BidiClass {
  const c = ch.codePointAt(0)!;
  if (c === 0x0a || c === 0x0d || between(c, 0x1c, 0x1e) || c === 0x85 || c === 0x2029) return "B";
  if (c === 0x09 || c === 0x0b || c === 0x1f) return "S";
  if (c === 0x20 || c === 0x0c || c === 0x1680 || between(c, 0x2000, 0x200a) || c === 0x2028 || c === 0x205f || c === 0x3000) return "WS";
  // Explicit formatting characters: not supported, so neutral.
  if (between(c, 0x202a, 0x202e) || between(c, 0x2066, 0x2069)) return "ON";
  if (c === 0x200e) return "L";
  if (c === 0x200f) return "R";
  if (c === 0x61c) return "AL";
  if (c < 0x20 || between(c, 0x7f, 0x9f) || c === 0xad || between(c, 0x200b, 0x200d) || between(c, 0x2060, 0x2064) || between(c, 0x206a, 0x206f) || c === 0xfeff) return "BN";
  if (between(c, 0x30, 0x39) || c === 0xb2 || c === 0xb3 || c === 0xb9 || between(c, 0x6f0, 0x6f9) || between(c, 0xff10, 0xff19)) return "EN";
  if (between(c, 0x600, 0x605) || between(c, 0x660, 0x669) || c === 0x66b || c === 0x66c || c === 0x6dd || c === 0x890 || c === 0x891 || c === 0x8e2) return "AN";
  if (c === 0x2b || c === 0x2d || c === 0x207a || c === 0x207b || c === 0x208a || c === 0x208b || c === 0x2212) return "ES";
  if (c === 0x23 || c === 0x24 || c === 0x25 || between(c, 0xa2, 0xa5) || c === 0xb0 || c === 0xb1 || c === 0x609 || c === 0x60a || c === 0x66a || between(c, 0x2030, 0x2034) || between(c, 0x20a0, 0x20cf)) return "ET";
  if (c === 0x2c || c === 0x2e || c === 0x2f || c === 0x3a || c === 0xa0 || c === 0x60c || c === 0x202f || c === 0x2044) return "CS";
  if (/[\p{Mn}\p{Me}]/u.test(ch)) return "NSM";
  if (c === 0x606 || c === 0x607 || c === 0x60e || c === 0x60f || c === 0x6de || c === 0x6e9 || c === 0xfd3e || c === 0xfd3f || between(c, 0xfdfd, 0xfdff)) return "ON";
  if (between(c, 0x590, 0x5ff) || between(c, 0x7c0, 0x85f) || between(c, 0xfb1d, 0xfb4f)) return "R";
  if (between(c, 0x600, 0x6ff) || between(c, 0x700, 0x7bf) || between(c, 0x860, 0x8ff) || between(c, 0xfb50, 0xfdfc) || between(c, 0xfe70, 0xfefe)) return "AL";
  if (c === 0xaa || c === 0xb5 || c === 0xba) return "L";
  return /[\p{P}\p{S}]/u.test(ch) ? "ON" : "L";
}

const BRACKETS: Record<string, string> = { "(": ")", "[": "]" };
const MIRRORED: Record<string, string> = { "(": ")", ")": "(", "[": "]", "]": "[" };

/** N0 looks at numbers as right-to-left. */
const strongSide = (t: BidiClass): "L" | "R" | null => (t === "L" ? "L" : t === "R" || t === "EN" || t === "AN" ? "R" : null);

export interface BidiParagraph {
  /** The paragraph's own direction. */
  direction: Direction;
  /** The characters, by code point, in logical order. */
  chars: string[];
  /** The embedding level of each character; null for the ones the algorithm removes (zero-width and control characters). */
  levels: (number | null)[];
}

/** Resolve the levels of one line of text (P2 to L1). */
export function resolveLevels(text: string, direction?: Direction): BidiParagraph {
  const chars = Array.from(text);
  const original = chars.map(bidiClass);
  const kept = original.map((_, i) => i).filter((i) => original[i] !== "BN");

  let base = direction;
  if (!base) {
    const first = kept.find((i) => original[i] === "L" || original[i] === "R" || original[i] === "AL");
    base = first !== undefined && original[first] !== "L" ? "rtl" : "ltr";
  }
  const level = base === "rtl" ? 1 : 0;
  const edge: "L" | "R" = level ? "R" : "L";
  const types: BidiClass[] = kept.map((i) => original[i]);
  const n = types.length;

  // W1: a mark takes the type of what it sits on.
  for (let i = 0; i < n; i++) if (types[i] === "NSM") types[i] = i === 0 ? edge : types[i - 1];
  // W2: digits after Arabic letters are Arabic numbers. W3: AL is then R.
  let strong: BidiClass = edge;
  for (let i = 0; i < n; i++) {
    if (types[i] === "L" || types[i] === "R" || types[i] === "AL") strong = types[i];
    else if (types[i] === "EN" && strong === "AL") types[i] = "AN";
  }
  for (let i = 0; i < n; i++) if (types[i] === "AL") types[i] = "R";
  // W4: one separator between two numbers of the same kind joins them.
  for (let i = 1; i < n - 1; i++) {
    const [before, here, after] = [types[i - 1], types[i], types[i + 1]];
    if (here === "ES" && before === "EN" && after === "EN") types[i] = "EN";
    if (here === "CS" && (before === "EN" || before === "AN") && after === before) types[i] = before;
  }
  // W5: terminators beside European numbers belong to them.
  for (let i = 0; i < n; i++) {
    if (types[i] !== "ET") continue;
    let end = i;
    while (end < n && types[end] === "ET") end++;
    if ((i > 0 && types[i - 1] === "EN") || (end < n && types[end] === "EN")) types.fill("EN", i, end);
    i = end - 1;
  }
  // W6: the rest of the separators and terminators are neutral.
  for (let i = 0; i < n; i++) if (types[i] === "ES" || types[i] === "ET" || types[i] === "CS") types[i] = "ON";
  // W7: European numbers in left-to-right text are L.
  strong = edge;
  for (let i = 0; i < n; i++) {
    if (types[i] === "L" || types[i] === "R") strong = types[i];
    else if (types[i] === "EN" && strong === "L") types[i] = "L";
  }

  // N0: bracket pairs.
  const stack: { close: string; at: number }[] = [];
  const pairs: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    if (types[i] !== "ON") continue;
    const ch = chars[kept[i]];
    if (BRACKETS[ch]) {
      if (stack.length === 63) break;
      stack.push({ close: BRACKETS[ch], at: i });
    } else if (ch === ")" || ch === "]") {
      for (let s = stack.length - 1; s >= 0; s--) {
        if (stack[s].close !== ch) continue;
        pairs.push([stack[s].at, i]);
        stack.length = s;
        break;
      }
    }
  }
  pairs.sort((a, b) => a[0] - b[0]);
  const other: "L" | "R" = edge === "L" ? "R" : "L";
  for (const [open, close] of pairs) {
    const inside = types.slice(open + 1, close).map(strongSide);
    let set: "L" | "R" | null = null;
    if (inside.includes(edge)) set = edge;
    else if (inside.includes(other)) {
      let context: "L" | "R" = edge;
      for (let i = open - 1; i >= 0; i--) {
        const s = strongSide(types[i]);
        if (s) {
          context = s;
          break;
        }
      }
      set = context === other ? other : edge;
    }
    if (!set) continue;
    for (const at of [open, close]) {
      types[at] = set;
      // Marks after a bracket follow it.
      for (let i = at + 1; i < n && original[kept[i]] === "NSM"; i++) types[i] = set;
    }
  }

  // N1, N2: neutrals take the direction on both sides of them, or the paragraph's.
  const neutral = (t: BidiClass) => t === "ON" || t === "WS" || t === "S" || t === "B";
  for (let i = 0; i < n; i++) {
    if (!neutral(types[i])) continue;
    let end = i;
    while (end < n && neutral(types[end])) end++;
    const before = i === 0 ? edge : strongSide(types[i - 1]);
    const after = end === n ? edge : strongSide(types[end]);
    types.fill(before && before === after ? before : edge, i, end);
    i = end - 1;
  }

  // I1, I2.
  const resolved: (number | null)[] = chars.map(() => null);
  for (let i = 0; i < n; i++) {
    const t = types[i];
    resolved[kept[i]] = level === 0 ? (t === "R" ? 1 : t === "EN" || t === "AN" ? 2 : 0) : t === "R" ? 1 : 2;
  }

  // L1: separators, and white space before them or at the end of the line, go back to the paragraph's level.
  let trailing = true;
  for (let i = n - 1; i >= 0; i--) {
    const t = original[kept[i]];
    if (t === "B" || t === "S") {
      resolved[kept[i]] = level;
      trailing = true;
    } else if (trailing && (t === "WS" || /[\u202a-\u202e\u2066-\u2069]/.test(chars[kept[i]]))) resolved[kept[i]] = level;
    else trailing = false;
  }

  return { direction: base, chars, levels: resolved };
}

/** L2: the positions of the kept characters, left to right as they are seen. */
export function visualOrder(levels: (number | null)[]): number[] {
  const order = levels.map((_, i) => i).filter((i) => levels[i] !== null);
  const at = (i: number) => levels[order[i]]!;
  const highest = Math.max(0, ...order.map((i) => levels[i]!));
  for (let level = highest; level >= 1; level--) {
    for (let start = 0; start < order.length; start++) {
      if (at(start) < level) continue;
      let end = start;
      while (end < order.length && at(end) >= level) end++;
      order.splice(start, end - start, ...order.slice(start, end).reverse());
      start = end - 1;
    }
  }
  return order;
}

export interface VisualRun {
  /** The run's characters in logical (typing) order. A right-to-left run is read from its end when laid out character by character. */
  text: string;
  direction: Direction;
}

/**
 * One line as runs in the order they are seen, left to right. Each run keeps its text in logical order, which is what a text shaper wants;
 * brackets in a right-to-left run are already mirrored. Zero-width characters stay with the character before them, so joining controls still
 * reach the shaper.
 */
export function visualRuns(text: string, direction?: Direction): VisualRun[] {
  const { chars, levels, direction: base } = resolveLevels(text, direction);
  const filled: number[] = [];
  let last = base === "rtl" ? 1 : 0;
  for (const l of levels) filled.push((last = l ?? last));

  // Runs of one level in logical order, then reordered as L2 reorders characters.
  const runs: { from: number; to: number; level: number }[] = [];
  filled.forEach((level, i) => {
    const run = runs[runs.length - 1];
    if (run && run.level === level) run.to = i + 1;
    else runs.push({ from: i, to: i + 1, level });
  });
  return visualOrder(runs.map((r) => r.level)).map((r) => {
    const { from, to, level } = runs[r];
    const part = chars.slice(from, to);
    const rtl = level % 2 === 1;
    return { text: (rtl ? part.map((c) => MIRRORED[c] ?? c) : part).join(""), direction: rtl ? "rtl" : "ltr" };
  });
}

/** The line as it is seen, character by character: for tests and for reading what a reader sees. */
export function toVisualString(text: string, direction?: Direction): string {
  return visualRuns(text, direction)
    .map((r) => (r.direction === "rtl" ? Array.from(r.text).reverse().join("") : r.text))
    .join("");
}
