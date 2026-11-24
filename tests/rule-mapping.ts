// The keyword-rule suggester the app used before the mapping assistant. Kept for tests that need a quick mapping of a trial balance.
import { GROUPS } from "../src/domain/groups";

type MappingSource = "prior_year" | "rule" | "ai" | "manual" | "assistant";

export interface MappingSuggestion {
  accountCode: string;
  groupCode: string;
  source: MappingSource;
  /** 0 to 1. Prior-year reuse is 1; rule matches are lower and need review. */
  confidence: number;
}

export interface AccountToMap {
  code: string;
  name: string;
  closingMinor: number;
}

/**
 * A mapping suggester. The rule-based one below is the fallback; an AI-backed
 * implementation can be swapped in behind the same signature.
 */
export type Suggester = (accounts: AccountToMap[]) => Promise<MappingSuggestion[]> | MappingSuggestion[];

/** Keyword match on the account name. Longer keyword hits are more specific, so they win. */
export function suggestByRule(account: AccountToMap): MappingSuggestion | null {
  const name = account.name.toLowerCase();
  let best: { groupCode: string; length: number } | null = null;
  for (const group of GROUPS) {
    for (const keyword of group.keywords) {
      if (name.includes(keyword) && (!best || keyword.length > best.length)) {
        best = { groupCode: group.code, length: keyword.length };
      }
    }
  }
  if (!best) return null;
  // A short generic hit such as "expense" or "bank" is weaker evidence than "end of service".
  const confidence = best.length >= 12 ? 0.8 : best.length >= 7 ? 0.65 : 0.5;
  return { accountCode: account.code, groupCode: best.groupCode, source: "rule", confidence };
}

/**
 * Propose a group for every account.
 * 1. An account code mapped last year keeps last year's group.
 * 2. Otherwise the rule-based suggester proposes one.
 * Accounts with no suggestion are returned in `unmapped` for the preparer.
 */
export function proposeMappings(
  accounts: AccountToMap[],
  priorYear: Map<string, string>,
): { suggestions: MappingSuggestion[]; unmapped: string[] } {
  const suggestions: MappingSuggestion[] = [];
  const unmapped: string[] = [];
  for (const account of accounts) {
    const prior = priorYear.get(account.code);
    if (prior) {
      suggestions.push({ accountCode: account.code, groupCode: prior, source: "prior_year", confidence: 1 });
      continue;
    }
    const rule = suggestByRule(account);
    if (rule) suggestions.push(rule);
    else unmapped.push(account.code);
  }
  return { suggestions, unmapped };
}
