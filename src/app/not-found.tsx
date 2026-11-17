import { LinkButton } from "@/ui/button";
import { Wordmark } from "@/ui/auth-shell";

/** Shown for any address that matches nothing, and for a notFound() outside the signed-in app. It reads no session, so it renders signed out. */
export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-16 text-center text-ink">
      <p>
        <Wordmark />
      </p>
      <h1 className="mt-6 text-2xl font-bold">Page not found</h1>
      <p className="mt-2 text-base text-ink-muted">There is nothing at this address. It may have been typed wrongly, or the engagement or page may no longer be there.</p>
      <div className="mt-6">
        <LinkButton href="/" variant="primary">
          Go to engagements
        </LinkButton>
      </div>
    </main>
  );
}
