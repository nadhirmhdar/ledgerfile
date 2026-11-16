import { getDb } from "@/server/db";
import { getSession } from "@/server/session";
import { listTeam, MIN_PASSWORD_LENGTH, ROLES } from "@/server/auth";
import { AddUserForm } from "@/app/auth-forms";
import { ActionForm } from "@/app/action-form";
import { resetUserPasswordAction, setUserActiveAction, setUserRoleAction } from "@/app/auth-actions";

export const dynamic = "force-dynamic";

const input = "rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900";
const small = "rounded border border-slate-400 px-2 py-1 text-xs hover:bg-slate-100";

export default async function TeamPage() {
  const session = await getSession();
  const team = await listTeam(await getDb(), session.firmId);
  const admin = session.role === "admin";

  return (
    <div className="py-8 text-slate-900">
      <h1 className="text-2xl font-semibold">Team</h1>
      <p className="mt-1 text-sm text-slate-600">{session.firmName}</p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-300 text-slate-600">
            <tr>
              <th className="py-2 font-medium">Name</th>
              <th className="py-2 font-medium">Email</th>
              <th className="py-2 font-medium">Role</th>
              <th className="py-2 font-medium">Status</th>
              {admin && <th className="py-2 font-medium">Reset password</th>}
            </tr>
          </thead>
          <tbody>
            {team.map((u) => {
              const self = u.id === session.userId;
              return (
                <tr key={u.id} className={`border-b border-slate-200 align-top ${u.active ? "" : "text-slate-500"}`}>
                  <td className="py-2">
                    {u.name}
                    {self && <span className="ml-2 text-xs text-slate-600">(you)</span>}
                  </td>
                  <td className="py-2">{u.email}</td>
                  <td className="py-2">
                    {admin ? (
                      <ActionForm action={setUserRoleAction} fields={{ userId: u.id }}>
                        <div className="flex gap-2">
                          <select name="role" defaultValue={u.role} aria-label={`Role for ${u.name}`} className={`${input} capitalize`}>
                            {ROLES.map((r) => (
                              <option key={r} value={r}>{r}</option>
                            ))}
                          </select>
                          <button className={small}>Save</button>
                        </div>
                      </ActionForm>
                    ) : (
                      <span className="capitalize">{u.role}</span>
                    )}
                  </td>
                  <td className="py-2">
                    <span>{u.active ? "Active" : "Deactivated"}</span>
                    {admin && !self && (
                      <ActionForm action={setUserActiveAction} fields={{ userId: u.id, active: String(!u.active) }} className="mt-1">
                        <button className={small}>{u.active ? "Deactivate" : "Reactivate"}</button>
                      </ActionForm>
                    )}
                  </td>
                  {admin && (
                    <td className="py-2">
                      {self ? (
                        <span className="text-xs text-slate-600">Use the Account page</span>
                      ) : (
                        <ActionForm action={resetUserPasswordAction} fields={{ userId: u.id }}>
                          <div className="flex gap-2">
                            <input name="password" type="password" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" aria-label={`New password for ${u.name}`} placeholder="New password" className={`${input} w-40`} />
                            <button className={small}>Reset</button>
                          </div>
                        </ActionForm>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-600">
        A deactivated user is signed out and cannot sign in. Their sign-offs, review points and audit entries stay on the files.
      </p>

      <section className="mt-8 rounded border border-slate-200 bg-slate-50 p-4">
        <h2 className="text-base font-semibold">Add a user</h2>
        {admin ? (
          <div className="mt-3">
            <AddUserForm roles={ROLES} minPassword={MIN_PASSWORD_LENGTH} />
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-600">Only an administrator can add or manage users.</p>
        )}
      </section>
    </div>
  );
}
