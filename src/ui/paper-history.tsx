import type { PaperVersion } from "@/server/working-papers";
import { Disclosure } from "./controls";
import { fileSize } from "./papers-view";

/** "Version 2" for a paper that has been replaced; nothing for a first version. */
export const versionLabel = (version: number): string | null => (version > 1 ? `Version ${version}` : null);

/**
 * Every version of a working paper, newest first: its number, who uploaded it, when, its size, and a download link each. Shown only for a paper that has
 * been replaced. An earlier version is never offered a Remove button: it goes only after the newer ones do.
 */
export function PaperHistory({ engagementId, history }: { engagementId: string; history: PaperVersion[] }) {
  if (history.length < 2) return null;
  return (
    <Disclosure summary={`History, ${history.length} versions`} className="min-w-0">
      <ol aria-label="Versions" className="space-y-2 text-sm">
        {history.map((v) => (
          <li key={v.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-medium">Version {v.version}</span>
            {/* A plain link: the route streams the file and logs a download, so it must not be prefetched. */}
            <a href={`/engagements/${engagementId}/files/${v.id}`} className="min-w-0 break-all text-accent hover:underline">
              {v.fileName}
            </a>
            <span className="text-ink-muted">{v.uploadedByName}</span>
            <span className="text-ink-muted">{v.uploadedAt}</span>
            <span className="text-ink-muted">{fileSize(v.sizeBytes)}</span>
          </li>
        ))}
      </ol>
    </Disclosure>
  );
}
