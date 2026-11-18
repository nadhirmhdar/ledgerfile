import type { Tx } from "./db";
import type { Session } from "./repo";
import * as repo from "./repo";
import * as audit from "./audit";
import { formatAmount } from "../domain/money";
import { getFileStore, type FileStore } from "./file-store";
import { loadBrandingForOutputs } from "./branding";
import { hasBranding, letterheadLines, type LogoImage } from "../domain/branding";
import {
  buildEngagementLetter,
  buildRepresentationLetter,
  longDate,
  type Block,
} from "../domain/letters";


export type LetterKind = "engagement" | "representation";
export const LETTER_KINDS: LetterKind[] = ["engagement", "representation"];

export interface LetterContext {
  clientName: string;
  periodEnd: string;
  framework: string;
  firmName: string;
  /** Which balances the client has, to suggest the representations that apply. */
  has: { inventory: boolean; receivables: boolean; tax: boolean };
  uncorrected: { description: string; amountMinor: number }[];
  /** True when the uncorrected misstatements reach overall materiality. */
  exceedsMateriality: boolean;
}

/** What the letters need to know about an engagement. Null when it does not exist, is another firm's, or is not being audited. */
export async function getLetterContext(tx: Tx, engagementId: string): Promise<LetterContext | null> {
  const engagement = await repo.getEngagement(tx, engagementId);
  if (!engagement) return null;
  const overview = await audit.getAuditOverview(tx, engagementId);
  if (!overview?.enabled) return null;
  const { rows } = await tx.query<{ framework: string; firmName: string }>(
    'select c.framework, f.name as "firmName" from clients c join firms f on f.id = c.firm_id where c.id = $1',
    [engagement.clientId],
  );
  if (rows.length === 0) return null;
  const groups = new Set((await repo.listAccounts(tx, engagementId)).map((a) => a.groupCode));
  return {
    clientName: engagement.clientName,
    periodEnd: engagement.periodEnd,
    framework: rows[0].framework,
    firmName: rows[0].firmName,
    has: { inventory: groups.has("INVENT"), receivables: groups.has("TRADEREC"), tax: groups.has("TAXEXP") || groups.has("TAXLIAB") },
    uncorrected: overview.misstatements.items.filter((m) => !m.corrected).map((m) => ({ description: m.description, amountMinor: m.amountMinor })),
    exceedsMateriality: overview.misstatements.exceedsMateriality,
  };
}

/** What the user typed on the letters page. Every field is optional: a blank one is left in the letter for completion in Word. */
export type LetterForm = Record<string, string | undefined>;

const MAX_FIELD = 400;
const MAX_SPECIFIC = 20;
const clean = (v: string | undefined) => v?.replace(/\s+/g, " ").trim().slice(0, MAX_FIELD) || undefined;
const date = (v: string | undefined) => (clean(v) ? longDate(clean(v)!) : undefined);

/**
 * Build a letter for an engagement, and record that it was produced. The engagement letter carries the firm's letterhead (its logo, address,
 * contact and registration lines) when the firm has set them; the representation letter is on the client's letterhead and never does.
 */
export async function generateLetter(
  tx: Tx,
  s: Session,
  engagementId: string,
  kind: LetterKind,
  form: LetterForm,
  store: () => FileStore = getFileStore,
): Promise<{ title: string; blocks: Block[]; context: LetterContext; logo: LogoImage | null } | null> {
  const context = await getLetterContext(tx, engagementId);
  if (!context) return null;
  const common = {
    "Firm name": context.firmName,
    "Client legal name": context.clientName,
    "period end": longDate(context.periodEnd),
    framework: context.framework,
    Date: date(form.date),
  };

  let blocks: Block[];
  let logo: LogoImage | null = null;
  if (kind === "engagement") {
    const branding = await loadBrandingForOutputs(tx, store);
    if (hasBranding(branding)) logo = branding.logo;
    const other = clean(form.otherServices);
    blocks = buildEngagementLetter({
      values: {
        ...common,
        Addressee: clean(form.addressee),
        "fieldwork period": clean(form.fieldwork),
        "target date": date(form.targetDate),
        "information date": date(form.informationDate),
        "fee and basis": clean(form.fee),
        "payment terms": clean(form.paymentTerms),
        "data location": clean(form.dataLocation),
        "description of other services": other,
        "Partner name": clean(form.partnerName),
      },
      otherServices: Boolean(other),
      aiFeatures: form.ai === "on",
      letterhead: hasBranding(branding) ? letterheadLines(branding) : undefined,
    });
  } else {
    const supporter = clean(form.supporter);
    const uncorrected = context.uncorrected.map((m) => ({ description: m.description, amount: formatAmount(m.amountMinor) }));
    if (uncorrected.length > 1) uncorrected.push({ description: "Net effect", amount: formatAmount(context.uncorrected.reduce((n, m) => n + m.amountMinor, 0)) });
    blocks = buildRepresentationLetter({
      values: {
        ...common,
        "engagement letter date": date(form.engagementLetterDate),
        "Supporter name": supporter,
        // The measure differs between frameworks, so it is left for the firm to complete unless it is the usual one.
        "the framework's measure": context.framework === "IFRS for SMEs" ? "estimated selling price less costs to complete and sell" : undefined,
      },
      uncorrected,
      exceedsMateriality: context.exceedsMateriality,
      ownerSupport: Boolean(supporter),
      inventory: form.inventory === "on",
      receivables: form.receivables === "on",
      tax: form.tax === "on",
      specific: (form.specific ?? "")
        .split(/\r?\n/)
        .map((line) => clean(line))
        .filter((line): line is string => Boolean(line))
        .slice(0, MAX_SPECIFIC),
    });
  }
  await repo.audit(tx, s, "export", `${kind}_letter`, engagementId, kind === "representation" && context.exceedsMateriality ? { exceedsMateriality: true } : undefined);
  const title = `${context.clientName} ${kind === "engagement" ? "engagement letter" : "management representation letter"} ${context.periodEnd}`;
  return { title, blocks, context, logo };
}
