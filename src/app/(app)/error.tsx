"use client";

import { useEffect } from "react";
import { Button, LinkButton } from "@/ui/button";

/** Shown inside the app header when a page fails to render. It never prints the error's own message: the reference is what support matches to the server log. */
export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const digest = typeof (error as { digest?: unknown } | null)?.digest === "string" ? (error as { digest: string }).digest : null;
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center py-16 text-center text-ink">
      <h1 className="text-2xl font-bold">Something went wrong</h1>
      <p className="mt-2 text-base text-ink-muted">This page could not be shown. Try again, or go back to your engagements.</p>
      {digest && <p className="mt-2 text-sm text-ink-muted">Reference: {digest}</p>}
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button variant="secondary" onClick={() => retry()}>
          Try again
        </Button>
        <LinkButton href="/" variant="ghost">
          Go to engagements
        </LinkButton>
      </div>
    </div>
  );
}
