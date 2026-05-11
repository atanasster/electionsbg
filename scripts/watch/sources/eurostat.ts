// Eurostat macro indicator watcher. We fingerprint each of the macro datasets
// rendered on /governments individually, so the watch report can name the
// dataset that moved rather than a generic "macro update".
//
// The fingerprint is a sha256 of `dataset:updated|dataset:updated|...` so any
// upstream release flips it. `meta.datasets` stores the per-dataset map so
// `describe()` can diff old vs. new and surface only the changed entries.

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchJson } from "../fingerprint";

interface EurostatResponse {
  updated?: string;
  extension?: { updated?: string };
}

// Subset of macro datasets we care about for /governments. Each is queried
// with `lastTimePeriod=1` so the response is one row — we only need the
// `updated` metadata, not the values.
//
// HICP sub-components (food/energy/services/core) and youth unemployment all
// live inside datasets already tracked here (prc_hicp_minr / une_rt_q), so
// they're covered without separate entries.
const DATASETS: { code: string; query: string }[] = [
  {
    code: "namq_10_gdp",
    query: "geo=BG&unit=CLV_PCH_SM&na_item=B1GQ&s_adj=SCA&freq=Q",
  },
  { code: "prc_hicp_minr", query: "geo=BG&unit=RCH_A&coicop18=TOTAL" },
  {
    code: "une_rt_q",
    query: "geo=BG&unit=PC_ACT&age=Y15-74&sex=T&s_adj=NSA&freq=Q",
  },
  {
    code: "gov_10q_ggdebt",
    query: "geo=BG&unit=PC_GDP&sector=S13&na_item=GD&freq=Q",
  },
  {
    code: "gov_10q_ggnfa",
    query: "geo=BG&unit=PC_GDP&sector=S13&na_item=B9&s_adj=SCA&freq=Q",
  },
  {
    code: "ei_bpm6ca_q",
    query:
      "geo=BG&unit=PC_GDP&s_adj=NSA&sector10=S1&sectpart=S1&partner=WRL_REST&stk_flow=BAL&bop_item=CA&freq=Q",
  },
  // Activity + sentiment (Phase 3).
  {
    code: "sts_inpr_q",
    query: "geo=BG&indic_bt=PRD&nace_r2=B-D&s_adj=SCA&unit=I21&freq=Q",
  },
  {
    code: "sts_trtu_m",
    query: "geo=BG&indic_bt=VOL_SLS&nace_r2=G&s_adj=SCA&unit=I21",
  },
  { code: "ei_bssi_m_r2", query: "geo=BG&indic=BS-ESI-I&s_adj=SA" },
  // Social (Phase 4).
  { code: "prc_hpi_q", query: "geo=BG&purchase=TOTAL&unit=RCH_A&freq=Q" },
  { code: "ilc_di12", query: "geo=BG&statinfo=GINI_HND&age=TOTAL" },
  // Phase 4 addendum.
  {
    code: "ilc_li02",
    query: "geo=BG&indic_il=LI_R_MD60&sex=T&age=TOTAL&unit=PC",
  },
  {
    code: "namq_10_a10",
    query: "geo=BG&na_item=D1&unit=CP_MEUR&s_adj=SCA&nace_r2=TOTAL&freq=Q",
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

export const eurostat: WatchSource = {
  id: "eurostat",
  label: "Eurostat macro (BG): 13 datasets",
  // Best representative URL for the report's link column — the rest live in
  // meta.
  url: "https://ec.europa.eu/eurostat/databrowser/",
  cadence: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    const entries: Record<string, string> = {};
    for (const d of DATASETS) {
      entries[d.code] = await fetchUpdated(d.code, d.query);
    }
    // Stable serialisation so ordering doesn't affect the hash.
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
    return `new release · ${changed.join(", ")}`;
  },
};
