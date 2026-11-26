import { differingAssignees } from "@/domain/area-assignments";
import type { AreaAssignment } from "@/server/area-assignments";

/**
 * "Preparer: name" and "Reviewer: name" beside an area's name, only where the area's own person is not the engagement's (so an area with no override
 * shows nothing, and the page reads as it always did). Two spans, never a joined string, so each wraps on its own at 390 px.
 */
export function AreaAssignees({ area, engagement, className = "" }: { area: AreaAssignment | undefined; engagement: { preparerId: string | null; reviewerId: string | null }; className?: string }) {
  const own = differingAssignees(area, engagement);
  if (!own.preparer && !own.reviewer) return null;
  return (
    <span className={`flex flex-wrap items-center gap-x-3 gap-y-0.5 text-small text-ink-muted ${className}`}>
      {own.preparer && (
        <span>
          Preparer: <span className="font-medium text-ink">{own.preparer.name}</span>
        </span>
      )}
      {own.reviewer && (
        <span>
          Reviewer: <span className="font-medium text-ink">{own.reviewer.name}</span>
        </span>
      )}
    </span>
  );
}
