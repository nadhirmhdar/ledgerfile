"use client";

import { useState } from "react";
import { beginUploadAction, finishUploadAction } from "./papers-actions";
import { ProgressBar } from "@/ui/feedback";
import { clientFileProblem, phaseText, UPLOAD_CONTENT_TYPE, type UploadPhase } from "@/ui/upload-view";

/**
 * A working paper upload that sends the file straight to the private Blob store (hosted, FILE_STORE=vercel-blob only).
 *
 *   1. beginUploadAction  the server checks the file's name, size and purpose and returns the one key the browser may write
 *   2. upload()           the browser sends the file to that key with a short-lived token from /api/blob-upload
 *   3. finishUploadAction the server reads what arrived, checks it against the declaration and makes it a working paper
 *
 * The fields are the same ones the small-file form has (file, supports, description), passed as children, so the two forms look alike.
 * Nothing the browser holds is a blob URL: only the key. The server action revalidates the page, so the new file appears on its own.
 */
export function DirectUploadForm({ engagementId, fields, maxBytes, children, className }: { engagementId: string; fields: Record<string, string>; maxBytes: number; children: React.ReactNode; className?: string }) {
  const [phase, setPhase] = useState<UploadPhase | null>(null);
  const [percent, setPercent] = useState(0);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    const problem = clientFileProblem(file instanceof File ? file : null, maxBytes);
    if (problem || !(file instanceof File)) {
      setResult({ ok: false, message: problem ?? "Choose a file to upload." });
      return;
    }
    setResult(null);
    setPercent(0);
    setPhase("preparing");
    try {
      const begun = await beginUploadAction({ engagementId, supports: String(data.get("supports") ?? "engagement"), fileName: file.name, sizeBytes: file.size, description: String(data.get("description") ?? ""), replacesId: String(data.get("replacesId") ?? "") || undefined });
      if (!begun.ok) {
        setResult({ ok: false, message: begun.message });
        return;
      }
      setPhase("uploading");
      try {
        const { upload } = await import("@vercel/blob/client");
        await upload(begun.key, file, { access: "private", contentType: UPLOAD_CONTENT_TYPE, handleUploadUrl: "/api/blob-upload", onUploadProgress: (p) => setPercent(p.percentage) });
      } catch {
        setResult({ ok: false, message: "The upload did not complete. Try uploading the file again." });
        return;
      }
      setPhase("checking");
      const done = await finishUploadAction(begun.key);
      setResult(done);
      if (done.ok) form.reset();
    } catch {
      setResult({ ok: false, message: "The upload did not complete. Try uploading the file again." });
    } finally {
      setPhase(null);
    }
  }

  return (
    <form onSubmit={submit} className={className}>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <fieldset disabled={phase !== null} className="contents">
        {children}
      </fieldset>
      <div role="status" className={`mt-1 text-sm font-medium ${result ? (result.ok ? "text-success-strong" : "text-danger-strong") : "text-ink-muted"}`}>
        {phase && <p>{phaseText(phase, percent)}</p>}
        {!phase && result && <p>{result.message}</p>}
      </div>
      {phase === "uploading" && (
        <div className="mt-2 max-w-md">
          <ProgressBar value={percent} max={100} label="Upload progress" />
        </div>
      )}
    </form>
  );
}
