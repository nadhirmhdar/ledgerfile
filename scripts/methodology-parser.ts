// Reads the fieldwork procedures out of the methodology documents in docs/.
// Used by `npm run methodology` to write the library, and by a test that fails when
// the documents have been edited without regenerating it.
import { readFileSync } from "node:fs";

const SOURCES = ["docs/audit-methodology-library.md", "docs/methodology-C-fieldwork-higher-risk.md", "docs/methodology-C-fieldwork-other-areas.md"];
type Tier = "core" | "extended" | "significant";
const TIERS: Record<string, Tier> = { Core: "core", Ext: "extended", Extended: "extended", Sig: "significant", "Significant-risk": "significant" };
const ALL_ASSERTIONS = ["E", "C", "A", "V", "R", "CO", "CL", "P"];

interface Procedure {
  id: string;
  tier: Tier;
  assertions: string[];
  text: string;
  evidence: string;
  reference: string;
}
interface Area {
  code: string;
  title: string;
  objective: string;
  procedures: Procedure[];
}

const CHECKLIST_SOURCES = ["docs/methodology-A-D-E-acceptance-completion-reporting.md", "docs/methodology-B-planning.md"];
const STAGE_ORDER = ["A", "B", "D", "E"];

interface ChecklistItem {
  id: string;
  text: string;
  evidence: string;
  reference: string;
}
interface Checklist {
  code: string;
  title: string;
  /** A acceptance, B planning, D completion, E reporting. */
  stage: string;
  /** True for sections that apply only in some circumstances, such as first-year audits. */
  optional: boolean;
  items: ChecklistItem[];
}

/** The acceptance, planning, completion and reporting checklists. */
function buildChecklists(): Checklist[] {
  const lists = new Map<string, Checklist>();
  for (const file of CHECKLIST_SOURCES) {
    let list: Checklist | null = null;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const heading = line.match(/^## ([ABDE]\d+) (.+)$/);
      if (heading) {
        const optional = /\((if applicable|first-year audits)\)\s*$/.test(heading[2]);
        list = { code: heading[1], title: heading[2].trim(), stage: heading[1][0], optional, items: [] };
        lists.set(list.code, list);
        continue;
      }
      if (/^#{1,2} /.test(line)) {
        list = null;
        continue;
      }
      if (!list || !/^\| [ABDE]\d+\.\d+ \|/.test(line)) continue;
      const [id, text, evidence, reference] = line.split("|").slice(1, -1).map((c) => c.trim());
      if (!id.startsWith(list.code + ".")) throw new Error(`${file}: ${id} is listed under ${list.code}`);
      if (!text || !evidence || !reference) throw new Error(`${file}: ${id} has an empty column`);
      list.items.push({ id, text, evidence, reference });
    }
  }
  return [...lists.values()]
    .filter((l) => l.items.length > 0)
    .sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage) || Number(a.code.slice(1)) - Number(b.code.slice(1)));
}

export function buildLibrary(): { version: string; status: string; areas: Area[]; checklists: Checklist[] } {
  const areas = new Map<string, Area>();
  for (const file of SOURCES) {
    let area: Area | null = null;
    let headingTier: Tier | null = null;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const heading = line.match(/^## (?:\d+\. Sample area: )?(C\d+) (.+)$/);
      if (heading) {
        area = { code: heading[1], title: heading[2].trim(), objective: "", procedures: [] };
        areas.set(area.code, area);
        headingTier = null;
        continue;
      }
      if (/^## /.test(line)) {
        area = null;
        continue;
      }
      if (!area) continue;
      const objective = line.match(/^\*\*Audit objective:\*\* (.+)$/);
      if (objective) area.objective = objective[1].trim();
      const tierHeading = line.match(/^### (Core|Extended|Significant-risk) procedures/);
      if (tierHeading) headingTier = TIERS[tierHeading[1]];

      if (!/^\| C\d+\.\d+ \|/.test(line)) continue;
      const cells = line.split("|").slice(1, -1).map((c) => c.trim());
      // Six cells carry their own tier; five rely on the heading above the table.
      const [id, tierCell, assertionCell, text, evidence, reference] = cells.length === 6 ? cells : [cells[0], null, cells[1], cells[2], cells[3], cells[4]];
      const tier = tierCell ? TIERS[tierCell] : headingTier;
      if (!tier) throw new Error(`${file}: no tier for ${id}`);
      const assertions = assertionCell === "All" ? ALL_ASSERTIONS : assertionCell!.split(",").map((a) => a.trim());
      const unknown = assertions.filter((a) => !ALL_ASSERTIONS.includes(a));
      if (unknown.length > 0) throw new Error(`${file}: ${id} has unknown assertion ${unknown.join(", ")}`);
      if (!id!.startsWith(area.code + ".")) throw new Error(`${file}: ${id} is listed under ${area.code}`);
      if (!text || !evidence || !reference) throw new Error(`${file}: ${id} has an empty column`);
      area.procedures.push({ id: id!, tier, assertions, text: text!, evidence: evidence!, reference: reference! });
    }
  }

  const list = [...areas.values()].filter((a) => a.procedures.length > 0).sort((a, b) => Number(a.code.slice(1)) - Number(b.code.slice(1)));
  const checklists = buildChecklists();
  const ids = [...list.flatMap((a) => a.procedures.map((p) => p.id)), ...checklists.flatMap((c) => c.items.map((i) => i.id))];
  const duplicate = ids.find((id, i) => ids.indexOf(id) !== i);
  if (duplicate) throw new Error(`Procedure ${duplicate} appears twice.`);

  return {
    // The library's own version, which the firm's adoption record names. Change it when the content changes.
    version: "0.1",
    // Shown wherever the content is used, until a qualified person has reviewed and approved it.
    status: "AI draft v0.1: not reviewed, not approved for use on any engagement",
    areas: list,
    checklists,
  };
}
