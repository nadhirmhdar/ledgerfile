import type { ThreadReply } from "@/server/review";

/** A review point's replies, oldest first: who, when, and the words. An older single response shows as the first reply, with plain words in place of a date. */
export function Thread({ thread }: { thread: ThreadReply[] }) {
  if (thread.length === 0) return null;
  return (
    <ol aria-label="Replies" className="mt-3 space-y-2">
      {thread.map((r) => (
        <li key={r.id} className="min-w-0 border-l-2 border-border-strong pl-3 text-sm">
          <p className="flex flex-wrap gap-x-3 text-ink-muted">
            <span>{r.authorName}</span>
            <span>{r.writtenAt ?? "earlier response, date not recorded"}</span>
          </p>
          <p className="break-words">{r.body}</p>
        </li>
      ))}
    </ol>
  );
}
