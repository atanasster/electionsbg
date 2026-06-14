// External anchors of the budget policy simulator that live as sourced
// constants in code, not in pipeline-built JSON:
//  - src/lib/euPolicyPresets.ts — the "like in <country>" per-lever EU
//    comparators AND the whole-country quick-select profiles (COUNTRY_PROFILES:
//    VAT/CIT/PIT rates, NATO defence shares and excise duties per country);
//  - src/lib/bgFiscalProjection.ts — the EC forecast baseline of the
//    5-year balance/debt projection.
// Three probes watch their upstreams; all three map to MANUAL edits in
// process-watch-report (there is no automated ingest — the constants carry
// editorial notes that need a human).

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
