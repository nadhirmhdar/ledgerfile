import { getDb } from "@/server/db";
import { getSession } from "@/server/session";
import { listTeam, MIN_PASSWORD_LENGTH, ROLES } from "@/server/auth";
import { AddUserForm } from "@/app/auth-forms";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const session = await getSession();
  const team = await listTeam(await getDb(), session.firmId);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 text-slate-900">
      <h1 className="text-2xl font-semibold">Team</h1>
      <p className="mt-1 text-sm text-slate-600">{session.firmName}</p>

      <table className="mt-4 w-full text-left text-sm">
        <thead className="border-b border-slate-300 text-slate-600">
          <tr>
            <th className="py-2 font-medium">Name</th>
            <th className="py-2 font-medium">Email</th>
            <th className="py-2 font-medium">Role</th>
          </tr>
        </thead>
        <tbody>
          {team.map((u) => (
            <tr key={u.id} className="border-b border-slate-200">
              <td className="py-2">
                {u.name}
                {u.id === session.userId && <span className="ml-2 text-xs text-slate-600">(you)</span>}
              </td>
              <td className="py-2">{u.email}</td>
              <td className="py-2 capitalize">{u.role}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="mt-8 rounded border border-slate-200 bg-slate-50 p-4">
        <h2 className="text-base font-semibold">Add a user</h2>
        {session.role === "admin" ? (
          <div className="mt-3">
            <AddUserForm roles={ROLES} minPassword={MIN_PASSWORD_LENGTH} />
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-600">Only an administrator can add users.</p>
        )}
      </section>
    </main>
  );
}
