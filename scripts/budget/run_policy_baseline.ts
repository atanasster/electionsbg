// Assembles data/budget/derived/policy_baseline.json — the single small file
// the /budget/simulator screen fetches. Everything the policy engine
// (src/lib/bgTaxPolicy.ts) needs at runtime, pre-joined offline:
//
//   revenue        executed КФП lines (ДДС / ДДФЛ / корпоративен / дивиденти)
//                  at the latest CLOSED fiscal year, plus the ДДФЛ
//                  rate-sensitive share from the НАП annual report
//   vat            consumption slices pre-scaled to the baseline year with
//                  their current-law regimes, plus the year-by-year
//                  calibration table (modeled vs actual ДДС)
//   modIdentity    above-cap wage mass from the PIT-vs-insurable-base
//                  identity (НАП PIT file × Eurostat D613CE)
//
// Inputs: data/budget/kfp.json, data/budget/revenue_breakdown/pit/*.json,
// data/budget/revenue_breakdown/consumption.json, data/macro.json, and one
// live Eurostat call (gov_10a_taxag). Unit hazard: post-changeover Eurostat
// re-denominates BG "national currency" series dataset-by-dataset — the
// D61 fetch is plausibility-anchored against GDP (contributions are 6-14%
// of GDP in any sane reading) instead of trusting the unit label.
//
// Usage:
//   npx tsx scripts/budget/run_policy_baseline.ts

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import * as XLSX from "xlsx";

import { BGN_PER_EUR } from "../../src/lib/currency";
import { MOD_BY_YEAR, PIT_RATE, SSC_EMPLOYEE_RATE } from "../../src/lib/bgTax";
import {
  VAT_SLICES,
  VAT_POLICY_CURRENT,
  computeVatRevenue,
  pitRevenueOnBands,
  type VatBaseSlice,
  type VatRegime,
} from "../../src/lib/bgTaxPolicy";
import { fitEarnings } from "./earnings_distribution";
import { buildAndGateIncomeTiers } from "./nap_income_tiers";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const OUT_FILE = path.join(
  PROJECT_ROOT,
  "data/budget/derived/policy_baseline.json",
);

// Employee contributions actually received by general government — the
// statutory 13.78% minus the 2.2pp second-pillar (УПФ) slice routed to the
// private funds. Used to recover the capped insurable base from D613CE.
const SSC_EMPLOYEE_S13 = SSC_EMPLOYEE_RATE - 0.022;

// Coarse add-back for child relief refunded out of the ДДФЛ line, so the
// PIT base isn't understated (~€60M revenue ≈ €0.6B base, ~2% effect).
const CHILD_RELIEF_REVENUE_EUR = 60e6;

// НОИ "Среден осигурителен доход" annual analysis (nssi.bg SOD_{YYYY}.pdf) —
// average monthly insurable income of трета-категория employees, BGN. The
// level anchor of the earnings-distribution fit; one curated value per
// identity year, same pattern as NAP_ANNUAL_REPORTS.
const NOI_SOD_EMPLOYEES_BGN: Record<number, number> = {
  2024: 1680.45,
  2025: 1867.86, // НОИ SOD_2025 (published 12.02.2026); applies once a 2025 НАП PIT file is on disk
};

// κ gate: the fitted band grid at the flat 10% must reproduce the НАП
// employment-PIT line within this tolerance, or the fit is rejected.
const KAPPA_TOLERANCE = 0.08;

// --- expenditure-side curated constants -------------------------------------
// Pensioner head count (НОИ, ~2.06M in 2024) and the 60 лв COVID supplement
// folded into pension bases in July 2022 — the "включва ли се ковид добавката"
// debate is whether indexation applies to that slice.
const PENSIONER_COUNT = 2_050_000; // НОИ: 2024 avg ~2.045M, Apr-2025 ~2.053M
const COVID_SUPPLEMENT_EUR_MONTHLY = 60 / BGN_PER_EUR; // ≈ €30.68
// Minimum wage 2026 (МРЗ) — the КТ чл.244 formula pegs next year's МРЗ to
// 50% of average gross wage; the un-tie debate freezes it instead.
const MIN_WAGE_EUR = 620.2; // 2026 МРЗ = 1213 BGN ÷ 1.95583 (РМС 243/13.11.2025)
// NATO-definition defense spending, % of GDP (NATO annual estimate for BG;
// differs from COFOG GF02 ~0.66% by military pensions, paramilitary forces
// and equipment-payment timing). Update when NATO publishes the new year.
// NATO-definition defence spending, % of GDP — NATO compendium (def-exp-2025,
// Table 3, BG row): 2024e 1.95%, 2025e 2.06%. Use the latest (2025) estimate.
// Keep in step with NATO_COMPENDIUM_EDITION in euPolicyPresets.ts.
const NATO_DEFENSE_PCT_GDP = 2.06; // NATO 2025 estimate
// Budget-paid personal contributions (КСО чл. 6, ал. 5, referencing чл. 4,
// ал. 1, т. 2, 3, 4 и 10; health side via ЗЗО чл. 40, ал. 1, т. 1, б. "а" +
// the special statutes). Two НОИ SOD categories cover the population —
// "Държавни служители, следователи, съдии и прокурори; членове на
// избирателни комисии" and "Отбрана и сигурност" (военнослужещи, МВР,
// ДАНС/ДАР/ДАТО/НСО, ГДИН — НОИ does not split them further). Headcounts
// are from the SOD 2024 edition (the 2025 one publishes averages only).
// The lever shifts the STANDARD employee share (13.78%) onto the employees;
// the elevated special-category pension rates stay budget-paid either way.
const BUDGET_PAID_SSC_GROUPS = [
  { count: 64_178, avgWageBgn: 2581.64 }, // administration + judiciary + EC members
  { count: 68_684, avgWageBgn: 2438.86 }, // defense & security
];
const BUDGET_PAID_SSC_COUNT = BUDGET_PAID_SSC_GROUPS.reduce(
  (s, g) => s + g.count,
  0,
);
const BUDGET_PAID_SSC_AVG_WAGE_EUR =
  BUDGET_PAID_SSC_GROUPS.reduce((s, g) => s + g.count * g.avgWageBgn, 0) /
  BUDGET_PAID_SSC_COUNT /
  BGN_PER_EUR; // ≈ €1,282 weighted
// Approximate share of the consolidated Персонал line belonging to the
// sectors exempted from wage restraint in the 2026 debate (военни, полицаи,
// лекари, учители). Curated approximation — caption as such.
const EXEMPT_PERSONNEL_SHARE = 0.55;
// НОИ quarterly statistical bulletin (nssi.bg) — pensioners by basic-monthly-
// pension band (sheet "grupiosn (2)") + the per-type minima (sheet "min").
// Quarterly updates: the filename is STATB{Q}{YYYY}.xls with Q ∈ 1..4
// (1 = към 31.III, 2 = 30.VI, 3 = 30.IX, 4 = 31.XII) — bump the URL when
// НОИ publishes the next quarter's bulletin.
const NOI_STATB_URL = "https://nssi.bg/wp-content/uploads/STATB12026.xls";
// НОИ's own published monthly cost of topping pensions up to the minimum
// (Yearbook 2024, table 5.8, end-2024) ≈ 131.6M лв/month. The warn-level
// validation anchor for the band-grain floor model below.
const NOI_MIN_TOPUP_MONTHLY_BGN = 131.6e6;
// Slider ceiling on the pension-floor lever — bands above this are never
// reachable, so they are not shipped.
const PENSION_FLOOR_BAND_CEILING_EUR = 700;

interface KfpFile {
  snapshots: {
    period: string;
    fiscalYear: number;
    sections: {
      kind: string;
      labelBg: string;
      executed: { amountEur: number } | null;
      lines: {
        labelBg: string;
        executed: { amountEur: number } | null;
        planned?: { amountEur: number } | null;
      }[];
    }[];
  }[];
}

interface ConsumptionFile {
  structureYear: number;
  householdTotalEur: Record<string, number>;
  categories: { code: string; valuesEur: Record<string, number> }[];
}

interface PitFile {
  fiscalYear: number;
  lines: { id: string; amountEur: number }[];
}

const readJson = <T>(rel: string): T =>
  JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, rel), "utf-8")) as T;

// --- Eurostat D613CE / D613CS with GDP-anchored unit detection -------------

const fetchContributions = async (
  year: number,
  gdpEurM: number,
): Promise<{ d613ceEurM: number; d613csEurM: number }> => {
  const params = new URLSearchParams({ format: "JSON", lang: "EN" });
  params.append("geo", "BG");
  params.append("freq", "A");
  params.append("unit", "MIO_NAC");
  params.append("sector", "S13");
  params.append("time", String(year));
  for (const item of ["D61", "D613CE", "D613CS"])
    params.append("na_item", item);
  const url = `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/gov_10a_taxag?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Eurostat gov_10a_taxag ${res.status}`);
  const json = (await res.json()) as {
    value: Record<string, number>;
    id: string[];
    size: number[];
    dimension: Record<string, { category: { index: Record<string, number> } }>;
  };
  const dimOrder = json.id;
  const strides: number[] = new Array(dimOrder.length).fill(1);
  for (let i = dimOrder.length - 2; i >= 0; i--)
    strides[i] = strides[i + 1] * (json.size[i + 1] ?? 1);
  const naIdx = dimOrder.indexOf("na_item");
  const labelArr: string[] = [];
  for (const [label, i] of Object.entries(
    json.dimension.na_item.category.index,
  ))
    labelArr[i] = label;
  const byItem: Record<string, number> = {};
  for (const [keyStr, value] of Object.entries(json.value)) {
    const item =
      labelArr[Math.floor(Number(keyStr) / strides[naIdx]) % json.size[naIdx]];
    if (item) byItem[item] = value;
  }
  const d61 = byItem.D61;
  if (d61 == null || byItem.D613CE == null || byItem.D613CS == null)
    throw new Error(`gov_10a_taxag missing items: ${JSON.stringify(byItem)}`);
  // Plausibility anchor: total contributions are 6-14% of GDP. Exactly one
  // denomination should land in that window.
  const eurOk = d61 / gdpEurM >= 0.06 && d61 / gdpEurM <= 0.14;
  const bgnOk =
    d61 / BGN_PER_EUR / gdpEurM >= 0.06 && d61 / BGN_PER_EUR / gdpEurM <= 0.14;
  if (eurOk === bgnOk)
    throw new Error(
      `cannot resolve gov_10a_taxag unit (D61=${d61}, GDP=${gdpEurM} EUR M)`,
    );
  const div = eurOk ? 1 : BGN_PER_EUR;
  console.log(`  gov_10a_taxag MIO_NAC resolved as ${eurOk ? "EUR" : "BGN"}`);
  return {
    d613ceEurM: byItem.D613CE / div,
    d613csEurM: byItem.D613CS / div,
  };
};

// --- Eurostat SES decile ratios (shape anchors for the earnings fit) -------

const fetchSesRatios = async (): Promise<{
  sigmaLower: number;
  sigmaUpper: number;
  wave: number;
}> => {
  const params = new URLSearchParams({ format: "JSON", lang: "EN" });
  params.append("geo", "BG");
  params.append("nace_r2", "B-S_X_O");
  params.append("isco08", "TOTAL");
  params.append("age", "TOTAL");
  params.append("sex", "T");
  params.append("worktime", "TOTAL");
  for (const item of ["D1_E_EUR", "MED_E_EUR", "D9_E_EUR"])
    params.append("indic_se", item);
  const url = `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/earn_ses_hourly?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Eurostat earn_ses_hourly ${res.status}`);
  const json = (await res.json()) as {
    value: Record<string, number>;
    id: string[];
    size: number[];
    dimension: Record<string, { category: { index: Record<string, number> } }>;
  };
  const dims = json.id;
  const strides: number[] = new Array(dims.length).fill(1);
  for (let i = dims.length - 2; i >= 0; i--)
    strides[i] = strides[i + 1] * (json.size[i + 1] ?? 1);
  const lab: Record<string, string[]> = {};
  for (const dim of ["indic_se", "time"]) {
    lab[dim] = [];
    for (const [k, v] of Object.entries(json.dimension[dim].category.index))
      lab[dim][v] = k;
  }
  const iIdx = dims.indexOf("indic_se");
  const tIdx = dims.indexOf("time");
  const byYear: Record<string, Record<string, number>> = {};
  for (const [k, v] of Object.entries(json.value)) {
    const key = Number(k);
    const ind = lab.indic_se[Math.floor(key / strides[iIdx]) % json.size[iIdx]];
    const yr = lab.time[Math.floor(key / strides[tIdx]) % json.size[tIdx]];
    byYear[yr] = byYear[yr] ?? {};
    byYear[yr][ind] = v;
  }
  const waves = Object.keys(byYear)
    .filter(
      (y) => byYear[y].D1_E_EUR && byYear[y].MED_E_EUR && byYear[y].D9_E_EUR,
    )
    .sort();
  const wave = waves[waves.length - 1];
  if (!wave) throw new Error("no complete SES decile wave for BG");
  const o = byYear[wave];
  // Decile RATIOS only — the EUR/BGN denomination cancels, sidestepping the
  // post-changeover unit hazard entirely. 1.2816 = Φ⁻¹(0.9).
  return {
    sigmaLower: Math.log(o.MED_E_EUR / o.D1_E_EUR) / 1.2816,
    sigmaUpper: Math.log(o.D9_E_EUR / o.MED_E_EUR) / 1.2816,
    wave: Number(wave),
  };
};

// --- НОИ pension-floor distribution (quarterly bulletin XLS) ----------------

interface PensionFloorData {
  asOf: string;
  minimumEur: number;
  bands: { upToEur: number; count: number; midEur: number }[];
  totalPensioners: number;
}

const ROMAN_MONTHS: Record<string, number> = {
  I: 1,
  II: 2,
  III: 3,
  IV: 4,
  V: 5,
  VI: 6,
  VII: 7,
  VIII: 8,
  IX: 9,
  X: 10,
  XI: 11,
  XII: 12,
};

const fetchNoiStatb = async (): Promise<string> => {
  const cacheDir = path.join(PROJECT_ROOT, "raw_data/budget");
  fs.mkdirSync(cacheDir, { recursive: true });
  const m = NOI_STATB_URL.match(/STATB(\d)(\d{4})\.xls$/i);
  if (!m) throw new Error(`unrecognised NOI_STATB_URL: ${NOI_STATB_URL}`);
  const cache = path.join(cacheDir, `noi-statb-${m[1]}-${m[2]}.xls`);
  if (fs.existsSync(cache)) return cache;
  const res = await fetch(NOI_STATB_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; electionsbg-budget/1.0; +https://electionsbg.com)",
    },
  });
  if (!res.ok) throw new Error(`nssi.bg STATB ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  // Legacy .xls = OLE compound document (D0 CF 11 E0).
  if (bytes.length < 10_000 || bytes[0] !== 0xd0 || bytes[1] !== 0xcf)
    throw new Error(`nssi.bg STATB: response is not an XLS (${bytes.length}B)`);
  fs.writeFileSync(cache, bytes);
  return cache;
};

const parsePensionFloor = (xlsPath: string): PensionFloorData => {
  const wb = XLSX.read(fs.readFileSync(xlsPath), { type: "buffer" });
  const bandSheet = wb.Sheets["grupiosn (2)"];
  const minSheet = wb.Sheets["min"];
  if (!bandSheet || !minSheet)
    throw new Error(
      `НОИ STATB: expected sheets "grupiosn (2)" + "min", got ${wb.SheetNames.join(", ")}`,
    );
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(bandSheet, {
    header: 1,
    raw: true,
  });

  // Title carries the snapshot date as "към 31.III.2026 г."
  let asOf = "";
  for (const r of rows.slice(0, 6)) {
    const text = (r ?? []).map((c) => String(c ?? "")).join(" ");
    const dm = text.match(/към\s+(\d{1,2})\.([IVX]+)\.(\d{4})/);
    if (dm && ROMAN_MONTHS[dm[2]]) {
      asOf = `${dm[3]}-${String(ROMAN_MONTHS[dm[2]]).padStart(2, "0")}-${dm[1].padStart(2, "0")}`;
      break;
    }
  }
  if (!asOf) throw new Error("НОИ STATB: no към DD.MM.YYYY date in the title");

  let totalPensioners = 0;
  const bands: PensionFloorData["bands"] = [];
  let prevUpTo = 0;
  for (const r of rows) {
    if (!r) continue;
    const label = typeof r[1] === "string" ? r[1].trim() : "";
    const count = typeof r[2] === "number" ? r[2] : null;
    if (label === "Общо" && count != null) {
      totalPensioners = count;
      continue;
    }
    // Band rows are numbered in col 0; memo rows ("до X евро вкл.",
    // "на X евро") are not. Open-ended "над X евро" is beyond the slider.
    if (typeof r[0] !== "number" || count == null) continue;
    const um = label.match(/до\s+([\d.]+)\s*евро/);
    if (!um || /над/.test(label)) continue;
    const upToEur = Number(um[1]);
    if (!Number.isFinite(upToEur) || upToEur <= prevUpTo) continue;
    if (upToEur > PENSION_FLOOR_BAND_CEILING_EUR) break;
    bands.push({
      upToEur,
      count,
      midEur: Math.round(((prevUpTo + upToEur) / 2) * 100) / 100,
    });
    prevUpTo = upToEur;
  }
  if (bands.length < 6)
    throw new Error(
      `НОИ STATB: only ${bands.length} pension bands parsed — sheet layout changed`,
    );
  if (totalPensioners < 1.5e6 || totalPensioners > 2.5e6)
    throw new Error(
      `НОИ STATB: implausible pensioner total ${totalPensioners}`,
    );

  // The statutory minimum old-age pension (чл.68, ал.1 и 2 КСО) from the
  // at-minimum sheet — first occurrence is the Фонд "Пенсии" block.
  const minRows = XLSX.utils.sheet_to_json<(string | number | null)[]>(
    minSheet,
    { header: 1, raw: true },
  );
  let minimumEur = 0;
  for (const r of minRows) {
    if (!r) continue;
    const label = typeof r[0] === "string" ? r[0] : "";
    if (
      /чл\.\s*68,\s*ал\.\s*1\s*и\s*2/.test(label) &&
      typeof r[1] === "number"
    ) {
      minimumEur = r[1];
      break;
    }
  }
  if (minimumEur < 200 || minimumEur > 600)
    throw new Error(`НОИ STATB: implausible minimum pension €${minimumEur}`);
  return { asOf, minimumEur, bands, totalPensioners };
};

// --- teachers: Eurostat ISCED 1-3 classroom teachers + NSI A21 wages --------

const fetchTeacherCount = async (): Promise<{
  count: number;
  year: number;
}> => {
  const params = new URLSearchParams({ format: "JSON", lang: "EN" });
  params.append("geo", "BG");
  params.append("sex", "T");
  params.append("age", "TOTAL");
  for (const lvl of ["ED1", "ED2", "ED3"]) params.append("isced11", lvl);
  const url = `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/educ_uoe_perp01?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Eurostat educ_uoe_perp01 ${res.status}`);
  const json = (await res.json()) as {
    value: Record<string, number>;
    id: string[];
    size: number[];
    dimension: Record<string, { category: { index: Record<string, number> } }>;
  };
  const dims = json.id;
  const strides: number[] = new Array(dims.length).fill(1);
  for (let i = dims.length - 2; i >= 0; i--)
    strides[i] = strides[i + 1] * (json.size[i + 1] ?? 1);
  const lab: Record<string, string[]> = {};
  for (const dim of ["isced11", "time"]) {
    lab[dim] = [];
    for (const [k, v] of Object.entries(json.dimension[dim].category.index))
      lab[dim][v] = k;
  }
  const lIdx = dims.indexOf("isced11");
  const tIdx = dims.indexOf("time");
  const byYear: Record<string, Record<string, number>> = {};
  for (const [k, v] of Object.entries(json.value)) {
    const key = Number(k);
    const lvl = lab.isced11[Math.floor(key / strides[lIdx]) % json.size[lIdx]];
    const yr = lab.time[Math.floor(key / strides[tIdx]) % json.size[tIdx]];
    byYear[yr] = byYear[yr] ?? {};
    byYear[yr][lvl] = v;
  }
  const years = Object.keys(byYear)
    .filter((y) => byYear[y].ED1 && byYear[y].ED2 && byYear[y].ED3)
    .sort();
  const year = years[years.length - 1];
  if (!year) throw new Error("educ_uoe_perp01: no complete ED1-ED3 year");
  const o = byYear[year];
  const count = o.ED1 + o.ED2 + o.ED3;
  if (count < 50_000 || count > 100_000)
    throw new Error(`educ_uoe_perp01: implausible teacher count ${count}`);
  return { count, year: Number(year) };
};

const fetchNsiWages = async (): Promise<{
  sectorWageEur: number;
  economyWageEur: number;
  year: number;
}> => {
  // NSI open-data id=612: average annual wage by A21 activity × ownership.
  // CAUTION: unlike Eurostat's sparse dict, this JSON-stat `value` is a
  // dense LIST indexed by the dimension strides.
  const url = "https://www.nsi.bg/opendata/getopendata_json.php?l=en&id=612";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`NSI opendata 612 ${res.status}`);
  const json = (await res.json()) as {
    value: (number | null)[];
    id: string[];
    size: number[];
    dimension: Record<string, { category: { index?: Record<string, number> } }>;
  };
  if (!Array.isArray(json.value))
    throw new Error("NSI opendata 612: value is not a list — shape changed");
  const dims = json.id;
  const strides: number[] = new Array(dims.length).fill(1);
  for (let i = dims.length - 2; i >= 0; i--)
    strides[i] = strides[i + 1] * (json.size[i + 1] ?? 1);
  const idxOf = (dim: string, key: string): number => {
    const i = json.dimension[dim]?.category.index?.[key];
    if (i == null) throw new Error(`NSI opendata 612: no ${dim}=${key}`);
    return i;
  };
  // The Units dimension is size-1 with no index — its stride term is 0.
  const at = (nace: string, year: string, own: string): number | null =>
    json.value[
      idxOf("NACE2008A21", nace) * strides[dims.indexOf("NACE2008A21")] +
        idxOf("periods", year) * strides[dims.indexOf("periods")] +
        idxOf("Ownership", own) * strides[dims.indexOf("Ownership")]
    ] ?? null;
  const years = Object.keys(json.dimension.periods.category.index ?? {}).sort();
  for (let i = years.length - 1; i >= 0; i--) {
    const y = years[i];
    const sectorBgn = at("P", y, "1"); // education, public ownership
    const economyBgn = at("0", y, "total"); // total economy
    if (sectorBgn == null || economyBgn == null) continue;
    for (const [label, v] of [
      ["education-public", sectorBgn],
      ["economy-total", economyBgn],
    ] as const)
      if (v < 15_000 || v > 60_000)
        throw new Error(`NSI opendata 612: implausible ${label} wage ${v} BGN`);
    return {
      sectorWageEur: sectorBgn / BGN_PER_EUR,
      economyWageEur: economyBgn / BGN_PER_EUR,
      year: Number(y),
    };
  }
  throw new Error("NSI opendata 612: no year with both education + total");
};

// --- КФП revenue lines ------------------------------------------------------

interface YearRevenue {
  fiscalYear: number;
  vatEur: number;
  pitEur: number;
  corporateEur: number;
  dividendEur: number;
  totalRevenueEur: number;
  /** Section IV budget balance (negative = deficit) — the deficit-framing
   *  anchor on the simulator. */
  balanceEur: number;
  personnelEur: number;
  capitalExecEur: number;
  capitalPlanEur: number;
}

const extractRevenue = (kfp: KfpFile): YearRevenue[] => {
  const out: YearRevenue[] = [];
  for (const sn of kfp.snapshots) {
    if (!sn.period.endsWith("-12")) continue; // closed years only
    const rev = sn.sections.find((s) => s.kind === "revenue");
    const bal = sn.sections.find((s) => s.kind === "balance");
    if (!rev) continue;
    const expSec = sn.sections.find(
      (s) => s.kind === "expenditure" && /Разходи и трансфери/.test(s.labelBg),
    );
    const expLine = (re: RegExp) =>
      expSec?.lines.find((x) => re.test(x.labelBg));
    const personnel = expLine(/^Персонал/i);
    const capital = expLine(/^Капиталови разходи/i);
    const line = (re: RegExp): number | null => {
      const l = rev.lines.find((x) => re.test(x.labelBg));
      return l?.executed?.amountEur ?? null;
    };
    const vat = line(/добавената стойност/i);
    const pit = line(/доходите на физически лица/i);
    const corp = line(/^корпоративен данък/i);
    const dividend = line(/дивидентите/i);
    if (vat == null || pit == null || corp == null || dividend == null) {
      console.warn(`⚠ ${sn.fiscalYear}: missing revenue line, skipped`);
      continue;
    }
    out.push({
      fiscalYear: sn.fiscalYear,
      vatEur: vat,
      pitEur: pit,
      corporateEur: corp,
      dividendEur: dividend,
      totalRevenueEur: rev.executed?.amountEur ?? 0,
      balanceEur: bal?.executed?.amountEur ?? 0,
      personnelEur: personnel?.executed?.amountEur ?? 0,
      capitalExecEur: capital?.executed?.amountEur ?? 0,
      capitalPlanEur:
        (capital as { planned?: { amountEur?: number } | null } | undefined)
          ?.planned?.amountEur ?? 0,
    });
  }
  return out.sort((a, b) => a.fiscalYear - b.fiscalYear);
};

// --- excise category anchors (Агенция "Митници" chronicle) ------------------

interface CustomsFile {
  fiscalYear: number;
  source?: { document?: string };
  lines: { id: string; amountEur: number }[];
}

interface ExciseAnchors {
  year: number;
  fuelEur: number;
  dieselEur: number;
  petrolEur: number;
  tobaccoEur: number;
  alcoholEur: number;
  source: string;
}

/** Excise split for the per-product policy levers. Reads the Митници chronicle
 *  breakdown for the baseline year (diesel + petrol itemised; tobacco + alcohol
 *  as category lines), walking back up to two prior years if that file is not
 *  yet on disk. */
const loadExcise = (baselineYear: number): ExciseAnchors => {
  const dir = "data/budget/revenue_breakdown/customs";
  for (let y = baselineYear; y >= baselineYear - 2; y--) {
    const rel = `${dir}/${y}.json`;
    if (!fs.existsSync(path.join(PROJECT_ROOT, rel))) continue;
    const f = readJson<CustomsFile>(rel);
    const amt = (id: string): number =>
      f.lines.find((l) => l.id === id)?.amountEur ?? 0;
    const fuelEur = amt("excise_fuels");
    const dieselEur = amt("excise_diesel");
    const petrolEur = amt("excise_petrol");
    const tobaccoEur = amt("excise_tobacco");
    const alcoholEur = amt("excise_alcohol");
    if (dieselEur && petrolEur && tobaccoEur && alcoholEur) {
      return {
        year: y,
        fuelEur,
        dieselEur,
        petrolEur,
        tobaccoEur,
        alcoholEur,
        source: f.source?.document ?? `Агенция "Митници" ${y}`,
      };
    }
    console.warn(`⚠ customs ${y}: incomplete excise split, trying older`);
  }
  console.warn("⚠ no customs excise split found — excise anchors = 0");
  return {
    year: baselineYear,
    fuelEur: 0,
    dieselEur: 0,
    petrolEur: 0,
    tobaccoEur: 0,
    alcoholEur: 0,
    source: "—",
  };
};

// --- consumption slices ------------------------------------------------------

const sliceValues = (
  consumption: ConsumptionFile,
  year: number,
): VatBaseSlice[] | null => {
  const sy = consumption.structureYear;
  const totalNow = consumption.householdTotalEur[String(year)];
  const totalSy = consumption.householdTotalEur[String(sy)];
  if (!totalNow || !totalSy) return null;
  const direct = year <= sy;
  const scale = direct ? 1 : totalNow / totalSy;
  const byCode = new Map(
    consumption.categories.map((c) => [c.code, c.valuesEur]),
  );
  const out: VatBaseSlice[] = [];
  for (const s of VAT_SLICES) {
    const raw = byCode.get(s.code)?.[String(direct ? year : sy)];
    if (raw == null) {
      console.warn(`⚠ slice ${s.code}: no value at ${direct ? year : sy}`);
      continue;
    }
    const rate = s.rateAt(year);
    const regime: VatRegime | null =
      rate == null
        ? null
        : rate === VAT_POLICY_CURRENT.standardRate
          ? "standard"
          : rate === VAT_POLICY_CURRENT.reducedRate
            ? "reduced"
            : "zero";
    out.push({ group: s.group, valueEur: raw * scale * s.share, regime });
  }
  return out;
};

/** Modeled household VAT at a back-year's statutory rates (for the
 *  calibration table; blended mid-year rates ride through rateAt). */
const modeledAtYear = (
  consumption: ConsumptionFile,
  year: number,
): number | null => {
  const sy = consumption.structureYear;
  const totalNow = consumption.householdTotalEur[String(year)];
  const totalSy = consumption.householdTotalEur[String(sy)];
  if (!totalNow || !totalSy) return null;
  const direct = year <= sy;
  const scale = direct ? 1 : totalNow / totalSy;
  const byCode = new Map(
    consumption.categories.map((c) => [c.code, c.valuesEur]),
  );
  let modeled = 0;
  for (const s of VAT_SLICES) {
    const raw = byCode.get(s.code)?.[String(direct ? year : sy)];
    const rate = s.rateAt(year);
    if (raw == null || rate == null) continue;
    modeled += raw * scale * s.share * (rate / (1 + rate));
  }
  return modeled;
};

const main = async (): Promise<void> => {
  const kfp = readJson<KfpFile>("data/budget/kfp.json");
  const consumption = readJson<ConsumptionFile>(
    "data/budget/revenue_breakdown/consumption.json",
  );
  const macro = readJson<{
    series: {
      nominalGdp: { year: number; value: number }[];
      inflation: { value: number }[];
      labourIncome: { value: number }[];
    };
  }>("data/macro.json");

  const revenueYears = extractRevenue(kfp);
  if (!revenueYears.length) throw new Error("no closed КФП years");
  const baseline = revenueYears[revenueYears.length - 1];
  const baselineYear = baseline.fiscalYear;
  const excise = loadExcise(baselineYear);

  // GDP: macro.json runs a year or two behind the КФП close — extrapolate
  // the last value by its own trailing growth when the baseline year is
  // missing (context display only, not a scored quantity).
  const gdpSeries = macro.series.nominalGdp;
  const gdpAt = (y: number): number => {
    const hit = gdpSeries.find((p) => p.year === y);
    if (hit) return hit.value;
    const last = gdpSeries[gdpSeries.length - 1];
    const prev = gdpSeries[gdpSeries.length - 2];
    const growth = prev ? last.value / prev.value : 1;
    return last.value * Math.pow(growth, y - last.year);
  };
  const gdpEurM = gdpAt(baselineYear);
  // Nominal GDP growth (3-year trailing average) — projects the deficit
  // ratio onto the budget year being simulated (baseline + 1).
  const gTail = gdpSeries.slice(-4);
  let gAcc = 0;
  for (let i = 1; i < gTail.length; i++)
    gAcc += gTail[i].value / gTail[i - 1].value - 1;
  const gdpGrowthPct = (gAcc / (gTail.length - 1)) * 100;
  const gdpNextEurM = gdpEurM * (1 + gdpGrowthPct / 100);

  // --- НАП PIT shares + МОД identity (latest НАП year on disk) -------------
  const pitDir = path.join(PROJECT_ROOT, "data/budget/revenue_breakdown/pit");
  const pitYears = fs
    .readdirSync(pitDir)
    .map((f) => parseInt(f, 10))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const napYear = pitYears[pitYears.length - 1];
  const pit = readJson<PitFile>(
    `data/budget/revenue_breakdown/pit/${napYear}.json`,
  );
  const pitLine = (id: string): number => {
    const l = pit.lines.find((x) => x.id === id);
    if (!l) throw new Error(`НАП PIT line ${id} missing`);
    return l.amountEur;
  };
  const employment = pitLine("pit_employment_net");
  const nonEmployment = pitLine("pit_nonemployment_net");
  const finalTax = pitLine("pit_final_tax");
  const rateSensitiveShare =
    (employment + nonEmployment) / (employment + nonEmployment + finalTax);

  console.log(`Fetching gov_10a_taxag (BG, ${napYear})…`);
  const { d613ceEurM } = await fetchContributions(napYear, gdpAt(napYear));
  const pitBase = (employment + CHILD_RELIEF_REVENUE_EUR) / PIT_RATE;
  const insurableBase = (d613ceEurM * 1e6) / SSC_EMPLOYEE_S13;
  const grossWageMass = pitBase + SSC_EMPLOYEE_RATE * insurableBase;
  const aboveCapMassEur = grossWageMass - insurableBase;
  const capEur = MOD_BY_YEAR[napYear];
  if (!capEur) throw new Error(`MOD_BY_YEAR has no ${napYear}`);

  // --- earnings distribution (bracket scoring + МОД incidence) -------------
  const sodBgn = NOI_SOD_EMPLOYEES_BGN[napYear];
  if (!sodBgn)
    throw new Error(
      `NOI_SOD_EMPLOYEES_BGN has no ${napYear} — curate it from nssi.bg SOD_${napYear}.pdf`,
    );
  console.log(`Fetching earn_ses_hourly (BG decile ratios)…`);
  const ses = await fetchSesRatios();
  console.log(
    `  SES ${ses.wave}: σ_lower ${ses.sigmaLower.toFixed(3)}, σ_upper ${ses.sigmaUpper.toFixed(3)}`,
  );
  const fit = fitEarnings({
    sigmaLower: ses.sigmaLower,
    sigmaUpper: ses.sigmaUpper,
    cappedMeanEur: sodBgn / BGN_PER_EUR,
    insurableBaseEur: insurableBase,
    aboveCapMassEur,
    capEur,
  });

  // κ gate — the grid at the flat 10% vs the НАП-anchored employment
  // revenue. This is the model's validation: the level and tail came from
  // the identity, but the SHAPE (both σ, the split, the discretization)
  // must still pass through the actual payslip math and land on the line.
  const flat10 = [{ fromEur: 0, rate: PIT_RATE }];
  const gridPit = pitRevenueOnBands(fit.bands, capEur, flat10);
  const kappaIdentityYear = (employment + CHILD_RELIEF_REVENUE_EUR) / gridPit;
  if (Math.abs(kappaIdentityYear - 1) > KAPPA_TOLERANCE)
    throw new Error(
      `earnings grid fails the κ gate: κ=${kappaIdentityYear.toFixed(3)} (grid PIT €${(gridPit / 1e9).toFixed(2)}B vs НАП €${((employment + CHILD_RELIEF_REVENUE_EUR) / 1e9).toFixed(2)}B)`,
    );

  // Scale the grid to the baseline year: wage-mass growth proxied by the
  // КФП ДДФЛ line (flat tax → revenue ≈ proportional to the wage mass);
  // worker counts held flat. κ is re-derived at the baseline year against
  // the НАП-share estimate of the employment portion of that year's line.
  const napYearRevenue = revenueYears.find((y) => y.fiscalYear === napYear);
  if (!napYearRevenue) throw new Error(`no КФП year ${napYear}`);
  const wageGrowth = baseline.pitEur / napYearRevenue.pitEur;
  const employmentShare = employment / (employment + nonEmployment + finalTax);
  const nonEmploymentShare =
    nonEmployment / (employment + nonEmployment + finalTax);
  const capBaselineEur = MOD_BY_YEAR[baselineYear];
  if (!capBaselineEur) throw new Error(`MOD_BY_YEAR has no ${baselineYear}`);
  const bandsBaseline = fit.bands.map((b) => ({
    grossEur: Math.round(b.grossEur * wageGrowth * 100) / 100,
    workers: b.workers,
  }));
  const employmentRevenueBaseline = baseline.pitEur * employmentShare;
  const kappaBaseline =
    employmentRevenueBaseline /
    pitRevenueOnBands(bandsBaseline, capBaselineEur, flat10);

  // НАП income-tier validation: the fitted grid validates against the real
  // published 2023 НАП taxable-base distribution (body) and the employee tail
  // α is cross-checked to sit above the all-filer НАП α. fitEarnings is NOT
  // re-anchored — this only validates + sources the ordering. The same gates
  // run standalone in run_income_tiers.ts / __smoke_income_tiers.ts.
  // Shared build + gate + hard-throw (see nap_income_tiers.ts). If the BODY
  // gate ever fails after an NSI wage-series revision, the first knob to check
  // is NAP_YEAR_WAGE_FACTOR in nap_income_tiers.ts (the guessed deflation to the
  // НАП table year) — NOT the data-robust tail-ordering gate.
  const incomeTiers = buildAndGateIncomeTiers({
    bands: bandsBaseline,
    capEur: capBaselineEur,
    wageGrowthToBaseline: wageGrowth,
    identityYear: napYear,
    alpha: fit.alpha,
  });

  // --- VAT calibration table + baseline slices ------------------------------
  const calibration: {
    year: number;
    modeledEur: number;
    actualEur: number;
    factor: number;
  }[] = [];
  for (const y of revenueYears) {
    const modeled = modeledAtYear(consumption, y.fiscalYear);
    if (modeled == null) continue;
    calibration.push({
      year: y.fiscalYear,
      modeledEur: Math.round(modeled),
      actualEur: Math.round(y.vatEur),
      factor: y.vatEur / modeled,
    });
  }
  if (calibration.length < 3)
    throw new Error("too few calibration years — check consumption coverage");
  const factors = calibration.map((c) => c.factor);
  const spread =
    (Math.max(...factors) - Math.min(...factors)) /
    (factors.reduce((a, b) => a + b, 0) / factors.length);
  if (spread > 0.12)
    throw new Error(
      `VAT calibration factor drifts ${(spread * 100).toFixed(1)}% — rate map or scaling is missing something`,
    );

  const slices = sliceValues(consumption, baselineYear);
  if (!slices) throw new Error(`no consumption scaling for ${baselineYear}`);
  const baselineFactor = calibration[calibration.length - 1].factor;
  // Round-trip guard: the engine at current law must reproduce the
  // calibration row for the baseline year.
  const check = computeVatRevenue(slices, VAT_POLICY_CURRENT).modeledEur;
  const expect = calibration[calibration.length - 1].modeledEur;
  if (Math.abs(check - expect) / expect > 0.001)
    throw new Error(
      `engine/baseline mismatch: ${check} vs ${expect} — slice join broke`,
    );

  // --- expenditure side: pensions, administration, МРЗ ----------------------
  // Pension mass from the НОИ B1 fund execution (latest closed year there).
  const noi = readJson<{
    years: {
      fiscalYear: number;
      totals: { pensions: { amountEur: number } };
    }[];
  }>("data/budget/noi/funds.json");
  const noiLatest = noi.years[noi.years.length - 1];
  const pensionMassEur = noiLatest.totals.pensions.amountEur;
  // Swiss-rule inputs: latest 4-quarter averages of HICP and insurable-income
  // growth — the July indexation looks at the prior year.
  const last4 = (series: { value: number }[]): number =>
    series.slice(-4).reduce((a, p) => a + p.value, 0) /
    Math.min(4, series.length);
  const cpiPct = last4(macro.series.inflation as { value: number }[]);
  const wageGrowthPct = last4(macro.series.labourIncome as { value: number }[]);

  // Administration: national positions + vacancy from the Доклад aggregates,
  // payroll from the per-ministry Персонал totals (coverage is the curated
  // EXECUTION_REPORTS set — emit coverage so the UI can caption it).
  const personnel = readJson<{
    national: Record<
      string,
      { positions: { total: number; vacant: number; filled: number | null } }
    >;
    byMinistry: Record<
      string,
      {
        totalPersonnel?: {
          executed?: { amountEur?: number | null } | null;
        } | null;
        totalHeadcount?: { executed?: number | null } | null;
      }[]
    >;
  }>("data/budget/personnel.json");
  const natYears = Object.keys(personnel.national).sort();
  const natLatest = personnel.national[natYears[natYears.length - 1]];
  const minYears = Object.keys(personnel.byMinistry).sort();
  const minLatest = personnel.byMinistry[minYears[minYears.length - 1]];
  const adminPayrollEur = minLatest.reduce(
    (a, m) => a + (m.totalPersonnel?.executed?.amountEur ?? 0),
    0,
  );
  if (adminPayrollEur <= 0)
    throw new Error(
      "administration payroll resolved to 0 — field shape changed",
    );
  const adminCoveredHeadcount = minLatest.reduce(
    (a, m) => a + (m.totalHeadcount?.executed ?? 0),
    0,
  );

  // МРЗ: КТ чл.244 pegs next year's МРЗ to 50% of the average gross wage.
  // Rather than re-derive that average (our band mean is insurable-income
  // anchored and understates the NSI headline wage), use the formula's own
  // recursion: МРЗ grows with the average wage, so next = current × (1+g).
  const minWageFormulaEur = MIN_WAGE_EUR * (1 + wageGrowthPct / 100);

  // --- pension floor (минимална пенсия) -------------------------------------
  console.log(`Fetching НОИ STATB bulletin (${NOI_STATB_URL})…`);
  const pensionFloor = parsePensionFloor(await fetchNoiStatb());
  // Validation gate (warn, don't throw): the band-grain model's implied
  // CURRENT top-up-to-minimum cost vs НОИ's own published figure. Band
  // midpoints are coarse exactly where it matters — pensions cluster AT the
  // per-type minima sitting on the band edges (322.37 / 274.02 / 241.78 are
  // themselves minima), and the per-type minima differ (наследствени top up
  // to 241.78, not 322.37) — so the midpoint model undershoots the ledger.
  // The RAISE lever is insulated from this: everyone at/below the current
  // minimum is scored from the minimum itself, not the band mid.
  const impliedTopupMonthlyEur = pensionFloor.bands.reduce(
    (a, b) => a + b.count * Math.max(0, pensionFloor.minimumEur - b.midEur),
    0,
  );
  const noiTopupMonthlyEur = NOI_MIN_TOPUP_MONTHLY_BGN / BGN_PER_EUR;
  const topupRatio = impliedTopupMonthlyEur / noiTopupMonthlyEur;
  if (Math.abs(topupRatio - 1) > 0.25)
    console.warn(
      `⚠ pension-floor model: implied current top-up €${(impliedTopupMonthlyEur / 1e6).toFixed(1)}M/mo ` +
        `vs НОИ ~€${(noiTopupMonthlyEur / 1e6).toFixed(1)}M/mo (×${topupRatio.toFixed(2)}) — ` +
        `band-midpoint coarseness (see comment), raise scoring unaffected`,
    );
  else
    console.log(
      `  pension-floor top-up check: €${(impliedTopupMonthlyEur / 1e6).toFixed(1)}M/mo vs НОИ €${(noiTopupMonthlyEur / 1e6).toFixed(1)}M/mo`,
    );

  // --- teachers' pay peg -----------------------------------------------------
  console.log("Fetching educ_uoe_perp01 (ISCED 1-3 teachers, BG)…");
  const teacherCount = await fetchTeacherCount();
  console.log("Fetching NSI open-data 612 (A21 wages by ownership)…");
  const nsiWages = await fetchNsiWages();
  const teacherRatio = nsiWages.sectorWageEur / nsiWages.economyWageEur;
  console.log(
    `  teachers ${teacherCount.count} (${teacherCount.year}), education-public wage ` +
      `€${nsiWages.sectorWageEur.toFixed(0)} vs economy €${nsiWages.economyWageEur.toFixed(0)} ` +
      `(${nsiWages.year}) → ratio ${(teacherRatio * 100).toFixed(1)}%`,
  );

  const payload = {
    generatedAt: new Date().toISOString(),
    country: "BG",
    baselineYear,
    gdpEur: Math.round(gdpEurM * 1e6),
    gdpGrowthPct,
    gdpNextEur: Math.round(gdpNextEurM * 1e6),
    sources: {
      kfp: "data.egov.bg КФП monthly execution (December snapshots)",
      excise: `${excise.source} (split fuel/tobacco/alcohol, ${excise.year})`,
      pit: `НАП Годишен отчет ${napYear}`,
      consumption: "Eurostat nama_10_co3_p3 + nama_10_gdp (P31_S14)",
      contributions: `Eurostat gov_10a_taxag D613CE ${napYear}`,
      earnings: `split log-normal + Pareto fit — НОИ СОД ${napYear} + Eurostat earn_ses_hourly ${ses.wave} + the PIT/insurable-base identity`,
      pensionFloor: `НОИ quarterly bulletin ${NOI_STATB_URL} (към ${pensionFloor.asOf})`,
      teachers: `Eurostat educ_uoe_perp01 ${teacherCount.year} + NSI open-data 612 A21 wages ${nsiWages.year}`,
    },
    revenue: {
      vatEur: Math.round(baseline.vatEur),
      pitEur: Math.round(baseline.pitEur),
      pitRateSensitiveShare: rateSensitiveShare,
      pitEmploymentShare: employmentShare,
      pitNonEmploymentShare: nonEmploymentShare,
      corporateEur: Math.round(baseline.corporateEur),
      dividendEur: Math.round(baseline.dividendEur),
      exciseFuelEur: Math.round(excise.fuelEur),
      exciseDieselEur: Math.round(excise.dieselEur),
      excisePetrolEur: Math.round(excise.petrolEur),
      exciseTobaccoEur: Math.round(excise.tobaccoEur),
      exciseAlcoholEur: Math.round(excise.alcoholEur),
      totalRevenueEur: Math.round(baseline.totalRevenueEur),
      balanceEur: Math.round(baseline.balanceEur),
    },
    earnings: {
      identityYear: napYear,
      sesWave: ses.wave,
      sigmaLower: ses.sigmaLower,
      sigmaUpper: ses.sigmaUpper,
      medianEur: Math.round(fit.medianEur * wageGrowth * 100) / 100,
      nEmployees: Math.round(fit.nEmployees),
      alpha: fit.alpha,
      shareAboveCap: fit.shareAboveCap,
      wageGrowthToBaseline: wageGrowth,
      // Validation stat at the identity year (vs the actual НАП line) and
      // the calibration the client applies at the baseline year.
      kappaIdentityYear,
      kappa: kappaBaseline,
      capEur: capBaselineEur,
      bands: bandsBaseline,
    },
    incomeTiers,
    vat: {
      factor: baselineFactor,
      calibration,
      structureYear: consumption.structureYear,
      slices: slices.map((s) => ({
        group: s.group,
        valueEur: Math.round(s.valueEur),
        regime: s.regime,
      })),
    },
    expenditure: {
      pensions: {
        year: noiLatest.fiscalYear,
        massEur: Math.round(pensionMassEur),
        pensionerCount: PENSIONER_COUNT,
        // The COVID-supplement slice of the indexation base.
        supplementMassEur: Math.round(
          COVID_SUPPLEMENT_EUR_MONTHLY * 12 * PENSIONER_COUNT,
        ),
        cpiPct,
        wageGrowthPct,
      },
      administration: {
        year: Number(natYears[natYears.length - 1]),
        positionsTotal: natLatest.positions.total,
        positionsVacant: natLatest.positions.vacant,
        payrollEur: Math.round(adminPayrollEur),
        // Payroll covers only the curated EXECUTION_REPORTS ministries — the
        // engine extrapolates to the national position count via cost/FTE.
        coveredHeadcount: adminCoveredHeadcount,
        payrollCoverageMinistries: minLatest.length,
        payrollYear: Number(minYears[minYears.length - 1]),
      },
      personnel: {
        // Consolidated КФП Персонал (wages + contributions), executed.
        massEur: Math.round(baseline.personnelEur),
        // Share of the line in sectors exempt from wage restraint (curated
        // approximation: военни, полицаи, лекари, учители).
        exemptShare: EXEMPT_PERSONNEL_SHARE,
      },
      defense: {
        natoPctGdp: NATO_DEFENSE_PCT_GDP,
        natoYear: 2025,
      },
      capital: {
        planEur: Math.round(baseline.capitalPlanEur),
        executedEur: Math.round(baseline.capitalExecEur),
        executionRate:
          baseline.capitalPlanEur > 0
            ? baseline.capitalExecEur / baseline.capitalPlanEur
            : 1,
      },
      sscSelfPaid: {
        count: BUDGET_PAID_SSC_COUNT,
        avgWageEur: Math.round(BUDGET_PAID_SSC_AVG_WAGE_EUR * 100) / 100,
      },
      health: {
        // Employee insurable base scaled to the baseline year — a 1pp health
        // contribution change collects on this.
        baseEur: Math.round(insurableBase * wageGrowth),
      },
      minWage: {
        currentEur: MIN_WAGE_EUR,
        // КТ чл.244 recursion: next year's МРЗ = current × (1 + wage growth).
        formulaEur: Math.round(minWageFormulaEur),
        wageGrowthPct,
      },
      pensionFloor: {
        asOf: pensionFloor.asOf,
        // Statutory minimum old-age pension (чл.68, ал.1 и 2 КСО), EUR/mo.
        minimumEur: pensionFloor.minimumEur,
        totalPensioners: pensionFloor.totalPensioners,
        // Bands the floor slider can reach (≤ €700), per-pensioner basic
        // monthly pension of the first pension.
        bands: pensionFloor.bands,
      },
      teachers: {
        count: teacherCount.count,
        countYear: teacherCount.year,
        // Education public-sector average annual wage — a PROXY for
        // teachers proper (includes non-teaching staff); caption as such.
        sectorWageEur: Math.round(nsiWages.sectorWageEur * 100) / 100,
        economyWageEur: Math.round(nsiWages.economyWageEur * 100) / 100,
        wageYear: nsiWages.year,
        currentRatio: teacherRatio,
      },
    },
    modIdentity: {
      year: napYear,
      capEur,
      aboveCapMassEur: Math.round(aboveCapMassEur),
      // The fitted tail index is the central; the band reflects the shape
      // uncertainty the fit can't pin (SES coverage, hourly-vs-monthly).
      alphaLow: Math.max(1.3, fit.alpha - 0.5),
      alphaCentral: fit.alpha,
      alphaHigh: fit.alpha + 0.5,
    },
  };

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2) + "\n");
  console.log(
    `Wrote ${path.relative(PROJECT_ROOT, OUT_FILE)} — baseline ${baselineYear}, ` +
      `VAT factor ${baselineFactor.toFixed(3)} (spread ${(spread * 100).toFixed(1)}%), ` +
      `above-cap mass €${(aboveCapMassEur / 1e9).toFixed(1)}B (${napYear}), ` +
      `earnings fit: median €${fit.medianEur.toFixed(0)}, α ${fit.alpha.toFixed(2)}, ` +
      `${(fit.shareAboveCap * 100).toFixed(1)}% above cap, κ ${kappaIdentityYear.toFixed(3)}`,
  );
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
