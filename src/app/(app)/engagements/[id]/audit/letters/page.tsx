import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import * as repo from "@/server/repo";
import { getLetterContext } from "@/server/letters";
import { formatAmount } from "@/domain/money";
import { longDate } from "@/domain/letters";
import { EngagementNav } from "../../nav";

export const dynamic = "force-dynamic";

const input = "rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900";
const label = "flex flex-col gap-1 text-sm text-slate-700";
const check = "flex items-center gap-2 text-sm text-slate-700";
const primary = "rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700";

export default async function LettersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const session = await getSession();
  const { engagement, context } = await withFirm(await getDb(), session.firmId, async (tx) => ({
    engagement: await repo.getEngagement(tx, id),
    context: await getLetterContext(tx, id),
  }));
  if (!engagement) notFound();
  const base = `/engagements/${id}/audit`;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 text-slate-900">
      <Link href="/" className="text-sm text-blue-700 underline">All engagements</Link>
      <h1 className="mt-2 text-2xl font-semibold">{engagement.clientName}</h1>
      <p className="mt-1 text-sm text-slate-600">{engagement.periodStart} to {engagement.periodEnd}</p>
      <EngagementNav id={id} current="audit" status={engagement.status} />

      <p className="mt-6 text-sm"><Link href={base} className="text-blue-700 underline">Back to audit planning</Link></p>
      <h2 className="mt-3 text-lg font-semibold">Letters</h2>

      {!context ? (
        <p className="mt-3 text-sm text-slate-600">Letters are for audited engagements. Turn the audit on from the audit page first.</p>
      ) : (
        <>
          <p role="note" className="mt-3 rounded border border-amber-400 bg-amber-50 px-3 py-2 text-sm">
            <span className="font-semibold">Template wording: draft, not yet reviewed.</span> Each letter downloads as a Word document for you to check, complete and
            put on your letterhead. Anything left blank here appears in the letter in [square brackets]. The engagement letter&apos;s &ldquo;Other terms&rdquo; section
            is left for your firm&apos;s own terms, which a lawyer should review.
          </p>
          <p className="mt-3 text-sm text-slate-600">
            Filled in for you: {context.firmName}, {context.clientName}, year end {longDate(context.periodEnd)}, {context.framework}. What you type below is used for
            the download only and is not saved.
          </p>

          <section className="mt-8 rounded border border-slate-200 p-4">
            <h3 className="text-base font-semibold">Engagement letter</h3>
            <p className="mt-1 text-sm text-slate-600">Sent before the audit starts, and signed by the client to agree the terms.</p>
            <form method="post" action={`${base}/letters/engagement`} className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <label className={label}>Addressed to<input name="addressee" className={input} placeholder="The Directors" maxLength={200} /></label>
              <label className={label}>Letter date<input name="date" type="date" className={input} /></label>
              <label className={label}>Engagement partner<input name="partnerName" className={input} maxLength={200} /></label>
              <label className={label}>Fieldwork period<input name="fieldwork" className={input} placeholder="February 2026" maxLength={200} /></label>
              <label className={label}>Information needed by<input name="informationDate" type="date" className={input} /></label>
              <label className={label}>Report target date<input name="targetDate" type="date" className={input} /></label>
              <label className={label}>Fee and basis<input name="fee" className={input} placeholder="AED 25,000, fixed" maxLength={200} /></label>
              <label className={label}>Payment terms<input name="paymentTerms" className={input} placeholder="within 30 days of invoice" maxLength={200} /></label>
              <label className={label}>Where client data is stored<input name="dataLocation" className={input} placeholder="the United Arab Emirates" maxLength={200} /></label>
              <label className={`${label} sm:col-span-2 lg:col-span-3`}>
                Other services you provide to this client (leave blank if none)
                <input name="otherServices" className={input} placeholder="bookkeeping and VAT return preparation" maxLength={300} />
              </label>
              <label className={`${check} sm:col-span-2 lg:col-span-3`}>
                <input type="checkbox" name="ai" /> Say that artificial-intelligence tools are used on the audit
              </label>
              <div className="sm:col-span-2 lg:col-span-3"><button className={primary}>Download engagement letter</button></div>
            </form>
          </section>

          <section className="mt-8 rounded border border-slate-200 p-4">
            <h3 className="text-base font-semibold">Management representation letter</h3>
            <p className="mt-1 text-sm text-slate-600">
              Signed by the client at the end of the audit, on its own letterhead, and dated as close as possible to the date of the audit report.
            </p>
            <p className="mt-2 text-sm text-slate-600">
              {context.uncorrected.length === 0
                ? "No uncorrected misstatements are recorded, so the letter will say there are none."
                : `${context.uncorrected.length} uncorrected misstatement(s), net ${formatAmount(context.uncorrected.reduce((n, m) => n + m.amountMinor, 0))}, will be listed in a schedule attached to the letter.`}
            </p>
            <form method="post" action={`${base}/letters/representation`} className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <label className={label}>Letter date<input name="date" type="date" className={input} /></label>
              <label className={label}>Date of the engagement letter<input name="engagementLetterDate" type="date" className={input} /></label>
              <label className={label}>
                Owner or related party giving financial support (blank if none)
                <input name="supporter" className={input} maxLength={200} />
              </label>
              <fieldset className="sm:col-span-2 lg:col-span-3">
                <legend className="text-sm text-slate-700">Include the representations on</legend>
                <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
                  <label className={check}><input type="checkbox" name="inventory" defaultChecked={context.has.inventory} /> Inventories</label>
                  <label className={check}><input type="checkbox" name="receivables" defaultChecked={context.has.receivables} /> Receivables</label>
                  <label className={check}><input type="checkbox" name="tax" defaultChecked={context.has.tax} /> Tax</label>
                </div>
                <p className="mt-1 text-xs text-slate-500">Ticked where the trial balance has accounts in that area.</p>
              </fieldset>
              <label className={`${label} sm:col-span-2 lg:col-span-3`}>
                Representations specific to this audit, one per line
                <textarea name="specific" rows={3} className={input} maxLength={4000} />
              </label>
              <div className="sm:col-span-2 lg:col-span-3"><button className={primary}>Download representation letter</button></div>
            </form>
          </section>
        </>
      )}
    </main>
  );
}
