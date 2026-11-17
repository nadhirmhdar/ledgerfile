import { LinkButton } from "@/ui/button";

/** Shown inside the app header when a signed-in page calls notFound(), such as an engagement that does not exist or is not this firm's. */
export default function AppNotFound() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center py-16 text-center text-ink">
      <h1 className="text-2xl font-bold">Page not found</h1>
      <p className="mt-2 text-base text-ink-muted">There is nothing at this address. It may have been typed wrongly, or the engagement or page may no longer be there.</p>
      <div className="mt-6">
        <LinkButton href="/" variant="primary">
          Go to engagements
        </LinkButton>
      </div>
    </div>
  );
}
