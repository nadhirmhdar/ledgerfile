import { ActionForm } from "./action-form";
import { DirectUploadForm } from "./direct-upload-form";
import { uploadWorkingPaperAction } from "./papers-actions";
import { workingPaperLimit } from "@/server/direct-upload";

/**
 * The working paper upload form. On a hosted deployment with a Blob store (and its read-write token) the file goes straight from the
 * browser to Blob and may be up to the direct limit; everywhere else it goes through the server action at the smaller limit, exactly
 * as before. The fields inside are the same either way.
 */
export function UploadForm({ engagementId, fields = {}, className, children }: { engagementId: string; fields?: Record<string, string>; className?: string; children: React.ReactNode }) {
  const limit = workingPaperLimit();
  const all = { engagementId, ...fields };
  if (limit.direct) {
    return (
      <DirectUploadForm engagementId={engagementId} fields={all} maxBytes={limit.bytes} className={className}>
        {children}
      </DirectUploadForm>
    );
  }
  return (
    <ActionForm action={uploadWorkingPaperAction} fields={all} className={className}>
      {children}
    </ActionForm>
  );
}
