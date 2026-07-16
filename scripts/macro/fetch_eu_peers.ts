/**
 * Fetch peer-country macro indicators for the IndicatorsScreen comparison
 * overlay. Writes data/macro_peers.json.
 *
 * Two passes:
 *
 *  1. Legacy gov_10a_main pivot (annual, % GDP) — total revenue (TR), total
 *     expenditure (TE), net lending/borrowing (B9). Powers the existing
 *     BudgetPeerComparisonTile + headline-card chips on /budget. Geo roster
 *     was [BG, EU27, RO, HU, PL]; per the IndicatorsScreen redesign HR
 *     replaces PL and GR joins as a southern geographic neighbor → roster
 *     is now [BG, EU27, RO, GR, HU, HR].
 *
 *  2. New per-indicator time series for the IndicatorsScreen peer overlay:
 *     inflation (HICP), real GDP growth, unemployment, government debt,
 *     budget balance, current account, house prices YoY, youth unemployment.
 *     Quarterly cadence (inflation is monthly→quarterly mean). For headline
 *     indicators where the direction is unambiguous (lower-is-better for
 *     prices/debt/unemployment, higher-is-better for growth/balance) a
 *     27-member distribution snapshot is added so the IndicatorsScreen can
 *     render "rank N/27" pills.
 *
 * Usage:
 *   tsx scripts/macro/fetch_eu_peers.ts
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUT_FILE = path.resolve(__dirname, "../../data/macro_peers.json");

const EUROSTAT_BASE =
  "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data";

// ---- Legacy gov_10a_main (annual, % GDP) ----------------------------------

const DATASET = "gov_10a_main";
const SOURCE_URL =
  "https://ec.europa.eu/eurostat/databrowser/view/gov_10a_main/default/table";

const START_YEAR_ANNUAL = 2010;
const START_YEAR_QUARTERLY = 2005;

// Peer roster: BG anchors, EU27 is the headline benchmark, RO + GR are
// geographic neighbors, HU + HR are CEE peers. HR (Croatia) replaces PL in
// the v2 dataset.
//
// Note: Eurostat uses "EL" for Greece (Ελλάδα) on the API side, but every
// other place in the codebase uses ISO "GR". To keep the client surface
// consistent we fetch under EL and rewrite to GR on the way out.
const GEOS = ["BG", "EU27_2020", "RO", "GR", "HU", "HR"] as const;
const EUROSTAT_GEO_FOR = (g: Geo): string => (g === "GR" ? "EL" : g);
const REWRITE_GEO_FROM_EUROSTAT = (g: string): string =>
  g === "EL" ? "GR" : g;
const NA_ITEMS = ["TR", "TE", "B9"] as const;

// All 27 member states for the peer-band distribution that powers the
// budget-screen headline-card chips and the IndicatorsScreen rank pills.
// Greece uses Eurostat's "EL" code (not ISO "GR").
const EU27_MEMBERS = [
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "EL",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
] as const;

type Geo = (typeof GEOS)[number];
type NaItem = (typeof NA_ITEMS)[number];

type AnnualPoint = { year: number; value: number };
type QuarterlyPoint = {
  year: number;
  quarter: 1 | 2 | 3 | 4;
  period: string;
  value: number;
};
// Annual point for the new SILC + demographics pass. `period` is "YYYY" so
// consumers can read it symmetrically with QuarterlyPoint.period ("YYYY-QN").
type AnnualSeriesPoint = {
  year: number;
  period: string;
  value: number;
};

type EurostatResponse = {
  value: Record<string, number> | number[];
  dimension: Record<string, { category: { index: Record<string, number> } }>;
  size?: number[];
  id?: string[];
};

const round = (x: number, dp: number) => {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
};

// ---- Generic JSON-stat decoder --------------------------------------------

// Decodes Eurostat's JSON-stat 2.0 response into a flat list of
// {dim → label} rows. Handles arbitrary dim order and missing values.
const decode = (json: EurostatResponse): Record<string, string | number>[] => {
  const dimOrder = json.id ?? Object.keys(json.dimension);
  const sizes = json.size ?? dimOrder.map(() => 1);
  const labelByDim: Record<string, string[]> = {};
  for (const dim of dimOrder) {
    const cat = json.dimension[dim]?.category?.index;
    if (!cat) continue;
    const arr: string[] = [];
    for (const [label, idx] of Object.entries(cat)) arr[idx] = label;
    labelByDim[dim] = arr;
  }

  const strides: number[] = new Array(dimOrder.length).fill(1);
  for (let i = dimOrder.length - 2; i >= 0; i--) {
    strides[i] = strides[i + 1] * (sizes[i + 1] ?? 1);
  }

  const values = json.value;
  const entries: [string, number][] = Array.isArray(values)
    ? values.flatMap((v, i) =>
        typeof v === "number" && Number.isFinite(v)
          ? ([[String(i), v]] as [string, number][])
          : [],
      )
    : Object.entries(values).filter(
        ([, v]) => typeof v === "number" && Number.isFinite(v),
      );

  const out: Record<string, string | number>[] = [];
  for (const [keyStr, v] of entries) {
    const key = Number(keyStr);
    const row: Record<string, string | number> = { value: v };
    for (let i = 0; i < dimOrder.length; i++) {
      const dim = dimOrder[i];
      const coord = Math.floor(key / strides[i]) % (sizes[i] ?? 1);
      const label = labelByDim[dim]?.[coord];
      if (label !== undefined) row[dim] = label;
    }
    out.push(row);
  }
  return out;
};

// ---- Pass 1: gov_10a_main (annual % GDP, TR/TE/B9) -----------------------

const fetchAnnualPeers = async (
  geos: readonly Geo[],
): Promise<EurostatResponse> => {
  const params = new URLSearchParams({ format: "JSON", lang: "EN" });
  for (const g of geos) params.append("geo", EUROSTAT_GEO_FOR(g));
  for (const n of NA_ITEMS) params.append("na_item", n);
  params.append("unit", "PC_GDP");
  params.append("sector", "S13");
  params.append("freq", "A");
  const url = `${DATASET}?${params.toString()}`;
  const res = await fetch(`${EUROSTAT_BASE}/${url}`);
  if (!res.ok) {
    throw new Error(`Eurostat ${url} returned ${res.status}`);
  }
  return (await res.json()) as EurostatResponse;
};

const fetchAnnualDistribution = async (): Promise<EurostatResponse> => {
  const params = new URLSearchParams({ format: "JSON", lang: "EN" });
  // EU27_MEMBERS already uses "EL" for Greece (Eurostat code), so no rewrite
  // needed on the way out — just on the way in.
  for (const g of EU27_MEMBERS) params.append("geo", g);
  params.append("geo", "EU27_2020");
  for (const n of NA_ITEMS) params.append("na_item", n);
  params.append("unit", "PC_GDP");
  params.append("sector", "S13");
  params.append("freq", "A");
  params.append("lastTimePeriod", "3");
  const url = `${DATASET}?${params.toString()}`;
  const res = await fetch(`${EUROSTAT_BASE}/${url}`);
  if (!res.ok) {
    throw new Error(`Eurostat distribution ${url} returned ${res.status}`);
  }
  return (await res.json()) as EurostatResponse;
};

interface PeerBand {
  year: number;
  bgPctGdp: number;
  euAvgPctGdp: number | null;
  rank: number;
  total: number;
}

const buildAnnualDistribution = (
  rows: Record<string, string | number>[],
): Partial<Record<NaItem, PeerBand>> => {
  type ByGeo = Map<string, number>;
  const byNaYear = new Map<NaItem, Map<number, ByGeo>>();
  for (const r of rows) {
    const naItem = String(r.na_item);
    if (!(NA_ITEMS as readonly string[]).includes(naItem)) continue;
    const key = naItem as NaItem;
    const year = Number(r.time);
    const geo = REWRITE_GEO_FROM_EUROSTAT(String(r.geo));
    const value = Number(r.value);
    if (!Number.isFinite(year) || !Number.isFinite(value)) continue;
    if (!byNaYear.has(key)) byNaYear.set(key, new Map());
    const years = byNaYear.get(key)!;
    if (!years.has(year)) years.set(year, new Map());
    years.get(year)!.set(geo, value);
  }
  const out: Partial<Record<NaItem, PeerBand>> = {};
  for (const [naItem, years] of byNaYear) {
    const candidates = [...years.keys()].sort((a, b) => b - a);
    for (const y of candidates) {
      const byGeo = years.get(y)!;
      const bg = byGeo.get("BG");
      if (bg == null) continue;
      const memberValues: number[] = [];
      for (const g of EU27_MEMBERS) {
        const publicCode = REWRITE_GEO_FROM_EUROSTAT(g);
        const v = byGeo.get(publicCode);
        if (v != null) memberValues.push(v);
      }
      if (memberValues.length < 20) continue;
      const higher = memberValues.filter((v) => v > bg).length;
      const rank = higher + 1;
      const euAvg = byGeo.get("EU27_2020") ?? null;
      out[naItem] = {
        year: y,
        bgPctGdp: round(bg, 2),
        euAvgPctGdp: euAvg != null ? round(euAvg, 2) : null,
        rank,
        total: memberValues.length,
      };
      break;
    }
  }
  return out;
};

// ---- Pass 2: per-indicator quarterly peer series + distribution ----------

type Direction = "lower" | "higher" | "none";

interface PeerIndicatorConfig {
  key: string;
  dataset: string;
  query: Record<string, string>;
  // "Q" = quarterly time keys "YYYY-QN". "M" = monthly "YYYY-MM" (aggregated
  // to quarter mean post-fetch).
  freq: "Q" | "M";
  // "lower" = lower BG value is better (inflation, debt, unemployment).
  // "higher" = higher BG value is better (GDP growth, balance).
  // "none" = ambiguous, skip rank pill.
  direction: Direction;
  sourceUrl: string;
  // Optional: minimum number of quarterly points required from any single
  // peer geo before the pipeline considers the fetch successful.
  minQuarters?: number;
}

const PEER_INDICATORS: PeerIndicatorConfig[] = [
  {
    key: "inflation",
    dataset: "prc_hicp_minr",
    query: { unit: "RCH_A", coicop18: "TOTAL" },
    freq: "M",
    direction: "lower",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/prc_hicp_minr/default/table",
  },
  {
    key: "gdpGrowth",
    dataset: "namq_10_gdp",
    query: {
      unit: "CLV_PCH_SM",
      na_item: "B1GQ",
      s_adj: "SCA",
      freq: "Q",
    },
    freq: "Q",
    direction: "higher",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/namq_10_gdp/default/table",
  },
  {
    key: "unemployment",
    dataset: "une_rt_q",
    query: {
      unit: "PC_ACT",
      age: "Y15-74",
      sex: "T",
      s_adj: "NSA",
      freq: "Q",
    },
    freq: "Q",
    direction: "lower",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/une_rt_q/default/table",
  },
  {
    key: "govDebt",
    dataset: "gov_10q_ggdebt",
    query: {
      unit: "PC_GDP",
      sector: "S13",
      na_item: "GD",
      freq: "Q",
    },
    freq: "Q",
    direction: "lower",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/gov_10q_ggdebt/default/table",
  },
  {
    key: "budgetBalance",
    dataset: "gov_10q_ggnfa",
    query: {
      unit: "PC_GDP",
      sector: "S13",
      na_item: "B9",
      s_adj: "SCA",
      freq: "Q",
    },
    freq: "Q",
    direction: "higher",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/gov_10q_ggnfa/default/table",
  },
  {
    key: "currentAccount",
    dataset: "ei_bpm6ca_q",
    query: {
      unit: "PC_GDP",
      s_adj: "NSA",
      sector10: "S1",
      sectpart: "S1",
      partner: "WRL_REST",
      stk_flow: "BAL",
      bop_item: "CA",
      freq: "Q",
    },
    freq: "Q",
    direction: "none",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/ei_bpm6ca_q/default/table",
  },
  {
    key: "housePricesYoY",
    dataset: "prc_hpi_q",
    query: { purchase: "TOTAL", unit: "RCH_A", freq: "Q" },
    freq: "Q",
    direction: "none",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/prc_hpi_q/default/table",
    // House-price index has shorter history for some peers; relax the floor.
    minQuarters: 30,
  },
  {
    key: "youthUnemployment",
    dataset: "une_rt_q",
    query: {
      unit: "PC_ACT",
      age: "Y15-24",
      sex: "T",
      s_adj: "NSA",
      freq: "Q",
    },
    freq: "Q",
    direction: "lower",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/une_rt_q/default/table",
  },
];

const aggregateMonthlyToQuarter = (
  monthly: { year: number; month: number; value: number }[],
): QuarterlyPoint[] => {
  const buckets = new Map<
    string,
    { sum: number; count: number; year: number; quarter: 1 | 2 | 3 | 4 }
  >();
  for (const m of monthly) {
    const quarter = Math.ceil(m.month / 3) as 1 | 2 | 3 | 4;
    const key = `${m.year}-Q${quarter}`;
    const b = buckets.get(key) ?? {
      sum: 0,
      count: 0,
      year: m.year,
      quarter,
    };
    b.sum += m.value;
    b.count += 1;
    buckets.set(key, b);
  }
  const out: QuarterlyPoint[] = [];
  for (const [, b] of buckets) {
    if (b.count < 3) continue; // drop incomplete trailing quarter
    out.push({
      year: b.year,
      quarter: b.quarter,
      period: `${b.year}-Q${b.quarter}`,
      value: round(b.sum / b.count, 2),
    });
  }
  return out.sort((a, b) => a.year - b.year || a.quarter - b.quarter);
};

const fetchIndicatorPeers = async (
  ind: PeerIndicatorConfig,
  geos: readonly Geo[],
): Promise<Record<string, QuarterlyPoint[]>> => {
  const params = new URLSearchParams({ format: "JSON", lang: "EN" });
  for (const g of geos) params.append("geo", EUROSTAT_GEO_FOR(g));
  for (const [k, v] of Object.entries(ind.query)) params.append(k, v);
  const url = `${ind.dataset}?${params.toString()}`;
  const res = await fetch(`${EUROSTAT_BASE}/${url}`);
  if (!res.ok) {
    throw new Error(`Eurostat ${ind.key} ${url} returned ${res.status}`);
  }
  const json = (await res.json()) as EurostatResponse;
  const rows = decode(json);

  // Group by geo (after rewriting EL → GR back to the public roster)
  const byGeo: Record<string, Record<string, string | number>[]> = {};
  for (const r of rows) {
    const geo = REWRITE_GEO_FROM_EUROSTAT(String(r.geo));
    if (!geo) continue;
    if (!byGeo[geo]) byGeo[geo] = [];
    byGeo[geo].push(r);
  }

  const out: Record<string, QuarterlyPoint[]> = {};
  for (const geo of geos) {
    const geoRows = byGeo[geo] ?? [];
    if (ind.freq === "M") {
      const monthly: { year: number; month: number; value: number }[] = [];
      for (const r of geoRows) {
        const t = String(r.time);
        const m = /^(\d{4})-(\d{2})$/.exec(t);
        if (!m) continue;
        const year = +m[1];
        const month = +m[2];
        if (year < START_YEAR_QUARTERLY) continue;
        const v = Number(r.value);
        if (!Number.isFinite(v)) continue;
        monthly.push({ year, month, value: v });
      }
      out[geo] = aggregateMonthlyToQuarter(monthly);
    } else {
      const quarterly: QuarterlyPoint[] = [];
      for (const r of geoRows) {
        const t = String(r.time);
        const m = /^(\d{4})-Q([1-4])$/.exec(t);
        if (!m) continue;
        const year = +m[1];
        const quarter = +m[2] as 1 | 2 | 3 | 4;
        if (year < START_YEAR_QUARTERLY) continue;
        const v = Number(r.value);
        if (!Number.isFinite(v)) continue;
        quarterly.push({
          year,
          quarter,
          period: `${year}-Q${quarter}`,
          value: round(v, 2),
        });
      }
      out[geo] = quarterly.sort(
        (a, b) => a.year - b.year || a.quarter - b.quarter,
      );
    }
  }
  return out;
};

interface IndicatorDistribution {
  period: string;
  year: number;
  quarter: 1 | 2 | 3 | 4;
  bgValue: number;
  euAverage: number | null;
  rank: number;
  total: number;
  // Mirror back so the client doesn't need to know the indicator config.
  direction: "lower" | "higher";
}

// Compute rank among EU27 member states for the most recent quarter where BG
// and ≥20 members report. `direction=lower` means rank 1 = lowest value.
const fetchIndicatorDistribution = async (
  ind: PeerIndicatorConfig,
): Promise<IndicatorDistribution | null> => {
  if (ind.direction === "none") return null;
  const geos = [...EU27_MEMBERS, "EU27_2020"];
  // The volume here is non-trivial — limit to the last few periods. Quarterly
  // datasets: 6 quarters covers any latest-quarter scenario. Monthly inflation:
  // 12 months → at least one complete quarter.
  const params = new URLSearchParams({ format: "JSON", lang: "EN" });
  for (const g of geos) params.append("geo", g);
  for (const [k, v] of Object.entries(ind.query)) params.append(k, v);
  params.append("lastTimePeriod", ind.freq === "M" ? "12" : "6");
  const url = `${ind.dataset}?${params.toString()}`;
  const res = await fetch(`${EUROSTAT_BASE}/${url}`);
  if (!res.ok) {
    throw new Error(
      `Eurostat distribution ${ind.key} ${url} returned ${res.status}`,
    );
  }
  const json = (await res.json()) as EurostatResponse;
  const rows = decode(json);

  // Build per-geo quarterly aggregated series (storing under the public
  // geo code, not Eurostat's EL/GR alias)
  const byGeo: Record<string, QuarterlyPoint[]> = {};
  for (const geo of geos) byGeo[REWRITE_GEO_FROM_EUROSTAT(geo)] = [];
  if (ind.freq === "M") {
    const monthlyByGeo: Record<
      string,
      { year: number; month: number; value: number }[]
    > = {};
    for (const r of rows) {
      const geo = REWRITE_GEO_FROM_EUROSTAT(String(r.geo));
      const t = String(r.time);
      const m = /^(\d{4})-(\d{2})$/.exec(t);
      if (!m) continue;
      const year = +m[1];
      const month = +m[2];
      const v = Number(r.value);
      if (!Number.isFinite(v)) continue;
      if (!monthlyByGeo[geo]) monthlyByGeo[geo] = [];
      monthlyByGeo[geo].push({ year, month, value: v });
    }
    for (const geo of Object.keys(monthlyByGeo)) {
      byGeo[geo] = aggregateMonthlyToQuarter(monthlyByGeo[geo]);
    }
  } else {
    for (const r of rows) {
      const geo = REWRITE_GEO_FROM_EUROSTAT(String(r.geo));
      const t = String(r.time);
      const m = /^(\d{4})-Q([1-4])$/.exec(t);
      if (!m) continue;
      const year = +m[1];
      const quarter = +m[2] as 1 | 2 | 3 | 4;
      const v = Number(r.value);
      if (!Number.isFinite(v)) continue;
      if (!byGeo[geo]) byGeo[geo] = [];
      byGeo[geo].push({
        year,
        quarter,
        period: `${year}-Q${quarter}`,
        value: round(v, 2),
      });
    }
  }

  // Find the most recent period where BG + ≥20 members report.
  const allPeriods = new Set<string>();
  for (const geo of Object.keys(byGeo)) {
    for (const p of byGeo[geo] ?? []) allPeriods.add(p.period);
  }
  const sortedPeriods = [...allPeriods].sort().reverse();
  for (const period of sortedPeriods) {
    const bgPoint = byGeo["BG"]?.find((p) => p.period === period);
    if (!bgPoint) continue;
    const memberValues: number[] = [];
    for (const g of EU27_MEMBERS) {
      const publicCode = REWRITE_GEO_FROM_EUROSTAT(g);
      const v = byGeo[publicCode]?.find((p) => p.period === period)?.value;
      if (v != null) memberValues.push(v);
    }
    if (memberValues.length < 20) continue;
    const euAvg = byGeo["EU27_2020"]?.find((p) => p.period === period)?.value;
    // Rank: 1 = best per `direction`. For "lower", rank 1 = lowest value.
    let rank: number;
    if (ind.direction === "lower") {
      rank = memberValues.filter((v) => v < bgPoint.value).length + 1;
    } else {
      rank = memberValues.filter((v) => v > bgPoint.value).length + 1;
    }
    return {
      period,
      year: bgPoint.year,
      quarter: bgPoint.quarter,
      bgValue: bgPoint.value,
      euAverage: euAvg != null ? round(euAvg, 2) : null,
      rank,
      total: memberValues.length,
      direction: ind.direction as "lower" | "higher",
    };
  }
  return null;
};

// ---- Pass 3: annual per-indicator peer series (SILC + demographics) ------

interface AnnualPeerIndicatorConfig {
  key: string;
  dataset: string;
  // Eurostat dimension filters other than `geo` and `freq` (which the caller
  // sets). Each kept as a literal string for the URL query.
  query: Record<string, string>;
  direction: Direction;
  sourceUrl: string;
  // Minimum number of annual points required from BG before the pipeline
  // considers the fetch successful. SILC has full coverage from 2007 →
  // expect ~17 points by 2024.
  minYears?: number;
  // For datasets where Eurostat does NOT publish the EU27_2020 aggregate
  // (e.g. crim_off_cat, crim_pris_age), set this to compute an unweighted
  // mean across the 27 member states year-by-year and stitch it into
  // `series["EU27_2020"]`. Mirrors the WGI computed-EU27 pattern.
  computeEu27FromMembers?: boolean;
}

const PEER_INDICATORS_ANNUAL: AnnualPeerIndicatorConfig[] = [
  {
    key: "gini",
    dataset: "ilc_di12",
    // ilc_di12 has dimensions: freq, age (TOTAL / Y_LT18), statinfo (GINI_HND
    // is the only value), geo, time. Restrict to the overall-population Gini
    // — without this filter Eurostat ships both rows and the consumer sees
    // duplicate years.
    query: { age: "TOTAL" },
    direction: "lower",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/ilc_di12/default/table",
    minYears: 8,
  },
  {
    key: "incomeQuintileRatio",
    dataset: "ilc_di11",
    // ilc_di11 IS the S80/S20 ratio dataset (the label is "Income quintile
    // share ratio S80/S20"). Dimensions: freq, age, sex, unit, geo, time —
    // no indic_il. Restrict to the all-ages totals row.
    query: { age: "TOTAL", sex: "T" },
    direction: "lower",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/ilc_di11/default/table",
    minYears: 8,
  },
  {
    key: "arope",
    dataset: "ilc_peps01n",
    query: { age: "TOTAL", sex: "T", unit: "PC" },
    direction: "lower",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/ilc_peps01n/default/table",
    minYears: 8,
  },
  {
    key: "lifeExpectancy",
    dataset: "demo_mlexpec",
    query: { sex: "T", age: "Y_LT1", unit: "YR" },
    direction: "higher",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/demo_mlexpec/default/table",
    minYears: 8,
  },
  {
    key: "intentionalHomicideRate",
    dataset: "crim_off_cat",
    query: { iccs: "ICCS0101", unit: "P_HTHAB" },
    direction: "lower",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/crim_off_cat/default/table",
    minYears: 8,
    computeEu27FromMembers: true,
  },
  {
    key: "prisonPopulationRate",
    dataset: "crim_pris_age",
    query: { age: "TOTAL", sex: "T", unit: "P_HTHAB" },
    // High incarceration could reflect either crime or punitiveness — no
    // clean "good direction" so we skip the rank pill.
    direction: "none",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/crim_pris_age/default/table",
    minYears: 8,
    computeEu27FromMembers: true,
  },
  {
    key: "digitalSkills",
    dataset: "isoc_sk_dskl_i21",
    // Citizen digital skills — share (16-74) with at least basic overall skills
    // across all five DigComp areas. Pin the total individual type + the overall
    // "at least basic" indicator + the % unit. Biennial (odd years from 2021),
    // so only a few points exist — lower the minYears floor accordingly.
    query: { ind_type: "IND_TOTAL", indic_is: "I_DSK2_BAB", unit: "PC_IND" },
    direction: "higher",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/isoc_sk_dskl_i21/default/table",
    minYears: 2,
  },
];

const fetchAnnualIndicatorPeers = async (
  ind: AnnualPeerIndicatorConfig,
  geos: readonly Geo[],
): Promise<Record<string, AnnualSeriesPoint[]>> => {
  // For datasets where Eurostat doesn't publish EU27_2020, also pull every
  // member state in the same call so we can compute the EU27 mean below.
  const memberGeosToFetch = ind.computeEu27FromMembers
    ? (EU27_MEMBERS as readonly string[])
    : [];
  const params = new URLSearchParams({ format: "JSON", lang: "EN" });
  for (const g of geos) params.append("geo", EUROSTAT_GEO_FOR(g));
  for (const g of memberGeosToFetch) {
    // GEOS already contains BG/RO/EL/HU/HR — don't double-add when the
    // member roster overlaps the peer roster (URLSearchParams will happily
    // duplicate them but Eurostat treats the union the same way).
    params.append("geo", g);
  }
  for (const [k, v] of Object.entries(ind.query)) params.append(k, v);
  params.append("freq", "A");
  const url = `${ind.dataset}?${params.toString()}`;
  const res = await fetch(`${EUROSTAT_BASE}/${url}`);
  if (!res.ok) {
    throw new Error(`Eurostat ${ind.key} ${url} returned ${res.status}`);
  }
  const json = (await res.json()) as EurostatResponse;
  const rows = decode(json);

  const out: Record<string, AnnualSeriesPoint[]> = {};
  for (const geo of geos) out[geo] = [];

  // When computing EU27 from members, accumulate every member's value
  // per year — independent of the peer slice we ship to the consumer.
  const memberByYear: Map<number, Map<string, number>> | null =
    ind.computeEu27FromMembers ? new Map() : null;

  for (const r of rows) {
    const eurostatGeo = String(r.geo);
    const geo = REWRITE_GEO_FROM_EUROSTAT(eurostatGeo) as Geo;
    const t = String(r.time);
    const m = /^(\d{4})$/.exec(t);
    if (!m) continue;
    const year = +m[1];
    if (year < START_YEAR_ANNUAL) continue;
    const v = Number(r.value);
    if (!Number.isFinite(v)) continue;

    if ((geos as readonly string[]).includes(geo)) {
      out[geo].push({ year, period: String(year), value: round(v, 2) });
    }
    if (
      memberByYear &&
      (EU27_MEMBERS as readonly string[]).includes(eurostatGeo)
    ) {
      if (!memberByYear.has(year)) memberByYear.set(year, new Map());
      memberByYear.get(year)!.set(eurostatGeo, v);
    }
  }
  for (const g of geos) out[g].sort((a, b) => a.year - b.year);

  if (memberByYear) {
    const euSeries: AnnualSeriesPoint[] = [];
    for (const [year, members] of [...memberByYear.entries()].sort(
      (a, b) => a[0] - b[0],
    )) {
      // Require ≥20 of 27 members reporting before publishing the year —
      // mirrors the WGI threshold to avoid lurchy EU27 means when coverage
      // is thin.
      if (members.size < 20) continue;
      const sum = [...members.values()].reduce((a, b) => a + b, 0);
      const mean = sum / members.size;
      euSeries.push({ year, period: String(year), value: round(mean, 2) });
    }
    if (euSeries.length > 0) out["EU27_2020"] = euSeries;
  }
  return out;
};

interface IndicatorDistributionAnnual {
  period: string;
  year: number;
  bgValue: number;
  euAverage: number | null;
  rank: number;
  total: number;
  direction: "lower" | "higher";
}

const fetchAnnualIndicatorDistribution = async (
  ind: AnnualPeerIndicatorConfig,
): Promise<IndicatorDistributionAnnual | null> => {
  if (ind.direction === "none") return null;
  const geos = [...EU27_MEMBERS, "EU27_2020"];
  const params = new URLSearchParams({ format: "JSON", lang: "EN" });
  for (const g of geos) params.append("geo", g);
  for (const [k, v] of Object.entries(ind.query)) params.append(k, v);
  params.append("freq", "A");
  // Pull the trailing 4 years — SILC publishes annually with a 1-2y lag, and
  // some member states report later than others. Four years comfortably
  // covers the search window for the latest year where BG + ≥20 peers report.
  params.append("lastTimePeriod", "4");
  const url = `${ind.dataset}?${params.toString()}`;
  const res = await fetch(`${EUROSTAT_BASE}/${url}`);
  if (!res.ok) {
    throw new Error(
      `Eurostat annual distribution ${ind.key} ${url} returned ${res.status}`,
    );
  }
  const json = (await res.json()) as EurostatResponse;
  const rows = decode(json);

  type ByGeo = Map<string, number>;
  const byYear = new Map<number, ByGeo>();
  for (const r of rows) {
    const geo = REWRITE_GEO_FROM_EUROSTAT(String(r.geo));
    const t = String(r.time);
    const m = /^(\d{4})$/.exec(t);
    if (!m) continue;
    const year = +m[1];
    const v = Number(r.value);
    if (!Number.isFinite(v)) continue;
    if (!byYear.has(year)) byYear.set(year, new Map());
    byYear.get(year)!.set(geo, v);
  }
  const candidates = [...byYear.keys()].sort((a, b) => b - a);
  for (const y of candidates) {
    const byGeo = byYear.get(y)!;
    const bg = byGeo.get("BG");
    if (bg == null) continue;
    const memberValues: number[] = [];
    for (const g of EU27_MEMBERS) {
      const publicCode = REWRITE_GEO_FROM_EUROSTAT(g);
      const v = byGeo.get(publicCode);
      if (v != null) memberValues.push(v);
    }
    if (memberValues.length < 20) continue;
    // Some datasets (crim_off_cat, crim_pris_age) don't publish EU27_2020 —
    // fall back to the unweighted mean across the members we just gathered.
    const publishedEuAvg = byGeo.get("EU27_2020");
    const euAvg = ind.computeEu27FromMembers
      ? memberValues.reduce((a, b) => a + b, 0) / memberValues.length
      : (publishedEuAvg ?? null);
    let rank: number;
    if (ind.direction === "lower") {
      rank = memberValues.filter((v) => v < bg).length + 1;
    } else {
      rank = memberValues.filter((v) => v > bg).length + 1;
    }
    return {
      period: String(y),
      year: y,
      bgValue: round(bg, 2),
      euAverage: euAvg != null ? round(euAvg, 2) : null,
      rank,
      total: memberValues.length,
      direction: ind.direction as "lower" | "higher",
    };
  }
  return null;
};

// ---- Pass 4: World Bank Worldwide Governance Indicators (WGI) ------------

const WGI_DIMENSIONS = ["VA", "PV", "GE", "RQ", "RL", "CC"] as const;
type WgiDim = (typeof WGI_DIMENSIONS)[number];

// All 27 EU member states by ISO-3. The full set is used to compute the
// EU27 mean (the World Bank does not publish a WGI regional aggregate);
// the dashboard peers are picked out via PEER_ISO3_TO_GEO below.
const EU27_ISO3 = [
  "AUT",
  "BEL",
  "BGR",
  "HRV",
  "CYP",
  "CZE",
  "DNK",
  "EST",
  "FIN",
  "FRA",
  "DEU",
  "GRC",
  "HUN",
  "IRL",
  "ITA",
  "LVA",
  "LTU",
  "LUX",
  "MLT",
  "NLD",
  "POL",
  "PRT",
  "ROU",
  "SVK",
  "SVN",
  "ESP",
  "SWE",
] as const;
type Iso3 = (typeof EU27_ISO3)[number];

const PEER_ISO3_TO_GEO: Partial<Record<Iso3, Geo>> = {
  BGR: "BG",
  ROU: "RO",
  GRC: "GR",
  HUN: "HU",
  HRV: "HR",
};

interface WgiSnapshot {
  year: number;
  value: number;
  percentile: number;
}

type WbApiPoint = {
  countryiso3code: string;
  date: string;
  value: number | null;
};

// World Bank WGI indicator codes live under source 3 (Worldwide Governance
// Indicators). The classic dotted codes (VA.EST, PV.PER.RNK, …) belong to
// the archived WDI mirror and are no longer queryable via the standard
// `country/{iso3}/indicator/{code}` endpoint. Source 3 codes are prefixed
// with `GOV_WGI_` and use `.EST` for the estimate (-2.5..+2.5) plus `.SC`
// for the 0-100 governance score (the modern percentile-equivalent).
const WGI_INDICATOR_CODE = (dim: WgiDim, kind: "EST" | "SC"): string =>
  `GOV_WGI_${dim}.${kind}`;

const fetchWgiSeriesForDim = async (
  dim: WgiDim,
): Promise<{
  byGeoYear: Map<string, Map<number, { value: number; percentile: number }>>;
}> => {
  const countries = EU27_ISO3.join(";");
  // Pull from 2005 (first Bulgarian parliamentary election in the dataset)
  // so the EU compare dashboard can match data to any selected election
  // cycle. World Bank publishes WGI annually with a ~1y lag, so the
  // forward bound just needs to be a few years out.
  const date = "2005:2030";
  const fetchKind = async (kind: "EST" | "SC"): Promise<WbApiPoint[]> => {
    const code = WGI_INDICATOR_CODE(dim, kind);
    const url = `https://api.worldbank.org/v2/country/${countries}/indicator/${code}?format=json&date=${date}&source=3&per_page=2000`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`World Bank ${code} returned ${res.status}`);
    }
    const json = (await res.json()) as [unknown, WbApiPoint[] | null];
    return (json[1] ?? []) as WbApiPoint[];
  };
  const [estRows, prnRows] = await Promise.all([
    fetchKind("EST"),
    fetchKind("SC"),
  ]);
  type Cell = { value?: number; percentile?: number };
  const byGeoYear = new Map<string, Map<number, Cell>>();
  for (const r of estRows) {
    if (r.value == null) continue;
    const y = Number(r.date);
    if (!Number.isFinite(y)) continue;
    if (!byGeoYear.has(r.countryiso3code))
      byGeoYear.set(r.countryiso3code, new Map());
    const yMap = byGeoYear.get(r.countryiso3code)!;
    const cell = yMap.get(y) ?? {};
    cell.value = r.value;
    yMap.set(y, cell);
  }
  for (const r of prnRows) {
    if (r.value == null) continue;
    const y = Number(r.date);
    if (!Number.isFinite(y)) continue;
    if (!byGeoYear.has(r.countryiso3code))
      byGeoYear.set(r.countryiso3code, new Map());
    const yMap = byGeoYear.get(r.countryiso3code)!;
    const cell = yMap.get(y) ?? {};
    cell.percentile = r.value;
    yMap.set(y, cell);
  }
  // Drop cells missing either half — only complete pairs are usable for the
  // radar tile (Estimate as primary scale, PercentileRank as alt).
  const cleaned = new Map<
    string,
    Map<number, { value: number; percentile: number }>
  >();
  for (const [iso3, yMap] of byGeoYear) {
    const out = new Map<number, { value: number; percentile: number }>();
    for (const [y, cell] of yMap) {
      if (cell.value == null || cell.percentile == null) continue;
      out.set(y, { value: cell.value, percentile: cell.percentile });
    }
    cleaned.set(iso3, out);
  }
  return { byGeoYear: cleaned };
};

interface WgiPayload {
  fetchedAt: string;
  latestYear: number;
  source: { name: string; url: string };
  // Multi-year series per (dimension, geo). Sorted ascending by year so the
  // consumer can binary-search or use last-≤-year selection. EU27 is the
  // computed unweighted mean across the 27 members for each year that has
  // ≥20 reporters.
  series: Partial<
    Record<WgiDim, Partial<Record<Geo | "EU27_2020", WgiSnapshot[]>>>
  >;
}

const fetchWgi = async (): Promise<WgiPayload> => {
  const series: Partial<
    Record<WgiDim, Partial<Record<Geo | "EU27_2020", WgiSnapshot[]>>>
  > = {};
  // Track the latest year that has ≥20 EU members reporting across each
  // dimension; the conservative min across dimensions is the dashboard's
  // notional "latest available" year.
  const latestYearByDim = new Map<WgiDim, number>();

  for (const dim of WGI_DIMENSIONS) {
    process.stdout.write(`Loading WGI ${dim}… `);
    const { byGeoYear } = await fetchWgiSeriesForDim(dim);

    // Collect every year where ≥20 EU members report. Years with thinner
    // coverage are dropped — the EU27 mean would otherwise lurch as members
    // join/leave the available set.
    const yearMembers = new Map<number, number>();
    for (const yMap of byGeoYear.values()) {
      for (const y of yMap.keys())
        yearMembers.set(y, (yearMembers.get(y) ?? 0) + 1);
    }
    const usableYears = [...yearMembers.entries()]
      .filter(([, n]) => n >= 20)
      .map(([y]) => y)
      .sort((a, b) => a - b);
    if (usableYears.length === 0) {
      throw new Error(`No usable WGI years for ${dim}`);
    }
    latestYearByDim.set(dim, usableYears[usableYears.length - 1]);

    const perDim: Partial<Record<Geo | "EU27_2020", WgiSnapshot[]>> = {};
    // Per-peer time series
    for (const iso3 of EU27_ISO3) {
      const peerGeo = PEER_ISO3_TO_GEO[iso3 as Iso3];
      if (!peerGeo) continue;
      const arr: WgiSnapshot[] = [];
      for (const y of usableYears) {
        const cell = byGeoYear.get(iso3)?.get(y);
        if (!cell) continue;
        arr.push({
          year: y,
          value: round(cell.value, 3),
          percentile: round(cell.percentile, 1),
        });
      }
      if (arr.length > 0) perDim[peerGeo] = arr;
    }
    // Computed EU27 mean per year — unweighted average across the 27
    // members for that year. Surfaced under the "EU27_2020" geo so the
    // consumer interface is symmetric with the Eurostat aggregate.
    const euArr: WgiSnapshot[] = [];
    for (const y of usableYears) {
      const values: number[] = [];
      const percentiles: number[] = [];
      for (const iso3 of EU27_ISO3) {
        const cell = byGeoYear.get(iso3)?.get(y);
        if (!cell) continue;
        values.push(cell.value);
        percentiles.push(cell.percentile);
      }
      if (values.length < 20) continue;
      const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
      euArr.push({
        year: y,
        value: round(mean(values), 3),
        percentile: round(mean(percentiles), 1),
      });
    }
    if (euArr.length > 0) perDim["EU27_2020"] = euArr;

    series[dim] = perDim;
    const peerCount = Object.keys(perDim).filter(
      (k) => k !== "EU27_2020",
    ).length;
    console.log(
      `years=${usableYears[0]}-${usableYears[usableYears.length - 1]} (${usableYears.length}y), peers=${peerCount}`,
    );
  }

  const latestYear = Math.min(...latestYearByDim.values());

  return {
    fetchedAt: new Date().toISOString(),
    latestYear,
    source: {
      name: "World Bank — Worldwide Governance Indicators",
      url: "https://databank.worldbank.org/source/worldwide-governance-indicators",
    },
    series,
  };
};

const main = async () => {
  // ----- Pass 1: legacy gov_10a_main annual TR/TE/B9 ------------------------
  console.log(
    `Fetching ${DATASET} for geos=[${GEOS.join(",")}], na_item=[${NA_ITEMS.join(",")}]…`,
  );
  const annualJson = await fetchAnnualPeers(GEOS);
  const annualRows = decode(annualJson);

  // Pivot: legacySeries[geo][naItem] = [{year, value}]
  const legacySeries: Record<Geo, Record<NaItem, AnnualPoint[]>> = {} as Record<
    Geo,
    Record<NaItem, AnnualPoint[]>
  >;
  for (const g of GEOS) {
    legacySeries[g] = { TR: [], TE: [], B9: [] };
  }
  for (const r of annualRows) {
    const geo = REWRITE_GEO_FROM_EUROSTAT(String(r.geo)) as Geo;
    const naItem = String(r.na_item) as NaItem;
    const year = Number(r.time);
    const value = Number(r.value);
    if (
      !(GEOS as readonly string[]).includes(geo) ||
      !(NA_ITEMS as readonly string[]).includes(naItem) ||
      !Number.isFinite(year) ||
      !Number.isFinite(value) ||
      year < START_YEAR_ANNUAL
    ) {
      continue;
    }
    legacySeries[geo][naItem].push({
      year,
      value: round(value, 2),
    });
  }
  for (const g of GEOS) {
    for (const n of NA_ITEMS) {
      legacySeries[g][n].sort((a, b) => a.year - b.year);
    }
  }

  // Sanity: every geo should have at least 8 BG-era observations for B9. GR
  // and HR only have full annual data from 2010+; relax the floor accordingly.
  for (const g of GEOS) {
    const n = legacySeries[g].B9.length;
    if (n < 8) {
      throw new Error(`Too few B9 observations for ${g}: ${n} < 8`);
    }
  }

  const legacyLatestYear = Math.max(
    ...GEOS.flatMap((g) =>
      NA_ITEMS.flatMap((n) => legacySeries[g][n].map((p) => p.year)),
    ),
  );

  console.log("Fetching distribution (27 member states, latest year)…");
  const distJson = await fetchAnnualDistribution();
  const distRows = decode(distJson);
  const legacyDistribution = buildAnnualDistribution(distRows);

  // ----- Pass 2: per-indicator quarterly peer series ------------------------
  const indicators: Record<
    string,
    {
      cadence: "quarterly";
      sourceUrl: string;
      dataset: string;
      direction: Direction;
      series: Record<string, QuarterlyPoint[]>;
      latestDistribution: IndicatorDistribution | null;
    }
  > = {};

  for (const ind of PEER_INDICATORS) {
    process.stdout.write(`Loading peer indicator ${ind.key}… `);
    const series = await fetchIndicatorPeers(ind, GEOS);

    // Floor check on BG; if BG is empty, the query is broken regardless of
    // whether peers happen to have data.
    const bgLen = series["BG"]?.length ?? 0;
    const floor = ind.minQuarters ?? 40;
    if (bgLen < floor) {
      throw new Error(
        `safety check: peer ${ind.key} BG returned ${bgLen} points, below floor ${floor}.`,
      );
    }

    const latestDistribution = await fetchIndicatorDistribution(ind);

    indicators[ind.key] = {
      cadence: "quarterly",
      sourceUrl: ind.sourceUrl,
      dataset: ind.dataset,
      direction: ind.direction,
      series,
      latestDistribution,
    };

    const peerCounts = GEOS.map((g) => `${g}:${series[g]?.length ?? 0}`).join(
      " ",
    );
    const distNote = latestDistribution
      ? ` · rank ${latestDistribution.rank}/${latestDistribution.total} @${latestDistribution.period}`
      : "";
    console.log(`${peerCounts}${distNote}`);
  }

  // ----- Pass 3: annual per-indicator peer series (SILC + demographics) ----
  const indicatorsAnnual: Record<
    string,
    {
      cadence: "annual";
      sourceUrl: string;
      dataset: string;
      direction: Direction;
      series: Record<string, AnnualSeriesPoint[]>;
      latestDistribution: IndicatorDistributionAnnual | null;
    }
  > = {};

  for (const ind of PEER_INDICATORS_ANNUAL) {
    process.stdout.write(`Loading annual peer indicator ${ind.key}… `);
    const series = await fetchAnnualIndicatorPeers(ind, GEOS);

    const bgLen = series["BG"]?.length ?? 0;
    const floor = ind.minYears ?? 8;
    if (bgLen < floor) {
      throw new Error(
        `safety check: annual peer ${ind.key} BG returned ${bgLen} points, below floor ${floor}.`,
      );
    }

    const latestDistribution = await fetchAnnualIndicatorDistribution(ind);

    indicatorsAnnual[ind.key] = {
      cadence: "annual",
      sourceUrl: ind.sourceUrl,
      dataset: ind.dataset,
      direction: ind.direction,
      series,
      latestDistribution,
    };

    const peerCounts = GEOS.map((g) => `${g}:${series[g]?.length ?? 0}`).join(
      " ",
    );
    const distNote = latestDistribution
      ? ` · rank ${latestDistribution.rank}/${latestDistribution.total} @${latestDistribution.period}`
      : "";
    console.log(`${peerCounts}${distNote}`);
  }

  // ----- Pass 4: World Bank WGI per-peer ------------------------------------
  console.log("Fetching World Bank WGI (6 dimensions × 27 members)…");
  const wgi = await fetchWgi();

  // ----- Combined payload ---------------------------------------------------
  const payload = {
    fetchedAt: new Date().toISOString(),
    source: {
      name: "Eurostat",
      dataset: DATASET,
      url: SOURCE_URL,
      unit: "PC_GDP",
      sector: "S13",
      filters: { freq: "A", unit: "PC_GDP", sector: "S13" },
    },
    geos: GEOS,
    naItems: NA_ITEMS,
    latestYear: legacyLatestYear,
    series: legacySeries,
    distribution: legacyDistribution,
    indicators,
    indicatorsAnnual,
    wgi,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2));
  console.log(
    `\nWrote ${OUT_FILE} — ${GEOS.length} geos × ${NA_ITEMS.length} legacy metrics + ${Object.keys(indicators).length} quarterly + ${Object.keys(indicatorsAnnual).length} annual + WGI(${Object.keys(wgi.series).length}d × ${Object.values(wgi.series)[0] ? Object.keys(Object.values(wgi.series)[0]!).length : 0}g @${wgi.latestYear}), latest legacy year ${legacyLatestYear}`,
  );
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
