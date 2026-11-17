import Link from "next/link";
import { getDb } from "@/server/db";
import { getSession } from "@/server/session";
import { listTeam, MIN_PASSWORD_LENGTH, ROLES } from "@/server/auth";
import { AddUserForm } from "@/app/auth-forms";
import { ActionForm } from "@/app/action-form";
import { resetUserPasswordAction, setUserActiveAction, setUserRoleAction } from "@/app/auth-actions";
import { Badge, StatusBadge } from "@/ui/badge";
import { Button, buttonClass } from "@/ui/button";
import { Disclosure } from "@/ui/controls";
import { EmptyState } from "@/ui/feedback";
import { Input, Select } from "@/ui/form";
import { PageHeader } from "@/ui/layout";
import { OpenOnHash } from "@/ui/open-on-hash";
import { ChevronDownIcon } from "@/ui/icons";
import { ROLE_ORDER, roleLabel, roleSummary, teamControls, teamSentence } from "@/ui/team-view";

export const dynamic = "force-dynamic";

const ADD_ANCHOR = "add-person";
const group = "text-xs font-semibold tracking-wide text-ink-muted uppercase";

export default async function TeamPage() {
  const session = await getSession();
  const team = await listTeam(await getDb(), session.firmId);
  const admin = session.role === "admin";
  const onlyYou = team.length <= 1;

  return (
    <div className="py-8 text-ink">
      {admin && <OpenOnHash />}
      <PageHeader
        title="Team"
        meta={<span>{session.firmName}</span>}
        subtitle={teamSentence(team)}
        actions={
          admin ? (
            <a href={`#${ADD_ANCHOR}`} className={buttonClass("primary")}>
              Add a person
            </a>
          ) : undefined
        }
      />

      <div className="mt-6 space-y-6">
        {!admin && <p className="text-sm text-ink-muted">Only an administrator can add or manage people.</p>}

        <Disclosure summary="What each role can do">
          <dl className="grid gap-3 sm:grid-cols-2">
            {ROLE_ORDER.map((r) => (
              <div key={r}>
                <dt className="font-semibold text-ink">{roleLabel(r)}</dt>
                <dd className="text-sm text-ink-muted">{roleSummary(r)}</dd>
              </div>
            ))}
          </dl>
        </Disclosure>

        <ul className="divide-y divide-border rounded-lg border border-border bg-surface shadow-card">
          {team.map((u) => {
            const self = u.id === session.userId;
            const c = teamControls(session.role, self, u.active);
            return (
              <li key={u.id} className="px-4 py-3 sm:px-5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className={`font-semibold ${u.active ? "text-ink" : "text-ink-muted"}`}>{u.name}</span>
                  {self && <Badge tone="info">You</Badge>}
                  <span className="inline-flex items-center rounded-full bg-surface-muted px-2.5 py-0.5 text-sm font-medium whitespace-nowrap text-ink-muted">{roleLabel(u.role)}</span>
                  <StatusBadge status={u.active ? "done" : "not_started"} label={u.active ? "Active" : "Deactivated"} />
                </div>
                <p className="mt-0.5 min-w-0 text-sm break-words text-ink-muted">{u.email}</p>
                {!admin && <p className="mt-0.5 text-sm text-ink-muted">{roleSummary(u.role)}</p>}

                {c.manage && (
                  <details className="group mt-3">
                    <summary
                      aria-label={`Manage ${u.name}`}
                      className={`${buttonClass("secondary", "sm")} w-fit cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
                    >
                      Manage
                      <ChevronDownIcon className="transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="mt-3 grid gap-x-8 gap-y-5 rounded-lg border border-border bg-surface-muted/50 p-4 sm:grid-cols-2">
                      {c.roleForm && (
                        <div>
                          <h3 className={group}>Role</h3>
                          <p className="mt-1 text-sm text-ink-muted">{roleSummary(u.role)}</p>
                          <ActionForm action={setUserRoleAction} fields={{ userId: u.id }} className="mt-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <Select name="role" defaultValue={u.role} aria-label={`Role for ${u.name}`} className="w-auto capitalize">
                                {ROLES.map((r) => (
                                  <option key={r} value={r}>
                                    {r}
                                  </option>
                                ))}
                              </Select>
                              <Button variant="secondary">Save</Button>
                            </div>
                          </ActionForm>
                        </div>
                      )}

                      <div>
                        <h3 className={group}>Password</h3>
                        {c.resetForm && (
                          <>
                            <p className="mt-1 text-sm text-ink-muted">Setting a new password signs {u.name} out everywhere.</p>
                            <ActionForm action={resetUserPasswordAction} fields={{ userId: u.id }} className="mt-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <Input
                                  name="password"
                                  type="password"
                                  required
                                  minLength={MIN_PASSWORD_LENGTH}
                                  autoComplete="new-password"
                                  aria-label={`New password for ${u.name}`}
                                  placeholder="New password"
                                  className="w-full sm:w-52"
                                />
                                <Button variant="secondary">Reset</Button>
                              </div>
                            </ActionForm>
                          </>
                        )}
                        {c.useAccountPage && (
                          <p className="mt-1 text-sm text-ink-muted">
                            Change your password on the{" "}
                            <Link href="/account" className="font-medium text-accent hover:underline">
                              Account page
                            </Link>
                            .
                          </p>
                        )}
                      </div>

                      {(c.deactivate || c.reactivate) && (
                        <div className="border-t border-border pt-4 sm:col-span-2">
                          <h3 className={group}>Access</h3>
                          <p className="mt-1 text-sm text-ink-muted">
                            {c.deactivate
                              ? "A deactivated user is signed out and cannot sign in. Their sign-offs, review points and audit entries stay on the files."
                              : "Reactivating lets this person sign in again."}
                          </p>
                          <ActionForm action={setUserActiveAction} fields={{ userId: u.id, active: String(!u.active) }} className="mt-2">
                            <Button variant={c.deactivate ? "danger" : "secondary"} size="sm">
                              {c.deactivate ? "Deactivate" : "Reactivate"}
                            </Button>
                          </ActionForm>
                        </div>
                      )}
                    </div>
                  </details>
                )}
              </li>
            );
          })}
        </ul>

        {admin && onlyYou && (
          <EmptyState title="Just you so far" description="Add colleagues so work can be prepared and reviewed by different people." />
        )}

        {admin && (
          <Disclosure summary="Add a person" open={onlyYou}>
            <div id={ADD_ANCHOR} className="scroll-mt-4">
              <AddUserForm roles={ROLES} minPassword={MIN_PASSWORD_LENGTH} />
            </div>
          </Disclosure>
        )}
      </div>
    </div>
  );
}
