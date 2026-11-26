import { ActionForm } from "@/app/action-form";
import { partnerApproveAction, partnerWithdrawAction } from "@/app/partner-approval-actions";
import { APPROVAL_KINDS, APPROVAL_LABEL, approvalWords, ASSIGN_PARTNER_FIRST, isCurrent, LOCK_CHECK_LABEL, type Approvals } from "@/domain/partner-approvals";
import { Badge } from "./badge";
import { Button } from "./button";
import { Section } from "./layout";

/**
 * The engagement partner's approval of acceptance and planning, beside the planning steps. A missing or stale approval is in the warning tone with words,
 * never colour alone; nothing but the final lock waits for it (owner decision B1). Only the engagement partner gets the buttons, on an open file.
 */
export function PartnerApprovalsSection({
  engagementId,
  approvals,
  partnerAssigned,
  isPartner,
  open,
}: {
  engagementId: string;
  approvals: Approvals;
  partnerAssigned: boolean;
  /** The signed-in person is the engagement partner and holds partner rights. */
  isPartner: boolean;
  open: boolean;
}) {
  return (
    <Section title="Partner approvals" id="partner-approvals" description={`The engagement partner approves acceptance and planning. Work carries on without them; the final lock needs both ("${LOCK_CHECK_LABEL}").`}>
      <ul className="divide-y divide-border rounded-lg border border-border bg-surface shadow-card">
        {APPROVAL_KINDS.map((kind) => {
          const a = approvals[kind];
          const current = isCurrent(a);
          return (
            <li key={kind} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <p className="min-w-24 font-medium text-ink">{APPROVAL_LABEL[kind]}</p>
              <div className="flex min-w-0 flex-1 basis-56 flex-wrap items-center gap-2">
                <Badge tone={current ? "success" : "warning"}>{current ? "Approved" : "Not approved"}</Badge>
                <span className="min-w-0 text-sm text-ink">{approvalWords(a)}</span>
              </div>
              {open && isPartner && (
                <div className="flex flex-wrap gap-2">
                  {!current && (
                    <ActionForm action={partnerApproveAction} fields={{ engagementId, approval: kind }}>
                      <Button variant="primary">{a ? `Approve ${kind} again` : `Approve ${kind}`}</Button>
                    </ActionForm>
                  )}
                  {a && (
                    <ActionForm action={partnerWithdrawAction} fields={{ engagementId, approval: kind }}>
                      <Button variant="secondary">Withdraw</Button>
                    </ActionForm>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {open && !partnerAssigned && <p className="mt-2 text-sm text-ink-muted">{ASSIGN_PARTNER_FIRST} The partner is set on the engagement&apos;s Team panel.</p>}
    </Section>
  );
}
