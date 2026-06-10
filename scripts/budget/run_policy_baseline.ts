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
};

// κ gate: the fitted band grid at the flat 10% must reproduce the НАП
// employment-PIT line within this tolerance, or the fit is rejected.
const KAPPA_TOLERANCE = 0.08;

interface KfpFile {
  snapshots: {
    period: string;
    fiscalYear: number;
    sections: {
      kind: string;
      executed: { amountEur: number } | null;
      lines: { labelBg: string; executed: { amountEur: number } | null }[];
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
}

const extractRevenue = (kfp: KfpFile): YearRevenue[] => {
  const out: YearRevenue[] = [];
  for (const sn of kfp.snapshots) {
    if (!sn.period.endsWith("-12")) continue; // closed years only
    const rev = sn.sections.find((s) => s.kind === "revenue");
    const bal = sn.sections.find((s) => s.kind === "balance");
    if (!rev) continue;
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
    });
  }
  return out.sort((a, b) => a.fiscalYear - b.fiscalYear);
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
    series: { nominalGdp: { year: number; value: number }[] };
  }>("data/macro.json");

  const revenueYears = extractRevenue(kfp);
  if (!revenueYears.length) throw new Error("no closed КФП years");
  const baseline = revenueYears[revenueYears.length - 1];
  const baselineYear = baseline.fiscalYear;

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

  const payload = {
    generatedAt: new Date().toISOString(),
    country: "BG",
    baselineYear,
    gdpEur: Math.round(gdpEurM * 1e6),
    sources: {
      kfp: "data.egov.bg КФП monthly execution (December snapshots)",
      pit: `НАП Годишен отчет ${napYear}`,
      consumption: "Eurostat nama_10_co3_p3 + nama_10_gdp (P31_S14)",
      contributions: `Eurostat gov_10a_taxag D613CE ${napYear}`,
      earnings: `split log-normal + Pareto fit — НОИ СОД ${napYear} + Eurostat earn_ses_hourly ${ses.wave} + the PIT/insurable-base identity`,
    },
    revenue: {
      vatEur: Math.round(baseline.vatEur),
      pitEur: Math.round(baseline.pitEur),
      pitRateSensitiveShare: rateSensitiveShare,
      pitEmploymentShare: employmentShare,
      pitNonEmploymentShare: nonEmploymentShare,
      corporateEur: Math.round(baseline.corporateEur),
      dividendEur: Math.round(baseline.dividendEur),
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
