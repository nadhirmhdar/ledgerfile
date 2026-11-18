import type { ProcedureState } from "../domain/firm-methodology";
import { canLock, type Role } from "../domain/signoff";
import type { Tone } from "./status";

/** The words of the firm methodology page. Pure. */

/** Who may change the firm's methodology: partner-level, the same as locking (the firm administrator counts). Everyone else reads it. */
export const canEditMethodology = (role: Role | string): boolean => canLock(role as Role);

export const DRAFT_LABEL_TITLE = "The library is an unreviewed AI draft.";
export const DRAFT_LABEL =
  "The procedures below come from a library that was drafted with AI and has not been reviewed. Check them against the standards and your firm's own policy before you rely on them. Any change your firm makes here is your firm's own responsibility.";

export const CHANGES_APPLY = "Changes apply to procedures loaded from now on. An engagement already in progress keeps the wording its procedures were loaded with, and a procedure that has work on it is never removed.";

/** The mark on a procedure whose wording the firm changed, wherever its text is shown. */
export const FIRM_WORDING_LABEL = "Your firm's wording";
export const FIRM_WORDING_NOTE = "Your firm's wording, not the library draft.";
/** Added to the draft notice when some procedures on the page are the firm's own: the notice still holds for the others. */
export const DRAFT_REST_NOTE = "Procedures marked \"Your firm's wording\" were reworded by your firm. This notice still applies to the rest.";

export const STATE_BADGE: Record<ProcedureState, { tone: Tone; label: string }> = {
  library: { tone: "neutral", label: "Library draft" },
  edited: { tone: "info", label: FIRM_WORDING_LABEL },
  hidden: { tone: "warning", label: "Hidden" },
};

export const PROTECTED_NOTE = "Part of the response to management override, a significant risk on every audit. It can be reworded but not hidden.";

/** "3 edited, 2 hidden" for an area, or "No changes". */
export function areaSummary(states: ProcedureState[]): string {
  const edited = states.filter((s) => s === "edited").length;
  const hidden = states.filter((s) => s === "hidden").length;
  if (edited === 0 && hidden === 0) return "No changes";
  return [edited > 0 ? `${edited} edited` : "", hidden > 0 ? `${hidden} hidden` : ""].filter(Boolean).join(", ");
}
