import { AREA_BY_CODE, AREAS, CHECKLIST_BY_CODE, CHECKLISTS } from "./audit";

/**
 * Assignment by area: an audit area (a fieldwork area such as C5, or a checklist such as B2) may have its own preparer and its own reviewer, in place
 * of the engagement's. Pure: the server, the Team panel, the audit pages and My work use the same words and the same rule.
 *
 * "Same as the engagement" is no row, or a row whose column is empty. An override is a current setting, not a record: the audit log keeps the history.
 */

export const SAME_AS_ENGAGEMENT = "Same as the engagement";
export const AREA_REFUSAL = "Choose one of the audit areas.";

/** The areas that can be assigned: the fieldwork areas, then the checklists. */
export const ASSIGNABLE_AREAS: { code: string; title: string }[] = [...AREAS.map((a) => ({ code: a.code, title: a.title })), ...CHECKLISTS.map((c) => ({ code: c.code, title: c.title }))];

export const isAssignableArea = (code: string): boolean => AREA_BY_CODE.has(code) || CHECKLIST_BY_CODE.has(code);
export const areaTitle = (code: string): string => AREA_BY_CODE.get(code)?.title ?? CHECKLIST_BY_CODE.get(code)?.title ?? code;

/** An area's own team: null in a place means the engagement's own person. */
export interface AreaTeam {
  preparerId: string | null;
  reviewerId: string | null;
}

/** Who prepares and who reviews an area: its own person where one is set, else the engagement's. */
export function effectiveTeam(area: AreaTeam | undefined, engagement: { preparerId: string | null; reviewerId: string | null }): AreaTeam {
  return { preparerId: area?.preparerId ?? engagement.preparerId, reviewerId: area?.reviewerId ?? engagement.reviewerId };
}

/** The assignee to show beside an area's name: only the places where the area's own person is not the engagement's. */
export function differingAssignees<P extends { id: string }>(area: { preparer: P | null; reviewer: P | null } | undefined, engagement: { preparerId: string | null; reviewerId: string | null }): { preparer: P | null; reviewer: P | null } {
  return {
    preparer: area?.preparer && area.preparer.id !== engagement.preparerId ? area.preparer : null,
    reviewer: area?.reviewer && area.reviewer.id !== engagement.reviewerId ? area.reviewer : null,
  };
}
