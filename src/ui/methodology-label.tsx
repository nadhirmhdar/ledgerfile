import type { ReactNode } from "react";
import { ADOPTED_NOTE, adoptedLabel, type AdoptionState } from "@/domain/methodology-adoption";
import { Callout } from "./feedback";

/**
 * The label on methodology PROCEDURE content (the library status shown with procedures). While the firm's adoption is current it is the adopted line;
 * in every other state (not adopted, withdrawn, or changed since) it is the draft label the page passes, exactly as before. Used by the four places that
 * show the library status; no other draft label in the application goes through it.
 */
export function MethodologyLabel({ state, draft }: { state: AdoptionState; draft: ReactNode }) {
  const label = adoptedLabel(state);
  if (label === null) return <>{draft}</>;
  return (
    <Callout variant="info" title={label}>
      {ADOPTED_NOTE}
    </Callout>
  );
}
