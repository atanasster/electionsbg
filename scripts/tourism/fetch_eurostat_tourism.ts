/**
 * Fetch real Bulgaria tourism visitor statistics from Eurostat and write
 * data/tourism/visitors.json — the honest visitor-outcome context that sits
 * beside the Ministry of Tourism's procurement on /sector/tourism.
 *
 * Source: Eurostat `tour_occ_nim` (Nights spent at tourist accommodation
 * establishments, monthly), NACE I551 (hotels & similar), geo BG, split by
 * residence of the guest (FOR = foreign/inbound, DOM = domestic). No auth; the
 * JSON-stat REST API is public.
 *
 * Produces:
 *   - seasonality: the latest COMPLETE calendar year, foreign + domestic nights
 *     per month → Bulgaria's twin peak (summer Black Sea + winter ski).
 *   - annualForeign: last ~8 years of total foreign nights (a trend).
 *   - sourceMarkets: top countries of origin by nights (tour_occ_ninraw).
 *   - peakMonth, summer/winter shares (headline framing).
 *   - annualNights: Eurostat `tour_occ_ninat` — the official ANNUAL nights over
 *     ALL tourist accommodation (NACE I551-I553: hotels + holiday/short-stay +
 *     camping), total / domestic / foreign. Broader than the hotels-only monthly
 *     series above, so the two are never mixed in one figure. Starts at
 *     ANNUAL_FIRST_YEAR because the domestic split is gappy before it (2012 and
 *     most of 1991-2010 are missing); every emitted year satisfies
 *     total = domestic + foreign, or the run refuses to write.
 *
 * Usage: tsx scripts/tourism/fetch_eurostat_tourism.ts
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUT_FILE = path.resolve(__dirname, "../../data/tourism/visitors.json");

const BASE =
  "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data";
const DATASET = "tour_occ_nim";

/** Fetch one BG monthly nights series (by residence) → { "YYYY-MM": nights }. */
const fetchNights = async (
  cResid: "FOR" | "DOM",
): Promise<Record<string, number>> => {
  const url =
    `${BASE}/${DATASET}?geo=BG&format=JSON&lang=EN&unit=NR&nace_r2=I551` +
    `&c_resid=${cResid}&sinceTimePeriod=2015-01`;
  const r = await fetch(url);
  if (!r.ok)
    throw new Error(`Eurostat ${DATASET} ${cResid} → HTTP ${r.status}`);
  const d = (await r.json()) as {
    dimension: { time: { category: { index: Record<string, number> } } };
    value: Record<string, number>;
  };
  const index = d.dimension.time.category.index;
  const value = d.value;
  const out: Record<string, number> = {};
  for (const [period, i] of Object.entries(index)) {
    const v = value[String(i)];
    if (typeof v === "number") out[period] = v;
  }
  return out;
};

const ANNUAL_DATASET = "tour_occ_ninat";
const ANNUAL_FIRST_YEAR = 2013;

export interface AnnualNights {
  year: number;
  total: number;
  domestic: number;
  foreign: number;
}

/** One BG annual series over all accommodation (I551-I553) → { year: nights }. */
const fetchAnnual = async (
  cResid: "TOTAL" | "DOM" | "FOR",
): Promise<Map<number, number>> => {
  const url =
    `${BASE}/${ANNUAL_DATASET}?geo=BG&format=JSON&lang=EN&unit=NR` +
    `&nace_r2=I551-I553&c_resid=${cResid}`;
  const r = await fetch(url);
  if (!r.ok)
    throw new Error(`Eurostat ${ANNUAL_DATASET} ${cResid} → HTTP ${r.status}`);
  const d = (await r.json()) as {
    dimension: { time: { category: { index: Record<string, number> } } };
    value: Record<string, number>;
  };
  const out = new Map<number, number>();
  for (const [period, i] of Object.entries(d.dimension.time.category.index)) {
    const v = d.value[String(i)];
    if (typeof v === "number") out.set(Number(period), v);
  }
  return out;
};

/** Years from ANNUAL_FIRST_YEAR on, each with all three series present. A
 *  missing year INSIDE the range, or a total that is not domestic + foreign,
 *  throws: a hole or a mismatch would plot as a real collapse in tourism. */
export const buildAnnualNights = (
  total: Map<number, number>,
  domestic: Map<number, number>,
  foreign: Map<number, number>,
): AnnualNights[] => {
  const last = Math.max(...total.keys());
  const rows: AnnualNights[] = [];
  for (let y = ANNUAL_FIRST_YEAR; y <= last; y++) {
    const t = total.get(y);
    const d = domestic.get(y);
    const f = foreign.get(y);
    if (t === undefined || d === undefined || f === undefined)
      throw new Error(`${ANNUAL_DATASET}: ${y} is missing a series`);
    if (Math.abs(t - (d + f)) > 1)
      throw new Error(
        `${ANNUAL_DATASET}: ${y} total ${t} != domestic ${d} + foreign ${f}`,
      );
    rows.push({ year: y, total: t, domestic: d, foreign: f });
  }
  if (rows.length < 5)
    throw new Error(`${ANNUAL_DATASET}: only ${rows.length} usable year(s)`);
  return rows;
};

const MARKETS_DATASET = "tour_occ_ninraw";

export interface OriginMarket {
  code: string;
  name: string;
  nights: number;
}

/** Nights spent in BG by the tourist's country of origin, for one year. Keeps
 *  only individual foreign countries (2-letter ISO, minus BG=domestic and the
 *  EU aggregate) — the many WORLD/EUR/INT_EU* rollups are dropped. */
const fetchOriginMarkets = async (year: number): Promise<OriginMarket[]> => {
  const url =
    `${BASE}/${MARKETS_DATASET}?geo=BG&format=JSON&lang=EN&unit=NR` +
    `&nace_r2=I551&time=${year}`;
  const r = await fetch(url);
  if (!r.ok) return [];
  const d = (await r.json()) as {
    dimension: {
      c_resid: {
        category: {
          index: Record<string, number>;
          label: Record<string, string>;
        };
      };
    };
    value: Record<string, number>;
  };
  const cat = d.dimension?.c_resid?.category;
  if (!cat) return [];
  const out: OriginMarket[] = [];
  for (const [code, i] of Object.entries(cat.index)) {
    if (!/^[A-Z]{2}$/.test(code) || code === "BG" || code === "EU") continue;
    const v = d.value[String(i)];
    if (typeof v === "number" && v > 0)
      out.push({ code, name: cat.label?.[code] ?? code, nights: v });
  }
  out.sort((a, b) => b.nights - a.nights);
  return out;
};

const sumRange = (
  series: Record<string, number>,
  year: number,
  months: number[],
): number =>
  months.reduce((a, m) => {
    const key = `${year}-${String(m).padStart(2, "0")}`;
    return a + (series[key] ?? 0);
  }, 0);

const yearMonths = (series: Record<string, number>, year: number): number =>
  Object.keys(series).filter((k) => k.startsWith(`${year}-`)).length;

const main = async (): Promise<void> => {
  const [foreign, domestic, annTotal, annDom, annFor] = await Promise.all([
    fetchNights("FOR"),
    fetchNights("DOM"),
    fetchAnnual("TOTAL"),
    fetchAnnual("DOM"),
    fetchAnnual("FOR"),
  ]);
  const annualNights = buildAnnualNights(annTotal, annDom, annFor);
  if (Object.keys(foreign).length < 24)
    throw new Error(
      `Eurostat returned too few foreign months (${Object.keys(foreign).length}) — aborting`,
    );

  // Latest calendar year with all 12 foreign months present.
  const years = [
    ...new Set(Object.keys(foreign).map((k) => Number(k.slice(0, 4)))),
  ].sort((a, b) => b - a);
  const seasonalityYear = years.find((y) => yearMonths(foreign, y) === 12);
  if (!seasonalityYear) throw new Error("no complete calendar year of nights");

  const seasonality = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    const key = `${seasonalityYear}-${String(m).padStart(2, "0")}`;
    return {
      month: m,
      foreign: foreign[key] ?? 0,
      domestic: domestic[key] ?? 0,
    };
  });

  const annualForeign = years
    .filter((y) => yearMonths(foreign, y) === 12)
    .slice(0, 8)
    .sort((a, b) => a - b)
    .map((y) => ({
      year: y,
      nights: sumRange(foreign, y, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
    }));

  const annualTotal = seasonality.reduce((a, s) => a + s.foreign, 0) || 1;
  const peakMonth = seasonality.reduce(
    (best, s) => (s.foreign > best.foreign ? s : best),
    seasonality[0],
  ).month;
  const summerShareForeign =
    sumRange(foreign, seasonalityYear, [6, 7, 8, 9]) / annualTotal;
  const winterShareForeign =
    sumRange(foreign, seasonalityYear, [12, 1, 2, 3]) / annualTotal;

  // Source markets — latest year the by-origin dataset covers (try the
  // seasonality year, else one back). Share is against that year's total foreign
  // nights (same source family), so the tile reconciles with the headline.
  const annualForeignByYear = new Map(
    annualForeign.map((a) => [a.year, a.nights]),
  );
  let sourceMarketsYear = seasonalityYear;
  let sourceMarkets = await fetchOriginMarkets(sourceMarketsYear);
  if (sourceMarkets.length < 5) {
    sourceMarketsYear = seasonalityYear - 1;
    sourceMarkets = await fetchOriginMarkets(sourceMarketsYear);
  }
  const foreignTotalMarketsYear =
    annualForeignByYear.get(sourceMarketsYear) ??
    sourceMarkets.reduce((a, m) => a + m.nights, 0) ??
    1;

  const payload = {
    source: {
      publisher: "Eurostat",
      dataset: DATASET,
      url: `https://ec.europa.eu/eurostat/databrowser/view/${DATASET}`,
      note: "Nights spent at hotels & similar (NACE I551), Bulgaria, by guest residence.",
    },
    generatedAt: new Date().toISOString(),
    unit: "nights",
    seasonalityYear,
    peakMonth,
    summerShareForeign,
    winterShareForeign,
    seasonality,
    annualForeign,
    sourceMarketsYear,
    sourceMarketsForeignTotal: foreignTotalMarketsYear,
    sourceMarkets: sourceMarkets.slice(0, 10),
    annualNightsSource: {
      publisher: "Eurostat",
      dataset: ANNUAL_DATASET,
      url: `https://ec.europa.eu/eurostat/databrowser/view/${ANNUAL_DATASET}`,
      note: "Nights spent at all tourist accommodation (NACE I551-I553), Bulgaria, by guest residence.",
    },
    annualNights,
  };

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2));
  console.log(
    `wrote ${OUT_FILE} — seasonality ${seasonalityYear}, peak month ${peakMonth}, ` +
      `summer ${(summerShareForeign * 100).toFixed(0)}% / winter ${(winterShareForeign * 100).toFixed(0)}% of foreign nights; ` +
      `annual ${annualNights[0].year}–${annualNights.at(-1)!.year} (${annualNights.at(-1)!.total} nights in ${annualNights.at(-1)!.year})`,
  );
};

// Only when run as a script: the test imports buildAnnualNights.
if (process.argv[1] === __filename)
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
