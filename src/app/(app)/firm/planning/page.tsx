import Link from "next/link";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import { getPlanningSettings } from "@/server/planning";
import { BENCHMARKS } from "@/domain/audit";
import { BENCHMARK_ORDER, THRESHOLD_LABEL } from "@/domain/planning-settings";
import { ActionForm } from "@/app/action-form";
import { resetPlanningSettingsAction, updatePlanningSettingsAction } from "@/app/planning-actions";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Callout } from "@/ui/feedback";
import { Field, Input } from "@/ui/form";
import { Card, PageHeader } from "@/ui/layout";
import { canEditPlanningSettings, SETTINGS_DRAFT } from "@/ui/planning-view";

export const dynamic = "force-dynamic";

export default async function PlanningSettingsPage() {
  const session = await getSession();
  const stored = await withFirm(await getDb(), session.firmId, (tx) => getPlanningSettings(tx));
  const s = stored.settings;
  const edit = canEditPlanningSettings(session.role);
  const field = (label: string, name: string, value: number | string, hint?: string) => (
    <Field label={label} hint={hint}>
      <Input name={name} defaultValue={String(value)} inputMode="decimal" disabled={!edit} className="text-right" />
    </Field>
  );
  const form = (
    <div className="space-y-6">
      <Card title="Materiality percentages" description="The guide range for each benchmark, as a percentage of the benchmark. Materiality outside a range is allowed, with a warning, and the rationale should explain it.">
        <div className="space-y-3">
          {BENCHMARK_ORDER.map((b) => (
            <div key={b} className="grid grid-cols-1 gap-3 sm:grid-cols-[12rem_1fr_1fr] sm:items-end">
              <p className="font-medium">{BENCHMARKS[b].label}</p>
              {field("Lowest %", `min_${b}`, s.percentages[b].minBp / 100)}
              {field("Highest %", `max_${b}`, s.percentages[b].maxBp / 100)}
            </div>
          ))}
        </div>
      </Card>
      <Card title="Performance and trivial" description="Performance materiality as a percentage of overall materiality, and the clearly trivial threshold.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {field("Guide range, lowest %", "guideMinPct", s.performance.guideMinPct)}
          {field("Guide range, highest %", "guideMaxPct", s.performance.guideMaxPct)}
          {field("Default %", "defaultPct", s.performance.defaultPct, "Used unless a risk answer calls for less.")}
          {field("Reduced range, lowest %", "reducedMinPct", s.performance.reducedMinPct, "For a first year, prior adjustments above trivial, or control concerns.")}
          {field("Reduced range, highest %", "reducedMaxPct", s.performance.reducedMaxPct)}
          {field("Trivial %", "trivialPct", s.trivial.pct, "Of overall materiality.")}
          {field("Trivial, most before a warning %", "trivialMaxPct", s.trivial.maxPct)}
        </div>
      </Card>
      <Card title="Indicator thresholds" description="When the planning assistant flags an indicator.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(Object.keys(THRESHOLD_LABEL) as (keyof typeof THRESHOLD_LABEL)[]).map((k) => field(THRESHOLD_LABEL[k][0].toUpperCase() + THRESHOLD_LABEL[k].slice(1), k, s.thresholds[k]))}
        </div>
      </Card>
    </div>
  );

  return (
    <div className="py-8 text-ink">
      <PageHeader
        breadcrumb={[{ label: "All engagements", href: "/" }]}
        title="Planning settings"
        meta={
          <Link href="/firm" className="text-accent hover:underline">
            Back to the firm
          </Link>
        }
        subtitle={edit ? "The firm's guide ranges and thresholds for materiality and the planning assistant." : "The firm's guide ranges and thresholds. A partner or the administrator changes them."}
      />
      <div className="mt-6 space-y-8">
        <Callout variant="draft" title="Unreviewed draft defaults">
          {SETTINGS_DRAFT}
        </Callout>
        <p className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
          {stored.customised ? <Badge tone="info">Edited by your firm</Badge> : <Badge tone="neutral">Defaults</Badge>}
          {stored.updatedAt && (
            <span>
              Last saved by {stored.updatedBy} on {stored.updatedAt}.
            </span>
          )}
        </p>
        {edit ? (
          <>
            <ActionForm action={updatePlanningSettingsAction} fields={{}}>
              {form}
              <div className="mt-4">
                <Button variant="primary">Save the planning settings</Button>
              </div>
            </ActionForm>
            {stored.customised && (
              <ActionForm action={resetPlanningSettingsAction} fields={{}}>
                <Button variant="secondary">Reset to the defaults</Button>
              </ActionForm>
            )}
          </>
        ) : (
          form
        )}
      </div>
    </div>
  );
}
