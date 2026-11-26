import { beginImportAction, type BeginImport } from "./import-upload-actions";
import { UPLOAD_CONTENT_TYPE } from "@/ui/upload-view";

/** The browser's part of a large import: ask for a key, send the file straight to the private store, and hand the key back for the action to use. */
export async function uploadForImport(file: File, what: Omit<BeginImport, "fileName" | "sizeBytes">): Promise<{ ok: true; key: string } | { ok: false; message: string }> {
  const failed = { ok: false as const, message: "The upload did not complete. Try choosing the file again." };
  try {
    const begun = await beginImportAction({ ...what, fileName: file.name, sizeBytes: file.size });
    if (!begun.ok) return begun;
    const { upload } = await import("@vercel/blob/client");
    await upload(begun.key, file, { access: "private", contentType: UPLOAD_CONTENT_TYPE, handleUploadUrl: "/api/blob-upload" });
    return { ok: true, key: begun.key };
  } catch {
    return failed;
  }
}
