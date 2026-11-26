import { ActionForm } from "@/app/action-form";
import { withdrawEqReviewAction } from "@/app/eq-review-actions";
import { EqSettingForm, EqSignForm } from "@/app/eq-review-forms";
import { eqSummary, type EqReview } from "@/domain/eq-review";
import type { Role } from "@/domain/signoff";
import { Badge } from "./badge";
import { Button } from "./button";
import { Section } from "./layout";

/**
 * The optional engagement quality review, with the team: one line saying whether it is on, who reviews and whether they have signed; the setting for a
 * partner or administrator; and the sign-off (or its withdrawal) for the named reviewer, on an open file.
 */
export function EqReviewSection({
  engagementId,
  review,
  userId,
  canSet,
  open,
  people,
  teamIds,
}: {
  engagementId: string;
  review: EqReview;
  userId: string;
  /** A partner or administrator, on an engagement that is open. */
  canSet: boolean;
  open: boolean;
  people: { id: string; name: string; role: Role }[];
  teamIds: string[];
}) {
  const named = open && review.required && review.reviewer?.id === userId;
  return (
    <Section title="Quality review" id="quality-review" description="An optional second reviewer who is not on the engagement team. When it is on, the file cannot be locked until they sign.">
      <div className="space-y-3">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={!review.required ? "neutral" : review.signed && !review.reviewerOnTeam ? "success" : "warning"}>{!review.required ? "Off" : review.signed && !review.reviewerOnTeam ? "Signed" : "Waiting"}</Badge>
          <span>{eqSummary(review)}</span>
        </p>
        {review.required && review.reviewerOnTeam && <p className="text-sm text-danger-strong">{review.reviewer?.name} is now on the engagement team, so cannot be its EQ reviewer. Choose another person.</p>}
        {review.signed?.note && <p className="whitespace-pre-line text-sm text-ink-muted">Note from {review.signed.by}: {review.signed.note}</p>}
        {named && !review.signed && (
          <div className="rounded-lg border border-border bg-surface p-4 shadow-card sm:p-6">
            <EqSignForm engagementId={engagementId} />
          </div>
        )}
        {named && review.signed && (
          <ActionForm action={withdrawEqReviewAction} fields={{ engagementId }}>
            <Button variant="secondary">Withdraw my sign-off</Button>
          </ActionForm>
        )}
        {canSet && (
          <div className="rounded-lg border border-border bg-surface p-4 shadow-card sm:p-6">
            <EqSettingForm engagementId={engagementId} required={review.required} reviewerId={review.reviewer?.id ?? null} people={people} teamIds={teamIds} />
          </div>
        )}
      </div>
    </Section>
  );
}
