// Eurostat datasets behind the tax-policy simulator baseline
// (data/budget/derived/policy_baseline.json + revenue_breakdown/consumption.json):
//
//   nama_10_co3_p3   household consumption by COICOP purpose — the VAT-model
//                    tax base (BG structure lags ~2 years; a release usually
//                    means a new structure year)
//   nama_10_gdp      annual P31_S14 household-consumption totals — scales the
//                    COICOP structure to the baseline year
//   gov_10a_taxag    D613CE/D613CS contribution aggregates — the МОД-cap
//                    identity's insurable base
//   earn_ses_hourly  SES decile ratios (D1/median/D9) — the shape anchors of
//                    the fitted earnings distribution behind the bracket
//                    scoring (4-yearly waves; the next is 2026)
//   educ_uoe_perp01  classroom teachers by ISCED level — the headcount behind
//                    the teachers' 125%-of-average-wage spending lever
//
// Kept separate from the `eurostat` macro watcher so the watch report maps
// this straight to the update-budget policy-baseline sub-step instead of
// update-macro. Same fingerprint mechanics: sha256 over per-dataset `updated`
// timestamps, with `meta.datasets` diffed by describe().

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchJson } from "../fingerprint";

interface EurostatResponse {
  updated?: string;
  extension?: { updated?: string };
}

const DATASETS: { code: string; query: string }[] = [
  {
    code: "nama_10_co3_p3",
    query: "geo=BG&unit=CP_MNAC&coicop=TOTAL&freq=A",
  },
  {
    code: "nama_10_gdp",
    query: "geo=BG&unit=CP_MNAC&na_item=P31_S14&freq=A",
  },
  {
    code: "gov_10a_taxag",
    query: "geo=BG&unit=MIO_NAC&sector=S13&na_item=D61&freq=A",
  },
  {
    code: "earn_ses_hourly",
    query:
      "geo=BG&nace_r2=B-S_X_O&isco08=TOTAL&age=TOTAL&sex=T&worktime=TOTAL&indic_se=MED_E_EUR&freq=A",
  },
  {
    code: "educ_uoe_perp01",
    query: "geo=BG&sex=T&age=TOTAL&isced11=ED1",
  },
];

const buildUrl = (code: string, query: string): string =>
  `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/${code}?${query}&format=JSON&lang=EN&lastTimePeriod=1`;

const fetchUpdated = async (code: string, query: string): Promise<string> => {
  const data = await fetchJson<EurostatResponse>(buildUrl(code, query));
  if (!data) throw new Error(`empty Eurostat response for ${code}`);
  const updated = data.updated ?? data.extension?.updated ?? "";
  if (!updated)
    throw new Error(`Eurostat ${code} response missing updated field`);
  return updated;
};

export const eurostatPolicy: WatchSource = {
  id: "eurostat_policy",
  label: "Eurostat policy-baseline (BG): consumption + tax aggregates",
  url: "https://ec.europa.eu/eurostat/databrowser/view/nama_10_co3_p3/default/table",
  cadence: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    const entries: Record<string, string> = {};
    for (const d of DATASETS) {
      entries[d.code] = await fetchUpdated(d.code, d.query);
    }
    const serialised = Object.keys(entries)
      .sort()
      .map((k) => `${k}:${entries[k]}`)
      .join("|");
    const value = createHash("sha256").update(serialised).digest("hex");
    const latest = Object.values(entries).sort().pop() ?? "";
    return {
      value,
      detail: `${DATASETS.length} datasets · latest update ${latest}`,
      meta: { datasets: entries, latest },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const prevDatasets = (prev.meta?.datasets ?? {}) as Record<string, string>;
    const currDatasets = (curr.meta?.datasets ?? {}) as Record<string, string>;
    const changed: string[] = [];
    for (const code of Object.keys(currDatasets).sort()) {
      if (prevDatasets[code] !== currDatasets[code]) {
        changed.push(`${code} ${currDatasets[code]}`);
      }
    }
    if (changed.length === 0) return curr.detail;
    return `new release · ${changed.join(", ")} — refresh the policy baseline (run_consumption_coicop.ts + run_policy_baseline.ts)`;
  },
};
