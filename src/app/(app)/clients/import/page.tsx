import { notFound } from "next/navigation";
import { getSession } from "@/server/session";
import { canCreateClient } from "@/domain/permissions";
import { PageHeader } from "@/ui/layout";
import { ImportClients } from "./import-clients";

export const dynamic = "force-dynamic";

/** Import a client list. Only someone who may add a client sees it; anyone else gets a plain 404, as if the page were not there. */
export default async function ImportClientsPage() {
  const session = await getSession();
  if (!canCreateClient(session.role)) notFound();
  return (
    <div className="py-8 text-ink">
      <PageHeader
        breadcrumb={[{ label: "All engagements", href: "/" }]}
        title="Import clients"
        subtitle="Add many clients at once from a spreadsheet or a pasted list. You see what will happen first."
      />
      <div className="mt-6 max-w-3xl">
        <ImportClients />
      </div>
    </div>
  );
}
