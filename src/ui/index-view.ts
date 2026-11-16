import { countEntries, filterIndex, type Counts, type IndexEntry, type IndexFilter, type IndexSection, type WorkingPaperIndex } from "../domain/wp-index";
import { count } from "./text";

/**
 * How the working paper index is read: a search applied after the domain's own filter, the counts on the chips, which sections start
 * open, and the sentence under the title. Pure, from the index the page has already built.
 */

export const parseIndexSearch = (v: string | string[] | undefined): string => ((Array.isArray(v) ? v[0] : v) ?? "").trim().slice(0, 100);

const matches = (e: Pick<IndexEntry, "reference" | "title">, q: string) => {
  const t = q.trim().toLowerCase();
  return t === "" || (e.reference ?? "").toLowerCase().includes(t) || e.title.toLowerCase().includes(t);
};

/** The sections left by a search on reference or title, each with its counts worked out again, and those with no match dropped. */
export function searchSections(sections: IndexSection[], q: string): IndexSection[] {
  if (q.trim() === "") return sections;
  return sections
    .map((s) => {
      const entries = s.entries.filter((e) => matches(e, q));
      return { ...s, entries, counts: countEntries(entries) };
    })
    .filter((s) => s.entries.length > 0);
}

/** The sections a chip and a search leave: the domain's filter first, then the search. */
export function viewIndex(index: WorkingPaperIndex, filter: IndexFilter, q: string): { sections: IndexSection[]; shown: number; total: number } {
  const sections = searchSections(filterIndex(index, filter), q);
  return { sections, shown: sections.reduce((n, s) => n + s.entries.length, 0), total: index.overall.total };
}

/** Papers each chip would leave, with the search applied. */
export function chipCounts(index: WorkingPaperIndex, q: string): Record<IndexFilter, number> {
  const n = (f: IndexFilter) => viewIndex(index, f, q).shown;
  return { all: n("all"), unreviewed: n("unreviewed"), not_started: n("not_started") };
}

/**
 * Whether a section starts open. With a chip other than All, or a search, every section that has matches is open (the others are
 * not listed). With All and no search every section starts closed: its summary line already shows how many are reviewed and how
 * many are still to review.
 */
export function sectionOpen(_counts: Pick<Counts, "inProgress" | "prepared">, ctx: { filter: IndexFilter; q: string }): boolean {
  return ctx.filter !== "all" || ctx.q.trim() !== "";
}

/** "5 of 12 reviewed" for the whole file, or "3 shown" when a filter or search narrows it. */
export const sectionSummary = (counts: Pick<Counts, "reviewed" | "total">, narrowed: boolean): string => (narrowed ? `${counts.total} shown` : `${counts.reviewed} of ${counts.total} reviewed`);

/** "73 papers: 1 reviewed, 1 prepared, 2 in progress, 66 not started." */
export function indexSentence(o: Pick<Counts, "total" | "reviewed" | "prepared" | "inProgress" | "notStarted" | "notApplicable">): string {
  if (o.total === 0) return "No papers yet.";
  const parts = [o.reviewed > 0 && `${o.reviewed} reviewed`, o.prepared > 0 && `${o.prepared} prepared`, o.inProgress > 0 && `${o.inProgress} in progress`, o.notStarted > 0 && `${o.notStarted} not started`, o.notApplicable > 0 && `${o.notApplicable} not applicable`].filter(Boolean);
  return `${count(o.total, "paper")}: ${parts.join(", ")}.`;
}

export const indexResults = (shown: number, total: number): string => `Showing ${shown} of ${count(total, "paper")}.`;
