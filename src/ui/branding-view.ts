import { MAX_LOGO_PX, MIN_LOGO_PX } from "../domain/branding";

/** The words of the Firm page. Pure, so the limits it states are the ones the checks apply. */

export const BRANDING_SHOWN_ON = "Shown on the letters, statements and auditor's report you download.";

export const LOGO_HINT = `A PNG or JPEG image, at most 1 MB, between ${MIN_LOGO_PX} and ${MAX_LOGO_PX} pixels wide and high. Save a PNG without interlacing. The logo is kept privately and is only shown to people signed in to this firm.`;

/** Who sees the Firm link in the top bar. */
export const canManageFirm = (role: string): boolean => role === "admin";
