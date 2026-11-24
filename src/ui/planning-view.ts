import type { Verdict } from "../domain/planning";

/** The words of the planning assistant and the firm's planning settings. Pure. All of it is an unreviewed draft, and standards are cited by number only. */

export const PLANNING_DRAFT_TITLE = "Planning assistant: an unreviewed draft";
export const PLANNING_DRAFT =
  "The figures come from the adjusted trial balance. The rules, the wording and the default percentages and thresholds are an unreviewed draft: check them against the standards and your firm's policy before you rely on them. Nothing here is saved or confirmed. Set materiality and rate the areas with the forms on this page.";

export const SETTINGS_DRAFT =
  "These are the firm's planning settings. The guide ranges for the percentage of each benchmark, the performance range and the trivial maximum are the values materiality has always warned against. The rest are draft defaults, unreviewed: the firm's own policy should replace them. A change affects the suggestions and the guide warnings from now on; it does not change any materiality already set.";

export const VERDICT_LABEL: Record<Verdict, string> = { significant: "Suggested significant", not_significant: "Suggested not significant", judgement: "A judgement for the team" };
export const NOT_SAVED = "Saves nothing: confirm with the forms on this page.";

export const canEditPlanningSettings = (role: string): boolean => role === "partner" || role === "admin";
