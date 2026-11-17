/** The words of a direct upload, pure so they can be tested: what the form says at each step, and the check made before anything is sent. */

export type UploadPhase = "preparing" | "uploading" | "checking";

export const megabytes = (bytes: number): string => `${Math.round(bytes / 1024 / 1024)} MB`;

/** What the status line says while the file is on its way. */
export function phaseText(phase: UploadPhase, percent = 0): string {
  switch (phase) {
    case "preparing":
      return "Preparing the upload.";
    case "uploading":
      return `Uploading, ${Math.max(0, Math.min(100, Math.round(percent)))}% sent.`;
    case "checking":
      return "Upload complete. Checking the file.";
  }
}

/** The check made in the browser before anything is sent; the server checks again. Null when the file may go. */
export function clientFileProblem(file: { size: number } | null | undefined, maxBytes: number): string | null {
  if (!file || file.size === 0) return "Choose a file to upload.";
  if (file.size > maxBytes) return `The file is larger than ${megabytes(maxBytes)}.`;
  return null;
}

/** The size hint under an upload form. Spreadsheet imports stay at the smaller limit because the server reads them. */
export function uploadHint(opts: { direct: boolean; limitLabel: string; importLabel: string; types: string[] }): string {
  const types = `Accepted types: ${opts.types.join(", ")}.`;
  return opts.direct ? `Up to ${opts.limitLabel}. ${types} Spreadsheet imports (trial balances, journals and schedules) stay at ${opts.importLabel}.` : `Up to ${opts.limitLabel}. ${types}`;
}

/**
 * Every direct upload is stored as this type, whatever the file's name says: the browser asks for it and the token allows only it. The
 * download route sends every file as an attachment of this type too, so a file is never displayed or run in the page.
 */
export const UPLOAD_CONTENT_TYPE = "application/octet-stream";
