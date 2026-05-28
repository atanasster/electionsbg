// Central catalogue of the indicators surfaced on /indicators. Maps each
// indicator key to its domain page (so KpiTile knows where to link), the
// direction that counts as "good" (drives the YoY arrow colour), a headline
// formatter, a delta suffix, the sparkline window, and whether the EU27 rank
// badge applies.
//
// Single-sourced here so the landing-grid order and the domain pages stay in
// sync, and so adding a new tile is one entry rather than touching three
// screens.

import type { MacroIndicatorKey } from "@/data/macro/useMacro";

export type IndicatorDomain = "economy" | "fiscal" | "governance" | "society";

export const DOMAIN_PATHS: Record<IndicatorDomain, string> = {
  economy: "/indicators/economy",
  fiscal: "/indicators/fiscal",
  governance: "/indicators/governance",
  society: "/indicators/society",
};

// "lower" = lower values are better (inflation, debt). "higher" = higher
// values are better (GDP growth, balance, trust). "none" = ambiguous direction
// (current account, house prices YoY); the YoY arrow stays neutral.
export type IndicatorDirection = "lower" | "higher" | "none";

export type KpiEntry = {
  key: MacroIndicatorKey;
  domain: IndicatorDomain;
  direction: IndicatorDirection;
  /** Headline-value formatter (one decimal, signed, etc.). */
  format: (value: number) => string;
  /** YoY delta suffix. "pp" for percentage-point changes on rate indicators,
   *  "%" for percent change on level indicators, "" when the underlying value
   *  is unit-less (sentiment indices, WGI scores). Ignored when `formatDelta`
   *  is set. */
  deltaSuffix: "pp" | "%" | "";
  /** Optional custom delta formatter — used when the headline format converts
   *  units (e.g. EUR million → EUR billion). When set, the YoY arrow renders
   *  this directly with a leading sign and skips deltaSuffix. */
  formatDelta?: (delta: number) => string;
  /** Decimals on the delta when `formatDelta` is not set. Default 1. */
  deltaDecimals?: number;
  /** Trailing window in years for the sparkline. 5y for noisy series whose
   *  recent movement compresses on a 10y axis; 10y otherwise. */
  sparklineYears: number;
  /** Whether macro_peers.json carries a precomputed EU27 distribution for this
   *  key — drives the RankBadge presence. */
  peerEligible: boolean;
  /** Optional hash on the destination domain page. */
  anchor?: string;
};

const pctOneDecimal = (v: number) => `${v.toFixed(1)}%`;
const indexOneDecimal = (v: number) => v.toFixed(1);
const wgiTwoDecimal = (v: number) => v.toFixed(2);
const cpiInteger = (v: number) => v.toFixed(0);
const eurBn = (v: number) => `€${v.toFixed(1)}B`;
const eurMnToBn = (v: number) => `€${(v / 1000).toFixed(1)}B`;

// The 12 KPIs that appear on the /indicators landing grid. Order is the grid
// order (row-major, 4 per row at lg / 2 at sm). Selection rationale lives in
// the implementation plan; in short: at least two per domain, peer-comparable
// where possible, and matching the indicators voters actually argue about.
export const LANDING_KPI_ORDER: MacroIndicatorKey[] = [
  "gdpGrowth",
  "inflation",
  "unemployment",
  "consumerConfidence",
  "govDebt",
  "budgetBalance",
  "fiscalReserve",
  "euFunds",
  "wgiControlOfCorruption",
  "trustGovernment",
  "youthUnemployment",
  "povertyRate",
];

export const KPI_REGISTRY: Partial<Record<MacroIndicatorKey, KpiEntry>> = {
  gdpGrowth: {
    key: "gdpGrowth",
    domain: "economy",
    direction: "higher",
    format: pctOneDecimal,
    deltaSuffix: "pp",
    sparklineYears: 10,
    peerEligible: true,
  },
  inflation: {
    key: "inflation",
    domain: "economy",
    direction: "lower",
    format: pctOneDecimal,
    deltaSuffix: "pp",
    // 5y so the 2022-2024 cost-of-living spike doesn't visually flatten the
    // post-2024 normalisation.
    sparklineYears: 5,
    peerEligible: true,
  },
  unemployment: {
    key: "unemployment",
    domain: "economy",
    direction: "lower",
    format: pctOneDecimal,
    deltaSuffix: "pp",
    sparklineYears: 10,
    peerEligible: true,
  },
  consumerConfidence: {
    key: "consumerConfidence",
    domain: "economy",
    direction: "higher",
    format: indexOneDecimal,
    deltaSuffix: "",
    sparklineYears: 5,
    peerEligible: false,
  },
  govDebt: {
    key: "govDebt",
    domain: "fiscal",
    direction: "lower",
    format: pctOneDecimal,
    deltaSuffix: "pp",
    sparklineYears: 10,
    peerEligible: true,
  },
  budgetBalance: {
    key: "budgetBalance",
    domain: "fiscal",
    direction: "higher",
    format: pctOneDecimal,
    deltaSuffix: "pp",
    sparklineYears: 10,
    peerEligible: true,
  },
  fiscalReserve: {
    key: "fiscalReserve",
    domain: "fiscal",
    direction: "higher",
    format: eurMnToBn,
    deltaSuffix: "",
    // Underlying series is in EUR millions; headline shows billions, so the
    // delta needs the same unit conversion to be readable.
    formatDelta: (d) => `€${(d / 1000).toFixed(2)}B`,
    sparklineYears: 10,
    peerEligible: false,
  },
  euFunds: {
    key: "euFunds",
    domain: "fiscal",
    direction: "higher",
    format: eurBn,
    deltaSuffix: "",
    formatDelta: (d) => `€${d.toFixed(1)}B`,
    sparklineYears: 10,
    peerEligible: false,
    anchor: "eu-funds",
  },
  wgiControlOfCorruption: {
    key: "wgiControlOfCorruption",
    domain: "governance",
    direction: "higher",
    format: wgiTwoDecimal,
    deltaSuffix: "",
    deltaDecimals: 2,
    sparklineYears: 10,
    peerEligible: false,
  },
  trustGovernment: {
    key: "trustGovernment",
    domain: "governance",
    direction: "higher",
    format: pctOneDecimal,
    deltaSuffix: "pp",
    sparklineYears: 10,
    peerEligible: false,
  },
  youthUnemployment: {
    key: "youthUnemployment",
    domain: "society",
    direction: "lower",
    format: pctOneDecimal,
    deltaSuffix: "pp",
    sparklineYears: 10,
    peerEligible: true,
  },
  povertyRate: {
    key: "povertyRate",
    domain: "society",
    direction: "lower",
    format: pctOneDecimal,
    deltaSuffix: "pp",
    sparklineYears: 10,
    peerEligible: false,
  },
  intentionalHomicideRate: {
    key: "intentionalHomicideRate",
    domain: "society",
    direction: "lower",
    // Rate is small — typically 0.5-2 per 100K. Two decimals so YoY moves
    // don't get rounded away on the headline.
    format: (v: number) => v.toFixed(2),
    deltaSuffix: "",
    deltaDecimals: 2,
    sparklineYears: 10,
    peerEligible: true,
  },
  prisonPopulationRate: {
    key: "prisonPopulationRate",
    domain: "society",
    direction: "none",
    format: (v: number) => v.toFixed(0),
    deltaSuffix: "",
    deltaDecimals: 0,
    sparklineYears: 10,
    // No rank pill — direction is ambiguous (see fetch_eu_peers).
    peerEligible: false,
  },
  // Non-landing entries — also formatted here so domain pages can reuse the
  // formatters consistently.
  cpi: {
    key: "cpi",
    domain: "governance",
    direction: "higher",
    format: cpiInteger,
    deltaSuffix: "",
    sparklineYears: 10,
    peerEligible: false,
  },
  wgiRuleOfLaw: {
    key: "wgiRuleOfLaw",
    domain: "governance",
    direction: "higher",
    format: wgiTwoDecimal,
    deltaSuffix: "",
    deltaDecimals: 2,
    sparklineYears: 10,
    peerEligible: false,
  },
  wgiGovEffectiveness: {
    key: "wgiGovEffectiveness",
    domain: "governance",
    direction: "higher",
    format: wgiTwoDecimal,
    deltaSuffix: "",
    deltaDecimals: 2,
    sparklineYears: 10,
    peerEligible: false,
  },
};
