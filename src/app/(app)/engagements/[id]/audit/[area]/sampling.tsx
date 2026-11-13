"use client";

import { useState } from "react";
import { sampleSize, type SamplingRisk } from "@/domain/sampling";

const input = "rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900";
const label = "flex flex-col gap-1 text-sm text-slate-700";

/** Works out a sample size as the auditor types. Nothing is saved: record the result under work done. */
export function SamplingCalculator({ performanceMaterialityMinor }: { performanceMaterialityMinor: number }) {
  const [population, setPopulation] = useState("");
  const [risk, setRisk] = useState<SamplingRisk>("moderate");
  const [otherEvidence, setOtherEvidence] = useState(false);

  const value = Number(population.replace(/,/g, ""));
  const result = population.trim() === "" ? null : sampleSize({ populationMinor: Math.round(value * 100), performanceMaterialityMinor, risk, otherEvidence });
  const money = (minor: number) => (minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <details className="mt-4 rounded border border-slate-200 bg-slate-50 p-4">
      <summary className="cursor-pointer text-sm font-semibold">Sample size calculator</summary>
      <p className="mt-2 text-xs text-slate-600">
        First remove and test in full every item above performance materiality ({money(performanceMaterialityMinor)}), and anything unusual, old or related-party.
        Then enter the value of what remains. The factors are a proposal from the draft methodology, not a requirement of any standard.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className={label}>
          Remaining population value
          <input value={population} onChange={(e) => setPopulation(e.target.value)} inputMode="decimal" className={`${input} w-44 text-right`} />
        </label>
        <label className={label}>
          Assessed risk for the assertion
          <select value={risk} onChange={(e) => setRisk(e.target.value as SamplingRisk)} className={input}>
            <option value="low">Low</option>
            <option value="moderate">Moderate</option>
            <option value="high">High or significant</option>
          </select>
        </label>
        <label className="flex items-center gap-2 pb-1.5 text-sm text-slate-700">
          <input type="checkbox" checked={otherEvidence} onChange={(e) => setOtherEvidence(e.target.checked)} />
          Analytical or other procedures also give evidence
        </label>
      </div>
      {result && (
        <p role="status" className="mt-3 text-sm">
          {"error" in result ? (
            <span className="text-red-800">{result.error}</span>
          ) : (
            <>
              <span className="font-semibold">Sample size: {result.size} item(s).</span> Population ÷ performance materiality × factor {result.factor} = {result.calculated}.{" "}
              {result.notes.join(" ")} Select so that every item has a chance of selection, and record the method under work done.
            </>
          )}
        </p>
      )}
    </details>
  );
}
