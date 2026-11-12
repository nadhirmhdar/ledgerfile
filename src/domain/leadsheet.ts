import { GROUPS } from "./groups";

export interface MappedAccount {
  code: string;
  name: string;
  closingMinor: number;
  priorMinor: number | null;
  /** Journal adjustments already included in closingMinor, shown for information. */
  adjustmentMinor?: number;
  /** null when the account has not been mapped yet. */
  groupCode: string | null;
}

export interface LeadSheet {
  groupCode: string;
  groupName: string;
  statement: string;
  section: string;
  accounts: MappedAccount[];
  closingMinor: number;
  priorMinor: number;
  varianceMinor: number;
  /** Percentage movement on the prior year; null when there is no prior balance. */
  variancePct: number | null;
}

export interface LeadSheetSet {
  sheets: LeadSheet[];
  unmapped: MappedAccount[];
  /** Lead sheet totals plus unmapped accounts. Must equal the trial balance total. */
  totalMinor: number;
  /** True when every account sits on exactly one lead sheet and the totals tie to the TB. */
  tiesToTrialBalance: boolean;
}

/** Build one lead sheet per group that has accounts, in statement order. */
export function buildLeadSheets(accounts: MappedAccount[]): LeadSheetSet {
  const byGroup = new Map<string, MappedAccount[]>();
  const unmapped: MappedAccount[] = [];
  for (const account of accounts) {
    if (!account.groupCode) {
      unmapped.push(account);
      continue;
    }
    const list = byGroup.get(account.groupCode) ?? [];
    list.push(account);
    byGroup.set(account.groupCode, list);
  }

  const sheets: LeadSheet[] = [];
  for (const group of [...GROUPS].sort((a, b) => a.sort - b.sort)) {
    const list = byGroup.get(group.code);
    if (!list) continue;
    byGroup.delete(group.code);
    const closing = list.reduce((s, a) => s + a.closingMinor, 0);
    const prior = list.reduce((s, a) => s + (a.priorMinor ?? 0), 0);
    sheets.push({
      groupCode: group.code,
      groupName: group.name,
      statement: group.statement,
      section: group.section,
      accounts: list.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })),
      closingMinor: closing,
      priorMinor: prior,
      varianceMinor: closing - prior,
      variancePct: prior === 0 ? null : ((closing - prior) / Math.abs(prior)) * 100,
    });
  }
  // Accounts pointing at a group code that no longer exists are treated as unmapped.
  for (const orphaned of byGroup.values()) unmapped.push(...orphaned);

  const tbTotal = accounts.reduce((s, a) => s + a.closingMinor, 0);
  const totalMinor = sheets.reduce((s, sh) => s + sh.closingMinor, 0) + unmapped.reduce((s, a) => s + a.closingMinor, 0);
  const counted = sheets.reduce((n, sh) => n + sh.accounts.length, 0) + unmapped.length;
  return { sheets, unmapped, totalMinor, tiesToTrialBalance: totalMinor === tbTotal && counted === accounts.length };
}
