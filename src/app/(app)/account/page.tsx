import { getSession } from "@/server/session";
import { MIN_PASSWORD_LENGTH } from "@/server/auth";
import { ActionForm } from "@/app/action-form";
import { changePasswordAction } from "@/app/auth-actions";
import { Button } from "@/ui/button";
import { Callout } from "@/ui/feedback";
import { Field, Input } from "@/ui/form";
import { Card, Fact, PageHeader, Section } from "@/ui/layout";
import { roleLabel, roleSummary } from "@/ui/team-view";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const session = await getSession();
  const details: [string, string, string?][] = [
    ["Name", session.name],
    ["Email", session.email],
    ["Role", roleLabel(session.role), roleSummary(session.role)],
    ["Firm", session.firmName],
  ];
  return (
    <div className="py-8 text-ink">
      <PageHeader title="Account" meta={<Fact label="Firm">{session.firmName}</Fact>} />

      <div className="mt-6 max-w-xl space-y-8">
        <Card title="Your details">
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[7rem_1fr]">
            {details.map(([term, value, hint]) => (
              <div key={term} className="grid grid-cols-subgrid sm:col-span-2">
                <dt className="text-sm text-ink-muted">{term}</dt>
                <dd className="min-w-0 break-words text-ink">
                  {value}
                  {hint && <span className="block text-sm text-ink-muted">{hint}</span>}
                </dd>
              </div>
            ))}
          </dl>
        </Card>

        <Section title="Change password">
          <Callout variant="info">You will be signed out everywhere and asked to sign in with the new password.</Callout>
          <ActionForm action={changePasswordAction} fields={{}} className="mt-4">
            <div className="flex flex-col gap-4">
              <Field label="Current password">
                <Input name="current" type="password" required autoComplete="current-password" />
              </Field>
              <Field label={`New password (at least ${MIN_PASSWORD_LENGTH} characters)`}>
                <Input name="password" type="password" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" />
              </Field>
              <Field label="Confirm new password">
                <Input name="confirm" type="password" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" />
              </Field>
              <div>
                <Button variant="primary">Change password</Button>
              </div>
            </div>
          </ActionForm>
        </Section>
      </div>
    </div>
  );
}
