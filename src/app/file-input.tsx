"use client";

/**
 * A file picker that refuses an oversized file in the browser, before it is sent.
 * Without this, a file over the server's request limit fails with a generic error
 * instead of a message the user can act on. The server checks the size again.
 */
export function FileInput({ maxBytes, accept, label, className }: { maxBytes: number; accept: string; label?: string; className?: string }) {
  return (
    <input
      type="file"
      name="file"
      required
      accept={accept}
      aria-label={label}
      className={className}
      onChange={(e) => {
        const file = e.currentTarget.files?.[0];
        e.currentTarget.setCustomValidity(file && file.size > maxBytes ? `That file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB. Split or compress it and try again.` : "");
        e.currentTarget.reportValidity();
      }}
    />
  );
}
