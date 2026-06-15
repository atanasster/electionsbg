// External anchors of the budget policy simulator that live as sourced
// constants in code, not in pipeline-built JSON:
//  - src/lib/euPolicyPresets.ts — the "like in <country>" per-lever EU
//    comparators AND the whole-country quick-select profiles (COUNTRY_PROFILES:
//    VAT/CIT/PIT rates, NATO defence shares and excise duties per country);
//  - src/lib/bgFiscalProjection.ts — the EC forecast baseline of the
//    5-year balance/debt projection.
// Seven probes watch their upstreams; all map to MANUAL edits in
// process-watch-report (there is no automated ingest — the constants carry
// editorial notes that need a human). eu_excise_rates (fuel/cigarettes, Tax
// Foundation) and eu_alcohol_excise (spirits/wine, EC TEDB) additionally
// VALUE-check the encoded excises in check_policy_anchors.ts. oecd_pit_params
// (nm/b2.t2 thresholds, OECD) and oecd_family_leave (mat, OECD) are input-DRIFT
// probes: the levers they feed are modeling derivations, so they only flag when
// the upstream moves — a cue to re-derive, not an auto-verifiable value.

import * as XLSX from "xlsx";

import { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchText, sha256Short } from "../fingerprint";

// ---------------------------------------------------------------------------
// 1) PwC Worldwide Tax Summaries quick charts — the EU tax-rate comparators.
// The pages embed a per-country JSON blob ("HU": {name, description<table>});
// we extract only the tracked countries so churn elsewhere doesn't flip us.
// The tracked set covers every country that drives a per-lever option OR a
// whole-country profile (COUNTRY_PROFILES): EE/PL/HU/DE/FR/SE/IE/GR plus the
// extra per-lever picks (DK/LU/ES/BE for VAT, SK/CZ for PIT). RO (PIT) is
// over-tracked deliberately — an early-warning candidate that mirrors BG's
// flat 10%. The PIT chart now tracks the progressive profile countries too;
// their cells carry inflation-indexed thresholds that churn yearly, but
// check_policy_anchors.ts only pins the RATES, so a threshold-only revision
// self-stamps on PASS rather than nagging a human.
// ---------------------------------------------------------------------------

const PWC_CHARTS: { key: string; url: string; countries: string[] }[] = [
  {
    key: "vat",
    url: "https://taxsummaries.pwc.com/quick-charts/value-added-tax-vat-rates",
    // Standard-rate options + the reduced-rate option countries (their
    // standard rate moving is the cue to re-verify the reduced rates too).
    countries: [
      "HU",
      "DK",
      "GR",
      "EE",
      "IE",
      "DE",
      "LU",
      "FR",
      "ES",
      "BE",
      "PL",
      "SE",
    ],
  },
  {
    key: "cit",
    url: "https://taxsummaries.pwc.com/quick-charts/corporate-income-tax-cit-rates",
    countries: ["HU", "EE", "FR", "DE", "IE", "PL", "SE", "GR"],
  },
  {
    key: "pit",
    url: "https://taxsummaries.pwc.com/quick-charts/personal-income-tax-pit-rates",
    countries: [
      "EE",
      "SK",
      "CZ",
      "RO",
      "HU",
      "PL",
      "DE",
      "FR",
      "IE",
      "GR",
      "SE",
    ],
  },
];

/** Pull the tracked countries' rate cells out of one quick-chart page:
 *  numeric tokens of the country's description table, e.g. HU → "27". */
const extractRates = (
  html: string,
  countries: string[],
): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const cc of countries) {
    const m = html.match(
      new RegExp(
        `"${cc}":\\s*\\{\\s*"name": "[^"]+",\\s*"description": "((?:[^"\\\\]|\\\\.)*)"`,
      ),
    );
    if (!m) continue;
    const text = m[1]
      .replace(/\\"/g, '"')
      // The "(Last reviewed - 31 December 2025)" header: a review date
      // alone must not flip the fingerprint.
      .replace(/Last reviewed[^)]*\)/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z]+;/g, " ");
    const nums = text.match(/\d+(?:\.\d+)?/g) ?? [];
    out[cc] = nums.join("/") || "?";
  }
  return out;
};

export const euTaxRates: WatchSource = {
  id: "eu_tax_rates",
  label: "PwC tax summaries — EU comparator rates",
  url: PWC_CHARTS[0].url,
  cadence: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    const charts: Record<string, Record<string, string>> = {};
    for (const c of PWC_CHARTS) {
      const html = await fetchText(c.url);
      if (!html) throw new Error(`empty PwC quick chart: ${c.key}`);
      const rates = extractRates(html, c.countries);
      if (Object.keys(rates).length < c.countries.length - 1)
        throw new Error(
          `PwC ${c.key} chart: extracted only ${Object.keys(rates).length}/${c.countries.length} tracked countries — page structure changed?`,
        );
      charts[c.key] = rates;
    }
    const value = sha256Short(JSON.stringify(charts));
    return {
      value,
      detail: `VAT ${charts.vat.HU ?? "?"}(HU)/${charts.vat.EE ?? "?"}(EE) · CIT ${charts.cit.HU ?? "?"}(HU) · PIT ${charts.pit.EE ?? "?"}(EE) · ${value}`,
      meta: { charts },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    const prevCharts = prev?.meta?.charts as
      | Record<string, Record<string, string>>
      | undefined;
    const currCharts = curr.meta?.charts as Record<
      string,
      Record<string, string>
    >;
    if (!prevCharts) return curr.detail;
    const moved: string[] = [];
    for (const key of Object.keys(currCharts)) {
      for (const cc of Object.keys(currCharts[key])) {
        const was = prevCharts[key]?.[cc];
        if (was && was !== currCharts[key][cc])
          moved.push(
            `${cc} ${key.toUpperCase()} ${was} → ${currCharts[key][cc]}`,
          );
      }
    }
    return moved.length
      ? `${moved.join("; ")} — update src/lib/euPolicyPresets.ts`
      : curr.detail;
  },
};

// ---------------------------------------------------------------------------
// 1b) Tax Foundation EU excise tables — the diesel/petrol/cigarette comparator
// rates. These are NOT in the PwC quick charts, so the per-lever + whole-country
// excise values had NO automated coverage and were maintained by hand (which is
// how a stale year could slip in). This probe reads the per-country cells of the
// two annual tables and fingerprints them in the SIMULATOR's units, so any rate
// move flips it and check_policy_anchors.ts can VALUE-verify the encoded excises.
//   energy table:    Gas €/L (col-2) → petrol ×1000;  Diesel €/L (col-5) → ×1000
//   cigarette table: Excise Duty per 20-Pack € (col-2) → ×50  (= €/1000)
// Spirits & wine are NOT on Tax Foundation (it lags national rate changes) —
// they get their own authoritative probe below (1c, EC TEDB).
// ---------------------------------------------------------------------------

const TF_ENERGY_URL =
  "https://taxfoundation.org/data/all/eu/diesel-gas-taxes-europe/";
const TF_CIGARETTE_URL =
  "https://taxfoundation.org/data/all/eu/cigarette-taxes-europe/";

// Tracked set = every country carrying a per-lever excise option OR a
// whole-country profile (BG is the baseline reference).
const EXCISE_COUNTRIES: Record<string, string> = {
  BG: "Bulgaria",
  EE: "Estonia",
  PL: "Poland",
  HU: "Hungary",
  DE: "Germany",
  FR: "France",
  SE: "Sweden",
  IE: "Ireland",
  GR: "Greece",
  IT: "Italy",
  BE: "Belgium",
  NL: "Netherlands",
};

export interface ExciseRate {
  petrol?: number;
  diesel?: number;
  cig?: number;
}

/** Euro figures (`€ 0.363`) of one HTML table row, in document order. */
const euroNums = (rowHtml: string): number[] =>
  [...rowHtml.matchAll(/€\s*([\d.]+)/g)].map((m) => Number(m[1]));

const rowOf = (html: string, name: string, window: number): string =>
  html.match(new RegExp(`${name}</td>[\\s\\S]{0,${window}}?</tr>`))?.[0] ?? "";

export const euExciseRates: WatchSource = {
  id: "eu_excise_rates",
  label: "Tax Foundation — EU excise rates (fuel + cigarettes)",
  url: TF_ENERGY_URL,
  cadence: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    const energy = await fetchText(TF_ENERGY_URL);
    const cig = await fetchText(TF_CIGARETTE_URL);
    if (!energy || !cig) throw new Error("empty Tax Foundation excise table");
    const rates: Record<string, ExciseRate> = {};
    for (const [cc, name] of Object.entries(EXCISE_COUNTRIES)) {
      const ev = euroNums(rowOf(energy, name, 260)); // [gas/petrol, diesel]
      const cv = euroNums(rowOf(cig, name, 420)); // [excise/20-pack, ...]
      rates[cc] = {
        petrol: ev[0] != null ? Math.round(ev[0] * 1000) : undefined,
        diesel: ev[1] != null ? Math.round(ev[1] * 1000) : undefined,
        cig: cv[0] != null ? Math.round(cv[0] * 50) : undefined,
      };
    }
    const got = Object.values(rates).filter(
      (r) => r.petrol != null && r.diesel != null,
    ).length;
    if (got < Object.keys(EXCISE_COUNTRIES).length - 1)
      throw new Error(
        `TF excise tables: parsed fuel rates for only ${got}/${Object.keys(EXCISE_COUNTRIES).length} countries — page structure changed?`,
      );
    const value = sha256Short(JSON.stringify(rates));
    return {
      value,
      detail: `BG fuel ${rates.BG?.petrol ?? "?"}/${rates.BG?.diesel ?? "?"} €/1000L · DE cig ${rates.DE?.cig ?? "?"} €/1000 · ${value}`,
      meta: { rates },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    const prevRates = prev?.meta?.rates as
      | Record<string, ExciseRate>
      | undefined;
    const currRates = curr.meta?.rates as Record<string, ExciseRate>;
    if (!prevRates) return curr.detail;
    const moved: string[] = [];
    for (const cc of Object.keys(currRates)) {
      for (const k of ["petrol", "diesel", "cig"] as const) {
        const was = prevRates[cc]?.[k];
        const now = currRates[cc]?.[k];
        if (was != null && now != null && was !== now)
          moved.push(`${cc} ${k} ${was} → ${now}`);
      }
    }
    return moved.length
      ? `${moved.join("; ")} — update the excise values in src/lib/euPolicyPresets.ts`
      : curr.detail;
  },
};

// ---------------------------------------------------------------------------
// 1c) EC "Taxes in Europe Database" (TEDB) v3 — the AUTHORITATIVE per-state
// alcohol excise source (spirits €/hl pure alcohol, still wine €/hl). Tax
// Foundation's alcohol tables lag national rate changes, so spirits & wine were
// the last hand-maintained excises; TEDB closes that gap. It's an undocumented
// but public, no-auth JSON REST API (the SPA at /tedb is just a client). Two
// calls per country: simpleSearch → {taxId, versionDate}, then tax/rate →
// alcoholicBeverages.{ethylAlcohol,wine}[].rate[].alcColumn1 ("562.42 EUR").
// `isEuro=true` converts non-euro states (SE/PL/HU/DK) to EUR at TEDB's rate —
// so their EUR figure floats with FX (check_policy_anchors treats them as soft).
// ---------------------------------------------------------------------------

const TEDB_BASE = "https://ec.europa.eu/taxation_customs/tedb/rest-api";

// TEDB numeric member-state ids (from .../rest-api/configurations). Greece is
// "EL". Tracked set = every country with a spirits/wine option or profile value.
const TEDB_MS: Record<string, number> = {
  BG: 3,
  DK: 7,
  DE: 6,
  EE: 8,
  GR: 9,
  FR: 12,
  HU: 15,
  IE: 16,
  NL: 22,
  PL: 23,
  SE: 26,
};

export interface AlcoholRate {
  spirits?: number;
  wine?: number;
}
interface TedbRateRow {
  alcColumn1?: string | null;
}
interface TedbAlcCategory {
  ethylAlcohol?: { rate?: TedbRateRow[] }[];
  wine?: { rate?: TedbRateRow[] }[];
}

/** First numeric `alcColumn1` ("562.42 EUR", "1 581.00 EUR") of a category's
 *  rate blocks — the standard-rate row. Strips the space thousands separator. */
const firstAlcRate = (
  blocks: { rate?: TedbRateRow[] }[] | undefined,
): number | null => {
  if (!Array.isArray(blocks)) return null;
  for (const b of blocks)
    for (const r of b.rate ?? []) {
      if (typeof r.alcColumn1 !== "string") continue;
      const m = r.alcColumn1.replace(/\s/g, "").match(/[\d.]+/);
      if (m) return Math.round(Number(m[0]));
    }
  return null;
};

export const euAlcoholExcise: WatchSource = {
  id: "eu_alcohol_excise",
  label: "EC TEDB — EU alcohol excise (spirits + wine)",
  url: "https://ec.europa.eu/taxation_customs/tedb/",
  cadence: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    // Pin to "today" (UTC) so we read the rate in force NOW — TEDB also serves
    // future-dated versions, which would otherwise pre-flag a not-yet-live rate.
    const now = new Date();
    const situationOn = `${now.getUTCFullYear()}/${String(
      now.getUTCMonth() + 1,
    ).padStart(2, "0")}/${String(now.getUTCDate()).padStart(2, "0")}`;
    const rates: Record<string, AlcoholRate> = {};
    for (const [cc, msId] of Object.entries(TEDB_MS)) {
      const sr = await fetch(`${TEDB_BASE}/simpleSearch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          searchForm: {
            selectedTaxTypes: ["EDU_ALCOHOL"],
            selectedMemberStates: [msId],
            situationOn,
            historized: "false",
            keywords: "",
          },
          availableFacets: null,
          selectedFacets: null,
          sort: null,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!sr.ok) throw new Error(`TEDB simpleSearch ${cc}: HTTP ${sr.status}`);
      const sj = (await sr.json()) as {
        result?: { taxId: number; versionDate: number }[];
      };
      const hit = sj.result?.[0];
      if (!hit) {
        rates[cc] = {};
        continue;
      }
      const rr = await fetch(
        `${TEDB_BASE}/tax/rate?taxId=${hit.taxId}&versionDate=${hit.versionDate}&isEuro=true`,
        {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(30_000),
        },
      );
      if (!rr.ok) throw new Error(`TEDB tax/rate ${cc}: HTTP ${rr.status}`);
      const rj = (await rr.json()) as {
        alcoholicBeverages?: TedbAlcCategory[] | TedbAlcCategory;
      };
      const ab = Array.isArray(rj.alcoholicBeverages)
        ? rj.alcoholicBeverages[0]
        : rj.alcoholicBeverages;
      rates[cc] = {
        spirits: firstAlcRate(ab?.ethylAlcohol) ?? undefined,
        wine: firstAlcRate(ab?.wine) ?? undefined,
      };
    }
    const got = Object.values(rates).filter((r) => r.spirits != null).length;
    if (got < Object.keys(TEDB_MS).length - 1)
      throw new Error(
        `TEDB alcohol: parsed spirits for only ${got}/${Object.keys(TEDB_MS).length} states — API shape changed?`,
      );
    const value = sha256Short(JSON.stringify(rates));
    return {
      value,
      detail: `BG spirits ${rates.BG?.spirits ?? "?"} · SE ${rates.SE?.spirits ?? "?"} · IE wine ${rates.IE?.wine ?? "?"} €/hl · ${value}`,
      meta: { rates },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    const prevRates = prev?.meta?.rates as
      | Record<string, AlcoholRate>
      | undefined;
    const currRates = curr.meta?.rates as Record<string, AlcoholRate>;
    if (!prevRates) return curr.detail;
    const moved: string[] = [];
    for (const cc of Object.keys(currRates)) {
      for (const k of ["spirits", "wine"] as const) {
        const was = prevRates[cc]?.[k];
        const now = currRates[cc]?.[k];
        if (was != null && now != null && was !== now)
          moved.push(`${cc} ${k} ${was} → ${now}`);
      }
    }
    return moved.length
      ? `${moved.join("; ")} — update the spirits/wine values in src/lib/euPolicyPresets.ts`
      : curr.detail;
  },
};

// ---------------------------------------------------------------------------
// 2) NATO defence-expenditure compendium — defence % of GDP options.
// Editions live at a stable URL pattern; we probe which years exist, so the
// next edition (def-exp-2026-en.pdf) flips the fingerprint the day it lands.
// ---------------------------------------------------------------------------

const NATO_PDF = (year: number): string =>
  `https://www.nato.int/content/dam/nato/webready/documents/finance/def-exp-${year}-en.pdf`;

// Fixed lower bound so the probed set only ever GROWS — a sliding window
// would drop an old edition out of range every New Year and flip the
// fingerprint with nothing published. 2025 = the edition the comparators
// ship with (def-exp-2024 already 404s at this URL pattern).
const FIRST_TRACKED_EDITION = 2025;

export const natoDefence: WatchSource = {
  id: "nato_defence",
  label: "NATO defence-expenditure compendium",
  url: "https://www.nato.int/cps/en/natohq/topics_49198.htm",
  cadence: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    const thisYear = new Date().getUTCFullYear();
    const years: number[] = [];
    for (let y = FIRST_TRACKED_EDITION; y <= thisYear + 1; y++) {
      const res = await fetch(NATO_PDF(y), {
        method: "HEAD",
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) years.push(y);
    }
    if (!years.length)
      throw new Error("no NATO def-exp compendium PDF found at known pattern");
    return {
      value: years.join(","),
      detail: `compendium edition(s): ${years.join(", ")}`,
      meta: { years },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    return `${prev.fingerprint} → ${curr.value} — update the defence options in src/lib/euPolicyPresets.ts from the new compendium`;
  },
};

// ---------------------------------------------------------------------------
// 3) EC economic forecast for Bulgaria — the projection baseline.
// The country page names the current edition ("Spring 2026 Economic
// Forecast"); a new season token = a new baseline for bgFiscalProjection.ts.
// ---------------------------------------------------------------------------

const EC_BG_URL =
  "https://economy-finance.ec.europa.eu/economic-surveillance-eu-member-states/country-pages/bulgaria/economic-forecast-bulgaria_en";
const SEASON_ORDER: Record<string, number> = {
  winter: 0,
  spring: 1,
  summer: 2,
  autumn: 3,
};

export const ecForecastBg: WatchSource = {
  id: "ec_forecast_bg",
  label: "EC economic forecast — Bulgaria",
  url: EC_BG_URL,
  cadence: "weekly",

  async fingerprint(): Promise<Fingerprint> {
    const html = await fetchText(EC_BG_URL);
    if (!html) throw new Error("empty EC Bulgaria forecast page");
    const tokens = [
      ...html.matchAll(/(Spring|Summer|Autumn|Winter)\s+(20\d{2})/gi),
    ].map((m) => ({
      season: m[1].toLowerCase(),
      year: Number(m[2]),
    }));
    if (!tokens.length)
      throw new Error("no forecast-edition token on the EC Bulgaria page");
    const latest = tokens.reduce((a, b) =>
      b.year * 10 + SEASON_ORDER[b.season] >
      a.year * 10 + SEASON_ORDER[a.season]
        ? b
        : a,
    );
    const value = `${latest.season} ${latest.year}`;
    return {
      value,
      detail: `latest edition: ${value}`,
      meta: { edition: value },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    return `${prev.fingerprint} → ${curr.value} — update the EC baseline (balance path + macro assumptions) in src/lib/bgFiscalProjection.ts`;
  },
};

// ---------------------------------------------------------------------------
// 4) OECD Tax Database (DF_PIT_CENT) — the per-country PIT bracket THRESHOLDS,
// basic ALLOWANCE (PA) and standard CREDIT (TC) that the profiles' `nm` and
// `b2.t2` levers are DERIVED from (nm = allowance ÷ 12, or credit ÷ entry-rate;
// b2.t2 = the chosen bracket threshold ÷ 12). Because the encoded levers are
// modeling derivations — not raw figures — this is an input-DRIFT probe, not a
// value-check: it fingerprints the upstream inputs for the 8 comparator
// countries and flips when one moves, prompting a human to re-derive the lever.
// (The OECD series lags national law ~1 year, so it's a re-verify cue, not the
// source of record.) SDMX-JSON; the public endpoint intermittently 500s ("not
// enough key values" / a "languageTag1" error page) → retried with backoff.
// ---------------------------------------------------------------------------

const OECD_PIT_URL =
  "https://sdmx.oecd.org/public/rest/data/OECD.CTP.TPS,DSD_TAX_PIT@DF_PIT_CENT/all?startPeriod=2025&format=jsondata";
// OECD ISO3 → our 2-letter cc, for the 8 whole-country profile comparators.
const OECD_PIT_CC: Record<string, string> = {
  EST: "EE",
  POL: "PL",
  HUN: "HU",
  DEU: "DE",
  FRA: "FR",
  SWE: "SE",
  IRL: "IE",
  GRC: "GR",
};
// PA = basic allowance, TC = standard tax credit, TH = bracket threshold.
const OECD_PIT_TX = new Set(["PA", "TC", "TH"]);

interface SdmxDim {
  id: string;
  values: { id: string }[];
}
interface SdmxSeries {
  observations: Record<string, (number | null)[]>;
}

/** GET SDMX-JSON with retry/backoff — the OECD public endpoint is flaky. */
const fetchSdmxJson = async (url: string, tries = 6): Promise<unknown> => {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, {
        headers: { Accept: "application/vnd.sdmx.data+json" },
        signal: AbortSignal.timeout(60_000),
      });
      const t = await r.text();
      if (r.status === 200 && t.startsWith("{")) return JSON.parse(t);
    } catch {
      /* transient — retry */
    }
    await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
  }
  throw new Error(`OECD SDMX unreachable after ${tries} tries: ${url}`);
};

export const oecdPitParams: WatchSource = {
  id: "oecd_pit_params",
  label: "OECD Tax DB — PIT thresholds/allowances/credits",
  url: "https://sdmx.oecd.org/public/rest/data/OECD.CTP.TPS,DSD_TAX_PIT@DF_PIT_CENT/all",
  cadence: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    const j = (await fetchSdmxJson(OECD_PIT_URL)) as {
      data: {
        structures: { dimensions: { series: SdmxDim[] } }[];
        dataSets: { series: Record<string, SdmxSeries> }[];
      };
    };
    const sDims = j.data.structures[0].dimensions.series;
    const pos = (id: string): number => sDims.findIndex((d) => d.id === id);
    const pRef = pos("REF_AREA");
    const pTx = pos("TRANSACTION");
    const pLvl = pos("LEVEL");
    if (pRef < 0 || pTx < 0)
      throw new Error("OECD PIT: series dimension layout changed");
    const refV = sDims[pRef].values;
    const txV = sDims[pTx].values;
    const lvlV = pLvl >= 0 ? sDims[pLvl].values : [];
    const params: Record<string, number> = {};
    for (const [key, s] of Object.entries(j.data.dataSets[0].series)) {
      const idx = key.split(":").map(Number);
      const cc = OECD_PIT_CC[refV[idx[pRef]]?.id];
      if (!cc) continue;
      const tx = txV[idx[pTx]]?.id;
      if (!OECD_PIT_TX.has(tx)) continue;
      const lvl = pLvl >= 0 ? (lvlV[idx[pLvl]]?.id ?? "_Z") : "_Z";
      // latest observation = highest time index
      const tKeys = Object.keys(s.observations);
      if (!tKeys.length) continue;
      const last = tKeys.map(Number).sort((a, b) => b - a)[0];
      const v = s.observations[String(last)]?.[0];
      if (typeof v === "number") params[`${cc}|${tx}|${lvl}`] = Math.round(v);
    }
    if (Object.keys(params).length < Object.keys(OECD_PIT_CC).length)
      throw new Error(
        `OECD PIT: extracted only ${Object.keys(params).length} params for ${Object.keys(OECD_PIT_CC).length} countries — query or structure changed?`,
      );
    const value = sha256Short(JSON.stringify(params));
    return {
      value,
      detail: `DE allowance ${params["DE|TH|L1"] ?? "?"} · FR 30%@ ${params["FR|TH|L2"] ?? "?"} · IE cut-off ${params["IE|TH|L1"] ?? "?"} · ${value}`,
      meta: { params },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    const prevP = prev?.meta?.params as Record<string, number> | undefined;
    const currP = curr.meta?.params as Record<string, number>;
    if (!prevP) return curr.detail;
    const moved: string[] = [];
    for (const k of Object.keys(currP))
      if (prevP[k] != null && prevP[k] !== currP[k])
        moved.push(`${k} ${prevP[k]} → ${currP[k]}`);
    return moved.length
      ? `${moved.join("; ")} — re-derive the affected nm / b2.t2 in src/lib/euPolicyPresets.ts`
      : curr.detail;
  },
};

// ---------------------------------------------------------------------------
// 5) OECD Family Database (PF2.5) — paid parental-leave WEEKS per country, the
// input the `mat` lever (well-paid second-year months on BG's 0–12 scale) is
// derived from. Input-drift probe like (4): fingerprints maternity-paid,
// parental-paid and total-paid weeks at the latest year for the 8 comparators
// and flips on a leave reform, prompting a human to re-derive `mat`. Open XLSX
// on webfs.oecd.org (no auth); the OECD portal page itself is Cloudflare-walled.
// ---------------------------------------------------------------------------

const OECD_FAMILY_URL =
  "https://webfs.oecd.org/els-com/Family_Database/PF2_5_Trends_in_leave_entitlements_around_childbirth.xlsx";
const OECD_FAMILY_CC: Record<string, string> = {
  Estonia: "EE",
  Poland: "PL",
  Hungary: "HU",
  Germany: "DE",
  France: "FR",
  Sweden: "SE",
  Ireland: "IE",
  Greece: "GR",
};
// Time-Series sheet column indices (0-based): Maternity_paid, Parental_paid,
// Total_paid (total weeks of paid maternity+parental+homecare leave).
const FAM_COL = { country: 0, year: 1, matPaid: 2, parPaid: 7, totalPaid: 12 };

/** A leave cell: round a number to 1 dp (the source carries days÷7 noise),
 *  else keep the raw string (FR books a "42.0 / 110" long-option). */
const leaveCell = (v: unknown): string => {
  if (typeof v === "number" && Number.isFinite(v))
    return String(Math.round(v * 10) / 10);
  return String(v ?? "").trim();
};

export const oecdFamilyLeave: WatchSource = {
  id: "oecd_family_leave",
  label: "OECD Family DB — paid parental leave (PF2.5)",
  url: OECD_FAMILY_URL,
  cadence: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    const r = await fetch(OECD_FAMILY_URL, {
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) throw new Error(`OECD Family DB: HTTP ${r.status}`);
    const wb = XLSX.read(Buffer.from(await r.arrayBuffer()), {
      type: "buffer",
    });
    const ws = wb.Sheets["Time-Series"];
    if (!ws) throw new Error("OECD Family DB: 'Time-Series' sheet missing");
    const rows = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      blankrows: false,
    }) as unknown[][];
    // Data begins at row 3 (rows 0–2 are header/description/sub-header).
    const latest: Record<
      string,
      { year: number; mat: string; par: string; total: string }
    > = {};
    for (let i = 3; i < rows.length; i++) {
      const row = rows[i];
      const cc = OECD_FAMILY_CC[String(row[FAM_COL.country])];
      if (!cc) continue;
      const yr = Number(row[FAM_COL.year]);
      if (!Number.isFinite(yr)) continue;
      if (!latest[cc] || yr > latest[cc].year)
        latest[cc] = {
          year: yr,
          mat: leaveCell(row[FAM_COL.matPaid]),
          par: leaveCell(row[FAM_COL.parPaid]),
          total: leaveCell(row[FAM_COL.totalPaid]),
        };
    }
    if (Object.keys(latest).length < Object.keys(OECD_FAMILY_CC).length)
      throw new Error(
        `OECD Family DB: matched only ${Object.keys(latest).length}/${Object.keys(OECD_FAMILY_CC).length} countries — sheet layout changed?`,
      );
    const value = sha256Short(JSON.stringify(latest));
    return {
      value,
      detail: `DE total ${latest.DE?.total ?? "?"}w · SE ${latest.SE?.total ?? "?"}w · EE ${latest.EE?.total ?? "?"}w (paid leave) · ${value}`,
      meta: { latest },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    type Leave = { year: number; mat: string; par: string; total: string };
    const prevL = prev?.meta?.latest as Record<string, Leave> | undefined;
    const currL = curr.meta?.latest as Record<string, Leave>;
    if (!prevL) return curr.detail;
    const moved: string[] = [];
    for (const cc of Object.keys(currL)) {
      const a = prevL[cc];
      const b = currL[cc];
      if (!a) continue;
      if (a.mat !== b.mat || a.par !== b.par || a.total !== b.total)
        moved.push(
          `${cc} paid-leave ${a.mat}/${a.par}/${a.total} → ${b.mat}/${b.par}/${b.total}`,
        );
    }
    return moved.length
      ? `${moved.join("; ")} — re-derive the affected mat in src/lib/euPolicyPresets.ts`
      : curr.detail;
  },
};
