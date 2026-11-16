import { ChevronDownIcon } from "./icons";

/**
 * The cue that a native <details> opens: a chevron that points right when closed and down when open. Put `group` on the <details> (`group/sub` and `nested` for one inside another)
 * and this at the start of its <summary>. The summary keeps its own keyboard and screen reader behaviour (Enter or Space, and
 * expanded or collapsed), and the page's one focus ring shows on it.
 */
export function SummaryChevron({ nested = false, className = "" }: { nested?: boolean; className?: string }) {
  // A <details> inside another one is the group "sub", so its chevron follows its own state and not the outer one's.
  const turn = nested ? "group-open/sub:rotate-0" : "group-open:rotate-0";
  return <ChevronDownIcon width={18} height={18} className={`shrink-0 -rotate-90 text-ink-muted transition-transform ${turn} motion-reduce:transition-none ${className}`} />;
}

/** The classes every summary of a section that opens shares: no default marker, a pointer, a comfortable height. */
export const summaryRow = "flex min-h-12 cursor-pointer list-none items-center gap-x-3 gap-y-1 rounded-lg px-4 py-2 [&::-webkit-details-marker]:hidden";
