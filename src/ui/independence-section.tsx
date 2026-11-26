import { ConcludeIndependenceForm, ConfirmIndependenceForm } from "@/app/independence-forms";
import { CONCLUSION_LABEL, confirmationKey, STAGE_LABEL, STAGES, statusWords, type Independence, type Stage } from "@/domain/independence";
import { Section } from "./layout";

/**
 * Independence, under the team: each team member's planning and completion status, any threats noted with their safeguards, the partner's conclusion
 * for each stage, and, on an open file, the forms for the signed-in person (their own confirmation) and the engagement partner (the conclusion).
 */
export function IndependenceSection({ engagementId, data, userId, open }: { engagementId: string; data: Independence; userId: string; open: boolean }) {
  const onTeam = data.members.some((m) => m.id === userId);
  const isPartner = data.partnerId === userId;
  const firstMissing = (has: (s: Stage) => boolean): Stage => STAGES.find((s) => !has(s)) ?? "completion";
  return (
    <Section title="Independence" id="independence" description="Each person on the team confirms for themselves at planning and again at completion, and the engagement partner concludes. Nothing carries to a later year.">
      <div className="space-y-4">
        {data.members.length === 0 ? (
          <p className="text-sm text-ink-muted">Assign the team above: the people on it confirm here.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface shadow-card">
            {data.members.map((m) => (
              <li key={m.id} className="px-4 py-3">
                <p className="font-medium text-ink">
                  {m.name} <span className="font-normal text-ink-muted">({m.places.join(", ")})</span>
                </p>
                <dl className="mt-1 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
                  {STAGES.map((s) => {
                    const c = data.latest.get(confirmationKey(m.id, s));
                    return (
                      <div key={s} className="min-w-0">
                        <div className="flex flex-wrap gap-x-2 text-sm">
                          <dt className="text-ink-subtle">{STAGE_LABEL[s]}</dt>
                          <dd className={c ? "font-medium text-ink" : "text-ink-muted"}>{statusWords(c)}</dd>
                        </div>
                        {c?.outcome === "threats_noted" && (
                          <div className="mt-1 text-small text-ink-muted">
                            <p className="whitespace-pre-line">Threats: {c.threats}</p>
                            <p className="whitespace-pre-line">Safeguards: {c.safeguards}</p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </dl>
              </li>
            ))}
          </ul>
        )}

        <div className="rounded-lg border border-border bg-surface px-4 py-3 shadow-card">
          <h3 className="text-sm font-semibold text-ink">Partner&apos;s conclusion</h3>
          <dl className="mt-1 space-y-2">
            {STAGES.map((s) => {
              const c = data.conclusions[s];
              return (
                <div key={s} className="text-sm">
                  <dt className="text-ink-subtle">{STAGE_LABEL[s]}</dt>
                  <dd className="text-ink">
                    {c ? (
                      <>
                        <span className="font-medium">{CONCLUSION_LABEL[c.conclusion]}</span> <span className="text-ink-muted">({c.by}, {c.at})</span>
                        <span className="block whitespace-pre-line text-ink-muted">{c.note}</span>
                      </>
                    ) : (
                      <span className="text-ink-muted">Not concluded</span>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>

        {open && onTeam && (
          <div className="rounded-lg border border-border bg-surface p-4 shadow-card sm:p-6">
            <h3 className="mb-3 text-sm font-semibold text-ink">Your confirmation</h3>
            <ConfirmIndependenceForm engagementId={engagementId} firstStage={firstMissing((s) => data.latest.has(confirmationKey(userId, s)))} />
          </div>
        )}
        {open && isPartner && (
          <div className="rounded-lg border border-border bg-surface p-4 shadow-card sm:p-6">
            <h3 className="mb-3 text-sm font-semibold text-ink">Record the conclusion</h3>
            <ConcludeIndependenceForm engagementId={engagementId} firstStage={firstMissing((s) => !!data.conclusions[s])} />
          </div>
        )}
      </div>
    </Section>
  );
}
