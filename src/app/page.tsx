import Link from "next/link";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import * as repo from "@/server/repo";
import { NewClientForm, NewEngagementForm } from "./forms";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getSession();
  const { clients, engagements } = await withFirm(await getDb(), session.firmId, async (tx) => ({
    clients: await repo.listClients(tx),
    engagements: await repo.listEngagements(tx),
  }));

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 text-slate-900">
      <h1 className="text-2xl font-semibold">LedgerFile</h1>
      <p className="mt-1 text-sm text-slate-600">Demo firm. Sign-in is not built yet, so everyone using this copy shares one firm.</p>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Engagements</h2>
        {engagements.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">No engagements yet. Add a client, then create an engagement for it.</p>
        ) : (
          <table className="mt-3 w-full text-left text-sm">
            <thead className="border-b border-slate-300 text-slate-600">
              <tr>
                <th className="py-2 font-medium">Client</th>
                <th className="py-2 font-medium">Period</th>
                <th className="py-2 font-medium">Status</th>
                <th className="py-2 font-medium">Prior year linked</th>
              </tr>
            </thead>
            <tbody>
              {engagements.map((e) => (
                <tr key={e.id} className="border-b border-slate-200">
                  <td className="py-2">
                    <Link href={`/engagements/${e.id}`} className="font-medium text-blue-700 underline">{e.clientName}</Link>
                  </td>
                  <td className="py-2">{e.periodStart} to {e.periodEnd}</td>
                  <td className="py-2 capitalize">{e.status}</td>
                  <td className="py-2">{e.priorEngagementId ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="mt-8 rounded border border-slate-200 bg-slate-50 p-4">
        <h2 className="text-base font-semibold">New engagement</h2>
        <div className="mt-3">
          {clients.length === 0 ? <p className="text-sm text-slate-600">Add a client first.</p> : <NewEngagementForm clients={clients} />}
        </div>
      </section>

      <section className="mt-4 rounded border border-slate-200 bg-slate-50 p-4">
        <h2 className="text-base font-semibold">New client</h2>
        <div className="mt-3">
          <NewClientForm />
        </div>
      </section>
    </main>
  );
}
