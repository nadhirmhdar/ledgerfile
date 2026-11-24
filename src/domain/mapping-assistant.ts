import { GROUPS, GROUP_BY_CODE } from "./groups";

/**
 * The mapping assistant: it reads each account and says which lead sheet group it probably belongs to, or says it could not place it. Pure. It runs
 * inside the app on the firm's own data and nothing else: no outside model, no service, no network. The same inputs always give the same answer
 * (ties are broken by group code, accounts are read in code order, and nothing depends on time or random numbers).
 *
 * Each kind of evidence gives a group a score between 0 and 1. A group's evidence combines as 1 - (1 - a)(1 - b)..., so agreement strengthens a
 * suggestion and no single weak hint makes one. The best group is suggested only when its score is clear (at least MIN_SCORE) and ahead of the next
 * group (by at least MARGIN); otherwise the account is declined, with the reason. A balance on the unusual side for the group, other than on a
 * contra account, is flagged and keeps the suggestion at the low band.
 */

export type Band = "high" | "medium" | "low";

export interface AssistantAccount {
  code: string;
  name: string;
  closingMinor: number;
}

/** One mapping the firm approved (on any engagement, any client, any year). The assistant learns from these and from nothing else. */
export interface LearnedExample {
  code: string;
  name: string;
  closingMinor: number;
  groupCode: string;
}

export interface Suggestion {
  kind: "suggest";
  accountCode: string;
  groupCode: string;
  /** 0 to 1, two decimals, after any cap for an unusual balance. */
  score: number;
  band: Band;
  /** One plain sentence a person can read. */
  reason: string;
}
export interface Decline {
  kind: "decline";
  accountCode: string;
  reason: string;
}
export type Placement = Suggestion | Decline;

export const MIN_SCORE = 0.4;
export const MARGIN = 0.12;
export const HIGH = 0.8;
export const MEDIUM = 0.6;
/** A flagged suggestion never rises above this: the low band. */
const FLAG_CAP = 0.59;

export const bandOf = (score: number): Band => (score >= HIGH ? "high" : score >= MEDIUM ? "medium" : "low");

// --- Reading an account's name ----------------------------------------------------------------------------------------------------------

const STOP = new Set(["of", "the", "and", "a", "an", "for", "to", "in", "on", "at", "by", "account", "accounts"]);
const WORDS: Record<string, string> = {
  acct: "account", acc: "acc", accum: "accumulated", depn: "depreciation", deprn: "depreciation", amort: "amortisation", amortn: "amortisation", amortization: "amortisation",
  prov: "provision", provn: "provision", recv: "receivable", rec: "receivable", recs: "receivable", receivables: "receivable", payables: "payable",
  ppe: "property plant equipment", eosb: "end of service benefits", adv: "advance", advs: "advances", exp: "expense", expenses: "expense", inc: "income",
  equip: "equipment", furn: "furniture", veh: "vehicle", vehicles: "vehicle", mach: "machinery", bldg: "building", mgmt: "management", sal: "salaries", sals: "salaries",
  ins: "insurance", svc: "service", svcs: "services", tel: "telephone", misc: "miscellaneous", invt: "inventory", stk: "stock", cust: "customer", supp: "supplier", dr: "debtors", cr: "creditors",
};

/** Lower case, abbreviations spelled out, punctuation gone, single spaces. */
export function normalise(name: string): string {
  const raw = name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\ba\/c\b/g, "account")
    .replace(/\bw\/o\b/g, "write off")
    .replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  const out: string[] = [];
  raw.forEach((tok, i) => {
    const next = raw[i + 1] ?? "";
    const prev = raw[i - 1] ?? "";
    if ((tok === "acc" || tok === "accum") && /^(dep|amort)/.test(next)) out.push("accumulated");
    else if (tok === "dep") out.push(/^(acc|accum|accumulated)$/.test(prev) || /^(exp|expense|charge)$/.test(next) ? "depreciation" : "deposit");
    else if (tok === "pay") out.push(/^(account|accounts|acct|trade|other)$/.test(prev) ? "payable" : "pay");
    else if (tok === "int") out.push(/^(income|expense|exp|on|paid|received)$/.test(next) ? "interest" : "int");
    else out.push(WORDS[tok] ?? tok);
  });
  return out.join(" ");
}

/** The words that carry meaning: numbers and filler left out. */
const contentTokens = (normalised: string): string[] => [...new Set(normalised.split(" ").filter((t) => t && !STOP.has(t) && !/^\d+$/.test(t)))].sort();

const jaccard = (a: string[], b: string[]): number => {
  if (a.length === 0 || b.length === 0) return 0;
  const sb = new Set(b);
  const shared = a.filter((t) => sb.has(t)).length;
  return shared / (a.length + b.length - shared);
};

// --- Which side a balance is expected on -------------------------------------------------------------------------------------------------

const DEBIT = new Set(["PPE", "INTANG", "INVEST", "INVENT", "TRADEREC", "RPREC", "CASH", "COS", "STAFF", "DEPN", "ADMIN", "FINCOST", "TAXEXP"]);
const CREDIT = new Set(["CAPITAL", "RESERVES", "EOSB", "BORROW", "TRADEPAY", "RPPAY", "TAXLIAB", "REVENUE", "OTHERINC"]);
/** Contra accounts carry the opposite balance on purpose. */
const CONTRA = /\b(accumulated|allowance|impairment|discount|returns?|rebate|credit note|write off|provision for doubtful|less)\b/;

function sideFlag(groupCode: string, closingMinor: number, normalisedName: string): { flag: string | null; contra: boolean } {
  const expected = DEBIT.has(groupCode) ? "debit" : CREDIT.has(groupCode) ? "credit" : null;
  const actual = closingMinor > 0 ? "debit" : closingMinor < 0 ? "credit" : null;
  if (!expected || !actual || expected === actual) return { flag: null, contra: false };
  if (CONTRA.test(normalisedName)) return { flag: null, contra: true };
  return { flag: `The balance is a ${actual} but ${GROUP_BY_CODE.get(groupCode)?.name ?? groupCode} is usually a ${expected}: check it.`, contra: false };
}

// --- Evidence ---------------------------------------------------------------------------------------------------------------------------

interface Evidence {
  groupCode: string;
  score: number;
  /** For the reason: strongest first. */
  rank: number;
  phrase: string;
}

/** Words that say little ('expense' is in many names): never more than a low-band hint, whatever their length. */
const GENERIC = new Set(["expense"]);

interface Keyword {
  groupCode: string;
  text: string;
  needsMore: boolean;
}
/** Phrases the group keywords do not have, for wording the assistant is expected to read. */
const EXTRA_KEYWORDS: Record<string, string[]> = { TRADEREC: ["security deposit", "rental deposit", "utility deposit"], CASH: ["call deposit", "margin deposit"] };
const KEYWORDS: Keyword[] = GROUPS.flatMap((g) => [...g.keywords, ...(EXTRA_KEYWORDS[g.code] ?? [])].map((k) => ({ groupCode: g.code, text: normalise(k), needsMore: k.trim().endsWith("-") }))).filter((k) => k.text !== "");

/** Keyword hits (a keyword starts at a word, so "rent" is not found inside "current"), with a hit dropped when a longer keyword of another group contains it ("bank" inside "bank loan"). */
function keywordEvidence(n: string): Evidence[] {
  const padded = ` ${n} `;
  const hits = KEYWORDS.filter((k) => (k.needsMore ? ` ${n}`.includes(` ${k.text} `) : padded.includes(` ${k.text}`)));
  const kept = hits.filter((h) => !hits.some((o) => o.groupCode !== h.groupCode && o.text.length > h.text.length && o.text.includes(h.text)));
  const best = new Map<string, Keyword>();
  for (const h of kept) {
    const b = best.get(h.groupCode);
    if (!b || h.text.length > b.text.length || (h.text.length === b.text.length && h.text < b.text)) best.set(h.groupCode, h);
  }
  return [...best.values()].map((h) => ({ groupCode: h.groupCode, score: GENERIC.has(h.text) ? 0.4 : h.text.length >= 12 ? 0.7 : h.text.length >= 7 ? 0.55 : 0.4, rank: 3, phrase: `Matches '${h.text}'` }));
}

interface Learned {
  norm: string;
  tokens: string[];
  groups: Map<string, number>;
}

function learnedIndex(examples: LearnedExample[]): Learned[] {
  const byName = new Map<string, Map<string, number>>();
  for (const e of examples) {
    if (!GROUP_BY_CODE.has(e.groupCode)) continue;
    const norm = normalise(e.name);
    if (norm === "") continue;
    const groups = byName.get(norm) ?? new Map<string, number>();
    groups.set(e.groupCode, (groups.get(e.groupCode) ?? 0) + 1);
    byName.set(norm, groups);
  }
  return [...byName.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([norm, groups]) => ({ norm, tokens: contentTokens(norm), groups }));
}

const many = (n: number, one: string, other: string) => (n === 1 ? `1 ${one}` : `${n} ${other}`);

function learnedEvidence(n: string, tokens: string[], index: Learned[]): Evidence[] {
  const out: Evidence[] = [];
  const exact = index.find((l) => l.norm === n);
  if (exact) {
    const total = [...exact.groups.values()].reduce((a, b) => a + b, 0);
    for (const [groupCode, c] of exact.groups) {
      out.push({ groupCode, score: 0.92 * (c / total) * (1 - 0.3 ** c), rank: 1, phrase: `your firm mapped ${many(c, "account", "accounts")} with this name to ${GROUP_BY_CODE.get(groupCode)!.name}` });
    }
  }
  const similar = new Map<string, { best: number; count: number }>();
  for (const l of index) {
    if (l.norm === n) continue;
    const sim = jaccard(tokens, l.tokens);
    if (sim < 0.5) continue;
    for (const [groupCode, c] of l.groups) {
      const s = similar.get(groupCode) ?? { best: 0, count: 0 };
      similar.set(groupCode, { best: Math.max(s.best, sim), count: s.count + c });
    }
  }
  for (const [groupCode, s] of similar) {
    out.push({ groupCode, score: 0.8 * s.best * (1 - 0.35 ** s.count), rank: 2, phrase: `your firm mapped ${many(s.count, "similar account", "similar accounts")} to ${GROUP_BY_CODE.get(groupCode)!.name}` });
  }
  return out;
}

// --- Deciding ---------------------------------------------------------------------------------------------------------------------------

const numeric = (code: string): number | null => (/^\d{1,9}$/.test(code.trim()) ? Number(code.trim()) : null);
const round2 = (x: number) => Math.round(x * 100) / 100;
const groupName = (code: string) => GROUP_BY_CODE.get(code)?.name ?? code;

function decide(account: AssistantAccount, n: string, evidence: Evidence[], neighbourNote: string | null): Placement {
  const byGroup = new Map<string, Evidence[]>();
  for (const e of evidence) byGroup.set(e.groupCode, [...(byGroup.get(e.groupCode) ?? []), e]);
  const scored = [...byGroup.entries()]
    .map(([groupCode, list]) => ({ groupCode, list, score: 1 - list.reduce((p, e) => p * (1 - e.score), 1) }))
    .sort((a, b) => b.score - a.score || (a.groupCode < b.groupCode ? -1 : 1));
  const [top, second] = scored;
  const decline = (reason: string): Decline => ({ kind: "decline", accountCode: account.code, reason });
  if (!top) return decline(`No wording match and nothing similar your firm has mapped${neighbourNote ? `; ${neighbourNote}` : ""}.`);
  if (top.score < MIN_SCORE) return decline(`Only a weak hint (${groupName(top.groupCode)}), not enough to suggest${neighbourNote ? `; ${neighbourNote}` : ""}.`);
  if (second && top.score - second.score < MARGIN) return decline(`The evidence is split between ${groupName(top.groupCode)} and ${groupName(second.groupCode)}.`);

  const { flag, contra } = sideFlag(top.groupCode, account.closingMinor, n);
  const phrases = [...top.list].sort((a, b) => a.rank - b.rank || b.score - a.score).slice(0, 2).map((e) => e.phrase);
  const reason = [`${phrases.join("; ")}.`.replace(/^./, (c) => c.toUpperCase()), contra ? "A contra account, so the opposite balance is expected." : "", flag ?? ""].filter(Boolean).join(" ");
  const score = round2(flag ? Math.min(top.score, FLAG_CAP) : top.score);
  return { kind: "suggest", accountCode: account.code, groupCode: top.groupCode, score, band: bandOf(score), reason };
}

/**
 * Place each account: a suggestion with its band and reason, or "could not place" with why. Placements come back in the order of `accounts`.
 * `priorYear` maps an account code to the group a person approved for it last year. `examples` are the firm's own approved mappings.
 */
export function assist(input: { accounts: AssistantAccount[]; priorYear?: Map<string, string>; examples?: LearnedExample[] }): Placement[] {
  const index = learnedIndex(input.examples ?? []);
  const rows = input.accounts.map((account) => {
    const n = normalise(account.name);
    const evidence: Evidence[] = [...keywordEvidence(n), ...learnedEvidence(n, contentTokens(n), index)];
    const prior = input.priorYear?.get(account.code);
    if (prior && GROUP_BY_CODE.has(prior)) evidence.push({ groupCode: prior, score: 0.97, rank: 0, phrase: `The same code was mapped to ${groupName(prior)} last year` });
    return { account, n, evidence };
  });

  // Pass 1 uses the account's own evidence. Pass 2 adds the neighbouring codes in this trial balance, using only pass 1's firm placements.
  const first = rows.map((r) => decide(r.account, r.n, r.evidence, null));
  const anchors = rows
    .map((r, i) => ({ code: numeric(r.account.code), p: first[i] }))
    .filter((a): a is { code: number; p: Suggestion } => a.code !== null && a.p.kind === "suggest" && a.p.score >= MEDIUM)
    .sort((a, b) => a.code - b.code || (a.p.accountCode < b.p.accountCode ? -1 : 1));

  return rows.map((r, i) => {
    const code = numeric(r.account.code);
    if (code === null) return first[i];
    const below = [...anchors].reverse().find((a) => a.code < code && code - a.code <= 100);
    const above = anchors.find((a) => a.code > code && a.code - code <= 100);
    const extra: Evidence[] = [];
    let note: string | null = null;
    if (below && above && below.p.groupCode === above.p.groupCode) extra.push({ groupCode: below.p.groupCode, score: 0.5, rank: 4, phrase: `The codes either side (${below.code} and ${above.code}) are ${groupName(below.p.groupCode)}` });
    else if (below && above) note = `neighbours split between ${groupName(below.p.groupCode)} and ${groupName(above.p.groupCode)}`;
    else if (below || above) {
      const one = (below ?? above)!;
      extra.push({ groupCode: one.p.groupCode, score: 0.2, rank: 4, phrase: `The nearby code ${one.code} is ${groupName(one.p.groupCode)}` });
    }
    return extra.length === 0 && note === null ? first[i] : decide(r.account, r.n, [...r.evidence, ...extra], note);
  });
}

/**
 * Words that change what an account is. A name that only adds a qualifier (a currency, "main", "closed", a place, a number) is still the same account, but one
 * that adds one of these is a different one: "Salaries" is an expense and "Salaries payable" a liability. One list, the owner's to change. Plural forms are
 * listed because the assistant's normalise() spells out some abbreviations but does not reduce plurals.
 */
export const NATURE_WORDS: ReadonlySet<string> = new Set([
  "payable", "payables", "receivable", "receivables", "accrued", "accrual", "accruals", "prepaid", "prepayment", "prepayments", "accumulated", "depreciation", "amortisation",
  "provision", "provisions", "allowance", "allowances", "impairment", "expense", "expenses", "income", "revenue", "advance", "advances", "deposit", "deposits", "loan", "loans",
  "borrowing", "borrowings", "reserve", "reserves", "tax", "taxes", "vat", "payroll", "gratuity", "interest", "discount", "discounts", "return", "returns", "write", "off", "disposal", "disposals",
]);

/**
 * Is a name the same account as another? Used when a trial balance is imported again and a code arrives with a different name. Both names are
 * normalised (case, spacing, punctuation and abbreviations); they are the same if those are equal, or if all the content words of one are among the
 * content words of the other AND none of the extra words is one that changes the account's nature (NATURE_WORDS). So "Trade receivables" and "Trade
 * Receivables - AED" are one account, while "Salaries" and "Salaries payable", or "Rent" and "Prepaid rent", are not. The rule is the owner's to change.
 */
export function sameAccountName(a: string, b: string): boolean {
  const na = normalise(a);
  const nb = normalise(b);
  if (na === nb) return true;
  const ta = contentTokens(na);
  const tb = contentTokens(nb);
  if (ta.length === 0 || tb.length === 0) return false;
  // One name's words all appear in the other's, and the words the other adds are only qualifiers.
  const within = (small: string[], bigger: string[]) => small.every((t) => bigger.includes(t)) && bigger.filter((t) => !small.includes(t)).every((t) => !NATURE_WORDS.has(t));
  return within(ta, tb) || within(tb, ta);
}
