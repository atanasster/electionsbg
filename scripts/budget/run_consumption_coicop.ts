// Household final consumption expenditure by COICOP purpose — Eurostat
// nama_10_co3_p3, geo=BG. Writes data/budget/revenue_breakdown/consumption.json.
// This is the tax-base side of the VAT policy simulator: each COICOP category
// maps to a VAT regime (standard / reduced / exempt), so re-rating a category
// re-prices the consumption recorded here.
//
// BG's COICOP detail lags ~2 years behind the headline accounts (ESA table 5
// is transmitted t+21 months), so the file carries two layers:
//   categories          COICOP structure, through `structureYear`
//   householdTotalEur   total household consumption (nama_10_gdp P31_S14),
//                       through the latest reported year
// Consumers scale the structure-year category values by
// householdTotal(target) / householdTotal(structureYear).
//
// Unit hazard: after the 2026 euro changeover Eurostat is re-denominating
// BG "national currency" series to euros dataset-by-dataset — at the time of
// writing nama_10_gdp CP_MNAC is already euro while nama_10_co3_p3 CP_MNAC is
// still leva. Labels can't be trusted, so each fetch is anchor-validated:
// GDP (B1GQ) against macro.json nominalGdp, and the COICOP TOTAL against the
// unit-resolved household total.
//
// Usage:
//   npx tsx scripts/budget/run_consumption_coicop.ts

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { BGN_PER_EUR } from "../../src/lib/currency";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const OUT_FILE = path.join(
  PROJECT_ROOT,
  "data/budget/revenue_breakdown/consumption.json",
);
const MACRO_FILE = path.join(PROJECT_ROOT, "data/macro.json");

const EUROSTAT_BASE =
  "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data";
const COICOP_DATASET = "nama_10_co3_p3";
const GDP_DATASET = "nama_10_gdp";
const SOURCE_URL =
  "https://ec.europa.eu/eurostat/databrowser/view/nama_10_co3_p3/default/table";

const START_YEAR = 2015;

// The 12 COICOP divisions. Their sum must reconcile with TOTAL (the dataset
// also reports 3-digit groups, which we keep for rate mapping but validate
// only at division level — Eurostat leaves some 3-digit cells empty for BG).
const COICOP_DIVISIONS = [
  "CP01",
  "CP02",
  "CP03",
  "CP04",
  "CP05",
  "CP06",
  "CP07",
  "CP08",
  "CP09",
  "CP10",
  "CP11",
  "CP12",
] as const;

type EurostatResponse = {
  value: Record<string, number>;
  dimension: Record<
    string,
    {
      category: {
        index: Record<string, number>;
        label: Record<string, string>;
      };
    }
  >;
  size?: number[];
  id?: string[];
};

const fetchDataset = async (
  dataset: string,
  filters: Record<string, string | string[]>,
): Promise<EurostatResponse> => {
  const params = new URLSearchParams({ format: "JSON", lang: "EN" });
  for (const [k, v] of Object.entries(filters)) {
    for (const item of Array.isArray(v) ? v : [v]) params.append(k, item);
  }
  const url = `${dataset}?${params.toString()}`;
  const res = await fetch(`${EUROSTAT_BASE}/${url}`);
  if (!res.ok) {
    throw new Error(`Eurostat ${url} returned ${res.status}`);
  }
  return (await res.json()) as EurostatResponse;
};

// JSON-stat stride walk — same trick as fetch_cofog.ts, generalized to
// recover any one category dimension (`catDim`) alongside time.
const decode = (
  json: EurostatResponse,
  catDim: string,
): { cat: string; year: number; value: number }[] => {
  const dimOrder = json.id ?? [];
  const sizes = json.size ?? [];
  const labelByDim: Record<string, string[]> = {};
  for (const dim of dimOrder) {
    const idx =
      dim === catDim || dim === "time"
        ? json.dimension[dim]?.category.index
        : null;
    if (!idx) continue;
    const arr: string[] = [];
    for (const [label, i] of Object.entries(idx)) arr[i] = label;
    labelByDim[dim] = arr;
  }

  const strides: number[] = new Array(dimOrder.length).fill(1);
  for (let i = dimOrder.length - 2; i >= 0; i--) {
    strides[i] = strides[i + 1] * (sizes[i + 1] ?? 1);
  }

  const out: { cat: string; year: number; value: number }[] = [];
  for (const [keyStr, value] of Object.entries(json.value)) {
    if (typeof value !== "number") continue;
    const key = Number(keyStr);
    let cat = "";
    let year = 0;
    for (let i = 0; i < dimOrder.length; i++) {
      const dim = dimOrder[i];
      const coord = Math.floor(key / strides[i]) % (sizes[i] ?? 1);
      const label = labelByDim[dim]?.[coord];
      if (label === undefined) continue;
      if (dim === catDim) cat = label;
      else if (dim === "time") year = Number(label);
    }
    if (!cat || !Number.isFinite(year)) continue;
    if (year < START_YEAR) continue;
    out.push({ cat, year, value });
  }
  return out;
};

// Decide whether a series Eurostat labels "national currency" is actually
// leva or already re-denominated euro, by comparing one observation against
// an anchor known to be in EUR millions. Tolerance is generous (±15%) —
// concept and vintage gaps are a few percent, the two candidate units are
// 96% apart.
const detectUnit = (
  observed: number,
  anchorEurM: number,
  what: string,
): "BGN" | "EUR" => {
  const asEur = observed / anchorEurM;
  const asBgn = observed / BGN_PER_EUR / anchorEurM;
  if (Math.abs(asEur - 1) < 0.15) return "EUR";
  if (Math.abs(asBgn - 1) < 0.15) return "BGN";
  throw new Error(
    `${what}: cannot resolve unit — observed ${observed}, anchor ${anchorEurM} EUR M (ratios ${asEur.toFixed(2)} / ${asBgn.toFixed(2)})`,
  );
};

interface CategoryOut {
  code: string;
  labelEn: string;
  /** 0 = TOTAL, 1 = division (CP01), 2 = group (CP011). */
  depth: number;
  /** year → EUR (units, not millions). */
  valuesEur: Record<string, number>;
}

const main = async (): Promise<void> => {
  const macro = JSON.parse(fs.readFileSync(MACRO_FILE, "utf-8")) as {
    series: { nominalGdp: { year: number; value: number }[] };
  };
  const gdpAnchor = new Map(
    macro.series.nominalGdp.map((p) => [p.year, p.value] as const),
  );

  // --- household totals + GDP, for scaling and unit detection -------------
  console.log(`Fetching ${GDP_DATASET} (BG, P31_S14 + B1GQ, CP_MNAC)…`);
  const gdpJson = await fetchDataset(GDP_DATASET, {
    geo: "BG",
    freq: "A",
    unit: "CP_MNAC",
    na_item: ["P31_S14", "B1GQ"],
  });
  const gdpRows = decode(gdpJson, "na_item");
  const b1gq = gdpRows.filter((r) => r.cat === "B1GQ");
  const anchorRow = b1gq
    .filter((r) => gdpAnchor.has(r.year))
    .sort((a, b) => b.year - a.year)[0];
  if (!anchorRow) throw new Error("no GDP observation overlaps macro.json");
  const gdpUnit = detectUnit(
    anchorRow.value,
    gdpAnchor.get(anchorRow.year)!,
    `${GDP_DATASET} B1GQ ${anchorRow.year}`,
  );
  console.log(`  ${GDP_DATASET} CP_MNAC resolved as ${gdpUnit}`);
  const toEurM = (v: number, unit: "BGN" | "EUR"): number =>
    unit === "BGN" ? v / BGN_PER_EUR : v;

  const householdTotalEur: Record<string, number> = {};
  for (const r of gdpRows) {
    if (r.cat !== "P31_S14") continue;
    householdTotalEur[String(r.year)] = Math.round(
      toEurM(r.value, gdpUnit) * 1_000_000,
    );
  }
  const householdYears = Object.keys(householdTotalEur)
    .map(Number)
    .sort((a, b) => a - b);
  if (!householdYears.length) throw new Error("no P31_S14 observations");

  // --- COICOP structure ----------------------------------------------------
  console.log(`Fetching ${COICOP_DATASET} (BG, annual, CP_MNAC)…`);
  const json = await fetchDataset(COICOP_DATASET, {
    geo: "BG",
    freq: "A",
    unit: "CP_MNAC",
  });
  const rows = decode(json, "coicop");
  const labels = json.dimension.coicop?.category.label ?? {};

  const totalRow = rows
    .filter((r) => r.cat === "TOTAL" && householdTotalEur[String(r.year)])
    .sort((a, b) => b.year - a.year)[0];
  if (!totalRow) throw new Error("TOTAL category missing from response");
  // COICOP TOTAL is domestic-concept and a different vintage than P31_S14, so
  // the anchor match is loose (~5%) — but far inside the ±15% tolerance.
  const coicopUnit = detectUnit(
    totalRow.value,
    householdTotalEur[String(totalRow.year)] / 1_000_000,
    `${COICOP_DATASET} TOTAL ${totalRow.year}`,
  );
  console.log(`  ${COICOP_DATASET} CP_MNAC resolved as ${coicopUnit}`);

  const byCode = new Map<string, CategoryOut>();
  for (const r of rows) {
    let cat = byCode.get(r.cat);
    if (!cat) {
      cat = {
        code: r.cat,
        labelEn: labels[r.cat] ?? r.cat,
        depth: r.cat === "TOTAL" ? 0 : r.cat.length - 3,
        valuesEur: {},
      };
      byCode.set(r.cat, cat);
    }
    cat.valuesEur[String(r.year)] = Math.round(
      toEurM(r.value, coicopUnit) * 1_000_000,
    );
  }

  const total = byCode.get("TOTAL")!;
  const structureYears = Object.keys(total.valuesEur)
    .map(Number)
    .sort((a, b) => a - b);
  const structureYear = structureYears[structureYears.length - 1];
  if (structureYear < 2021) {
    throw new Error(`COICOP structure year is ${structureYear} — too stale`);
  }

  // Sanity: the 12 divisions must sum to TOTAL within 1% for every year.
  for (const y of structureYears) {
    const ykey = String(y);
    const totalVal = total.valuesEur[ykey];
    if (!totalVal) continue;
    let sum = 0;
    let missing = 0;
    for (const d of COICOP_DIVISIONS) {
      const v = byCode.get(d)?.valuesEur[ykey];
      if (v == null) missing++;
      else sum += v;
    }
    if (missing > 0) {
      console.warn(`⚠ ${y}: ${missing} divisions missing`);
      continue;
    }
    const drift = Math.abs(sum - totalVal) / totalVal;
    if (drift > 0.01) {
      throw new Error(
        `${y}: division sum (${(sum / 1e9).toFixed(2)}B) differs from TOTAL (${(totalVal / 1e9).toFixed(2)}B) by ${(drift * 100).toFixed(1)}%`,
      );
    }
  }

  const categories = [...byCode.values()].sort((a, b) =>
    a.code === "TOTAL" ? -1 : b.code === "TOTAL" ? 1 : a.code < b.code ? -1 : 1,
  );

  const payload = {
    generatedAt: new Date().toISOString(),
    country: "BG",
    source: {
      name: "Eurostat",
      dataset: COICOP_DATASET,
      url: SOURCE_URL,
      scalingDataset: GDP_DATASET,
      filters: {
        freq: "A",
        unit: `CP_MNAC (resolved: COICOP=${coicopUnit}, totals=${gdpUnit}; converted to EUR at 1 EUR = ${BGN_PER_EUR} BGN)`,
        geo: "BG",
      },
    },
    // Latest year with full COICOP detail. Category values at later years are
    // estimated by scaling with householdTotalEur — see file header.
    structureYear,
    structureYears,
    // Total household consumption (national concept, P31_S14), EUR — runs
    // ahead of the COICOP detail by ~2 years.
    householdTotalEur,
    latestTotalYear: householdYears[householdYears.length - 1],
    categories,
  };

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2) + "\n");
  console.log(
    `Wrote ${path.relative(PROJECT_ROOT, OUT_FILE)} — ${categories.length} categories, structure ${structureYears[0]}–${structureYear}, totals through ${payload.latestTotalYear}`,
  );
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
