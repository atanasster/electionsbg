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
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2));
  console.log(
    `\nWrote ${OUT_FILE} — ${GEOS.length} geos × ${NA_ITEMS.length} legacy metrics + ${Object.keys(indicators).length} new indicators, latest legacy year ${legacyLatestYear}`,
  );
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
