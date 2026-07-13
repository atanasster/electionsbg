// Auto-ingest checker for the simulator's MANUAL-EDIT policy anchors. The daily
// watcher only says "something changed upstream"; this script answers the
// follow-up question — do the sourced constants in code still match the
// upstream? — by reusing the watcher sources' own fingerprint() payloads and
// comparing them against the live engine constants:
//
//   eu_tax_rates      PwC quick-chart rates    vs  EU_LEVER_PRESETS rates
//   eu_excise_rates   Tax Foundation fuel/cig  vs  exDiesel/exPetrol/exCigarettes
//   eu_alcohol_excise EC TEDB spirits/wine     vs  exSpirits/exWine
//   ec_forecast_bg    live edition token       vs  EC_FORECAST_EDITION
//   nato_defence      latest compendium year   vs  NATO_COMPENDIUM_EDITION
//
// The two excise checks are VALUE-level (every encoded rate vs the live table);
// the others are rate-pin / edition-level.
//
// Exit 0 = everything matches (with --stamp the ingest marker is written, so
// process-watch-report can run this unattended for the common confirm case).
// Exit 1 = drift or probe failure — a HUMAN edits the constants (labels and
// notes carry editorial in-force years that should never be auto-written),
// re-runs this checker, and stamps. Reduced-rate VAT and Germany's combined
// CIT are not derivable from the quick charts — they report as WARN, never
// as failures.
//
// Usage:
//   npx tsx scripts/budget/check_policy_anchors.ts [--source <id>|all] [--stamp]

import { execFileSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

import {
  euTaxRates,
  euExciseRates,
  euAlcoholExcise,
  natoDefence,
  ecForecastBg,
} from "../watch/sources/eu_policy_anchors";
import {
  COUNTRY_PROFILES,
  EU_LEVER_PRESETS,
  NATO_COMPENDIUM_EDITION,
} from "../../src/lib/euPolicyPresets";
import { EC_FORECAST_EDITION } from "../../src/lib/bgFiscalProjection";

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(__filename), "../..");

type SourceId =
  | "eu_tax_rates"
  | "eu_excise_rates"
  | "eu_alcohol_excise"
  | "ec_forecast_bg"
  | "nato_defence";
const ALL_SOURCES: SourceId[] = [
  "eu_tax_rates",
  "eu_excise_rates",
  "eu_alcohol_excise",
  "ec_forecast_bg",
  "nato_defence",
];

interface CheckResult {
  ok: boolean;
  /** One-line stamp summary when ok. */
  summary: string;
  lines: string[];
}

const applyOf = (
  lever: keyof typeof EU_LEVER_PRESETS,
  id: string,
): Record<string, unknown> => {
  const o = EU_LEVER_PRESETS[lever].find((x) => x.id === id);
  if (!o) throw new Error(`preset option missing: ${lever}/${id}`);
  return o.apply as Record<string, unknown>;
};

// Same accessor for a whole-country quick-select profile (COUNTRY_PROFILES) —
// the checks below pin the profile values that aren't already a per-lever
// option (PL/SE are profile-only comparators; GR corp / HU flat PIT are new).
const countryOf = (cc: string): Record<string, unknown> => {
  const c = COUNTRY_PROFILES.find((x) => x.cc === cc);
  if (!c) throw new Error(`country profile missing: ${cc}`);
  return c.apply as Record<string, unknown>;
};
const countryTopRate = (cc: string): number =>
  (countryOf(cc).b2 as { r2: number }).r2;

// ---------------------------------------------------------------------------
// eu_tax_rates — the PwC charts carry "27" / "19/25/30/35" token cells per
// country; a HARD check demands the preset's value among the tokens, a SOFT
// check only warns (rates the quick chart doesn't reliably carry).
// ---------------------------------------------------------------------------

interface RateCheck {
  chart: "vat" | "cit" | "pit";
  cc: string;
  expect: number;
  what: string;
  soft?: boolean;
}

const RATE_CHECKS: RateCheck[] = [
  // VAT standard-rate options (lever vatStd)
  {
    chart: "vat",
    cc: "HU",
    expect: applyOf("vatStd", "vat_hu").vatStd as number,
    what: "vatStd vat_hu",
  },
  {
    chart: "vat",
    cc: "DK",
    expect: applyOf("vatStd", "vat_dk").vatStd as number,
    what: "vatStd vat_dk",
  },
  {
    chart: "vat",
    cc: "GR",
    expect: applyOf("vatStd", "vat_gr").vatStd as number,
    what: "vatStd vat_gr",
  },
  {
    chart: "vat",
    cc: "EE",
    expect: applyOf("vatStd", "vat_ee").vatStd as number,
    what: "vatStd vat_ee",
  },
  {
    chart: "vat",
    cc: "IE",
    expect: applyOf("vatStd", "vat_ie").vatStd as number,
    what: "vatStd vat_ie",
  },
  {
    chart: "vat",
    cc: "DE",
    expect: applyOf("vatStd", "vat_de").vatStd as number,
    what: "vatStd vat_de",
  },
  {
    chart: "vat",
    cc: "LU",
    expect: applyOf("vatStd", "vat_lu").vatStd as number,
    what: "vatStd vat_lu",
  },
  // Reduced rates ride the same vat cells only sometimes — warn-only.
  {
    chart: "vat",
    cc: "GR",
    expect: applyOf("vatRed", "vatr_gr").vatRed as number,
    what: "vatRed vatr_gr",
    soft: true,
  },
  {
    chart: "vat",
    cc: "ES",
    expect: applyOf("vatRed", "vatr_es").vatRed as number,
    what: "vatRed vatr_es",
    soft: true,
  },
  {
    chart: "vat",
    cc: "DE",
    expect: applyOf("vatRed", "vatr_de").vatRed as number,
    what: "vatRed vatr_de",
    soft: true,
  },
  {
    chart: "vat",
    cc: "BE",
    expect: applyOf("vatRed", "vatr_be").vatRed as number,
    what: "vatRed vatr_be",
    soft: true,
  },
  // CIT options. Germany's preset is the ~30% COMBINED effective rate while
  // PwC's cell shows the federal 15% — warn-only by construction.
  {
    chart: "cit",
    cc: "HU",
    expect: applyOf("corp", "corp_hu").corp as number,
    what: "corp corp_hu",
  },
  {
    chart: "cit",
    cc: "EE",
    expect: applyOf("corp", "corp_ee").corp as number,
    what: "corp corp_ee",
  },
  {
    chart: "cit",
    cc: "FR",
    expect: applyOf("corp", "corp_fr").corp as number,
    what: "corp corp_fr",
  },
  {
    chart: "cit",
    cc: "DE",
    expect: applyOf("corp", "corp_de").corp as number,
    what: "corp corp_de (combined rate)",
    soft: true,
  },
  // PIT options. The quick chart carries only the TOP ("headline") rate per
  // country, so that is the pin: EE 22 (flat = the preset), CZ 23 (= the
  // preset's second bracket), SK 35 (a LITERAL — the preset deliberately
  // models the first two brackets, 19/25, of the 2026 19/25/30/35 schedule,
  // and 35 is what the chart showed when that approximation was verified).
  // A moved pin = re-read the country page and refresh the option + note.
  {
    chart: "pit",
    cc: "EE",
    expect: applyOf("pit", "pit_ee").pit as number,
    what: "pit pit_ee (flat)",
  },
  {
    chart: "pit",
    cc: "SK",
    expect: 35,
    what: "pit pit_sk (top-rate pin; preset is the 19/25 approximation)",
  },
  {
    chart: "pit",
    cc: "CZ",
    expect: (applyOf("pit", "pit_cz").b2 as { r2: number }).r2,
    what: "pit pit_cz (top rate)",
  },
  // ---- Whole-country profile pins (COUNTRY_PROFILES) ----------------------
  // VAT standard rate of the profile-only comparators (PL/SE are not per-lever
  // vatStd options). Clean single rates the quick chart always carries → HARD.
  {
    chart: "vat",
    cc: "PL",
    expect: countryOf("PL").vatStd as number,
    what: "vatStd country_pl",
  },
  {
    chart: "vat",
    cc: "SE",
    expect: countryOf("SE").vatStd as number,
    what: "vatStd country_se",
  },
  // CIT headline of the profile comparators. PL 19 and GR 22 are the quick
  // chart's headline → HARD; SE's profile rounds 20.6→21 for the integer
  // slider, so the chart shows 20.6, not 21 → warn-only (like Germany).
  {
    chart: "cit",
    cc: "PL",
    expect: countryOf("PL").corp as number,
    what: "corp country_pl",
  },
  {
    chart: "cit",
    cc: "GR",
    expect: countryOf("GR").corp as number,
    what: "corp country_gr",
  },
  {
    chart: "cit",
    cc: "SE",
    expect: countryOf("SE").corp as number,
    what: "corp country_se (20.6, one-decimal lever)",
    soft: true,
  },
  // PIT: Hungary's flat 15% is a clean single rate → HARD. The progressive
  // profiles pin their TOP bracket rate among the chart tokens; the chart's
  // representation of the top marginal varies (national vs combined, brackets
  // vs headline), so these are warn-only early-warnings, not failures.
  {
    chart: "pit",
    cc: "HU",
    expect: countryOf("HU").pit as number,
    what: "pit country_hu (flat)",
  },
  {
    chart: "pit",
    cc: "PL",
    expect: countryTopRate("PL"),
    what: "pit country_pl (top rate)",
    soft: true,
  },
  {
    chart: "pit",
    cc: "DE",
    expect: countryTopRate("DE"),
    what: "pit country_de (top band)",
    soft: true,
  },
  {
    chart: "pit",
    cc: "FR",
    expect: countryTopRate("FR"),
    what: "pit country_fr (modal 30% band, not top rate)",
    soft: true,
  },
  {
    chart: "pit",
    cc: "IE",
    expect: countryTopRate("IE"),
    what: "pit country_ie (higher rate)",
    soft: true,
  },
  {
    chart: "pit",
    cc: "GR",
    expect: countryTopRate("GR"),
    what: "pit country_gr (modal 20% band, not top rate)",
    soft: true,
  },
  {
    chart: "pit",
    cc: "SE",
    expect: countryTopRate("SE"),
    what: "pit country_se (combined top)",
    soft: true,
  },
];

const checkEuTaxRates = async (): Promise<CheckResult> => {
  const fp = await euTaxRates.fingerprint();
  const charts = fp.meta?.charts as Record<string, Record<string, string>>;
  const lines: string[] = [];
  let hardFailures = 0;
  for (const c of RATE_CHECKS) {
    const cell = charts[c.chart]?.[c.cc] ?? "";
    const tokens = cell.split("/").filter(Boolean).map(Number);
    const found = tokens.includes(c.expect);
    if (found) {
      lines.push(
        `  PASS  ${c.what}: ${c.expect} ∈ PwC ${c.chart}/${c.cc} "${cell}"`,
      );
    } else if (c.soft) {
      lines.push(
        `  WARN  ${c.what}: ${c.expect} not in PwC ${c.chart}/${c.cc} "${cell}" — quick chart does not carry this rate; verify manually only if the country page changed`,
      );
    } else {
      hardFailures++;
      lines.push(
        `  DRIFT ${c.what}: expected ${c.expect}, PwC ${c.chart}/${c.cc} shows "${cell}" — update src/lib/euPolicyPresets.ts (value, label AND the note's in-force year), cross-check the PwC country page first`,
      );
    }
  }
  return {
    ok: hardFailures === 0,
    summary: `auto-check PASS — PwC quick-chart rates match euPolicyPresets (per-lever: VAT HU27/DK25/GR24/EE24/IE23/DE19/LU17; CIT HU9/EE22/FR25; PIT EE22 flat, SK top 35, CZ top 23 · country profiles: PL/SE VAT 23/25, PL/GR CIT 19/22, HU PIT 15 flat)`,
    lines,
  };
};

// ---------------------------------------------------------------------------
// eu_excise_rates — VALUE-level check: every encoded diesel/petrol/cigarette
// rate (per-lever options AND whole-country profiles) is compared to the live
// Tax Foundation table for that country. This is the one excise family with a
// machine-readable upstream, so it catches BOTH a stale entry and a fresh drift
// — the coverage the hand-maintained excises previously lacked. Spirits & wine
// are checked separately against the EC TEDB (checkAlcoholExcise below).
// ---------------------------------------------------------------------------

const EXCISE_FIELDS: {
  lever: "exDiesel" | "exPetrol" | "exCigarettes";
  key: "diesel" | "petrol" | "cig";
  tol: number;
}[] = [
  { lever: "exDiesel", key: "diesel", tol: 2 },
  { lever: "exPetrol", key: "petrol", tol: 2 },
  { lever: "exCigarettes", key: "cig", tol: 2 }, // ×50 rounding of the per-pack €
];

const checkExciseRates = async (): Promise<CheckResult> => {
  const fp = await euExciseRates.fingerprint();
  const rates = (fp.meta?.rates ?? {}) as Record<
    string,
    Partial<Record<"diesel" | "petrol" | "cig", number>>
  >;
  const lines: string[] = [];
  let failures = 0;
  let compared = 0;
  const cmp = (
    cc: string,
    enc: number | undefined,
    f: (typeof EXCISE_FIELDS)[number],
    src: string,
  ): void => {
    if (enc == null) return;
    const live = rates[cc]?.[f.key];
    const tag = `${src} ${cc} ${f.lever}`;
    if (live == null) {
      lines.push(
        `  WARN  ${tag}=${enc}: Tax Foundation carries no ${f.key} cell for ${cc} — verify manually`,
      );
      return;
    }
    compared++;
    if (Math.abs(enc - live) > f.tol) {
      failures++;
      lines.push(
        `  DRIFT ${tag}=${enc} but Tax Foundation shows ${live} — update src/lib/euPolicyPresets.ts (value AND the note's in-force year)`,
      );
    }
  };
  for (const p of COUNTRY_PROFILES)
    for (const f of EXCISE_FIELDS)
      cmp(
        p.cc,
        (p.apply as Record<string, number | undefined>)[f.lever],
        f,
        "profile",
      );
  for (const f of EXCISE_FIELDS)
    for (const o of EU_LEVER_PRESETS[f.lever])
      cmp(
        o.cc,
        (o.apply as Record<string, number | undefined>)[f.lever],
        f,
        `per-lever ${o.id}`,
      );
  if (failures === 0)
    lines.push(
      `  PASS  ${compared} encoded diesel/petrol/cigarette rates match Tax Foundation (spirits & wine checked separately via eu_alcohol_excise)`,
    );
  return {
    ok: failures === 0,
    summary: `auto-check PASS — ${compared} encoded fuel/cigarette excises match the Tax Foundation EU tables`,
    lines,
  };
};

// ---------------------------------------------------------------------------
// eu_alcohol_excise — VALUE-level check of spirits/wine vs the EC TEDB (the
// authoritative per-state source). Euro-area members are exact → HARD (tol ±3
// €/hl rounding). Non-euro members (SE/PL/HU/DK) come back EUR-converted at
// TEDB's floating rate, so a few-percent gap is FX noise, not a policy change →
// SOFT (WARN past 5%, never a build failure). Spirits & wine were the last
// hand-maintained excises; this removes them from the manual list.
// ---------------------------------------------------------------------------

const EUROZONE = new Set([
  "AT",
  "BE",
  "BG",
  "CY",
  "DE",
  "EE",
  "ES",
  "FI",
  "FR",
  "GR",
  "HR",
  "IE",
  "IT",
  "LT",
  "LU",
  "LV",
  "MT",
  "NL",
  "PT",
  "SI",
  "SK",
]);

const checkAlcoholExcise = async (): Promise<CheckResult> => {
  const fp = await euAlcoholExcise.fingerprint();
  const rates = (fp.meta?.rates ?? {}) as Record<
    string,
    { spirits?: number; wine?: number }
  >;
  const lines: string[] = [];
  let failures = 0;
  let compared = 0;
  const cmp = (
    cc: string,
    enc: number | undefined,
    key: "spirits" | "wine",
    lever: string,
    src: string,
  ): void => {
    if (enc == null) return;
    const live = rates[cc]?.[key];
    const tag = `${src} ${cc} ${lever}`;
    if (live == null) {
      lines.push(`  WARN  ${tag}=${enc}: TEDB has no ${key} cell for ${cc}`);
      return;
    }
    compared++;
    const diff = Math.abs(enc - live);
    if (EUROZONE.has(cc)) {
      if (diff > 3) {
        failures++;
        lines.push(
          `  DRIFT ${tag}=${enc} but TEDB shows ${live} — update src/lib/euPolicyPresets.ts (value, label AND the note's in-force year)`,
        );
      }
    } else if (diff > Math.max(8, live * 0.05)) {
      // non-euro: EUR figure floats with FX, so warn (verify) rather than fail
      lines.push(
        `  WARN  ${tag}=${enc} vs TEDB ${live} (${Math.round((diff / live) * 100)}% gap; non-euro, could be FX or a real rate change — verify)`,
      );
    }
  };
  for (const p of COUNTRY_PROFILES) {
    cmp(p.cc, p.apply.exSpirits, "spirits", "exSpirits", "profile");
    cmp(p.cc, p.apply.exWine, "wine", "exWine", "profile");
  }
  for (const o of EU_LEVER_PRESETS.exSpirits)
    cmp(o.cc, o.apply.exSpirits, "spirits", "exSpirits", `per-lever ${o.id}`);
  for (const o of EU_LEVER_PRESETS.exWine)
    cmp(o.cc, o.apply.exWine, "wine", "exWine", `per-lever ${o.id}`);
  if (failures === 0)
    lines.push(
      `  PASS  ${compared} encoded spirits/wine rates match EC TEDB (euro-area exact; non-euro within FX tolerance)`,
    );
  return {
    ok: failures === 0,
    summary: `auto-check PASS — ${compared} encoded spirits/wine excises match the EC TEDB`,
    lines,
  };
};

// ---------------------------------------------------------------------------
// ec_forecast_bg — edition-level check: the actual table values can only be
// read by a human (the constants carry the whole macro path), but "is the
// code on the live edition?" is exactly the daily question.
// ---------------------------------------------------------------------------

const checkEcForecast = async (): Promise<CheckResult> => {
  const fp = await ecForecastBg.fingerprint();
  const live = String(fp.meta?.edition ?? fp.value).toLowerCase();
  const ok = live === EC_FORECAST_EDITION;
  return {
    ok,
    summary: `auto-check PASS — live EC edition "${live}" already encoded (EC_FORECAST_EDITION)`,
    lines: [
      ok
        ? `  PASS  live edition "${live}" == EC_FORECAST_EDITION "${EC_FORECAST_EDITION}"`
        : `  DRIFT live edition "${live}" != EC_FORECAST_EDITION "${EC_FORECAST_EDITION}" — update EC_BALANCE_PCT + MACRO_PATH + EC_FORECAST_EDITION in src/lib/bgFiscalProjection.ts from the new forecast, then re-run __smoke_fiscal_projection.ts AND __smoke_behavioral.ts (their EC-anchor invariants move in the same commit), and re-check the i18n strings naming the edition (budget_policy_hero_deficit*, budget_policy_proj_note/proj_macro)`,
    ],
  };
};

// ---------------------------------------------------------------------------
// nato_defence — edition-level check; a new compendium means a human reads
// Table 3 (defence % of real GDP, latest estimate column) and refreshes the
// def options + NATO_COMPENDIUM_EDITION together.
// ---------------------------------------------------------------------------

const checkNatoDefence = async (): Promise<CheckResult> => {
  const fp = await natoDefence.fingerprint();
  const years = (fp.meta?.years as number[]) ?? [];
  const latest = Math.max(...years);
  const ok = latest === NATO_COMPENDIUM_EDITION;
  return {
    ok,
    summary: `auto-check PASS — latest NATO compendium edition ${latest} already encoded (NATO_COMPENDIUM_EDITION)`,
    lines: [
      ok
        ? `  PASS  latest compendium ${latest} == NATO_COMPENDIUM_EDITION ${NATO_COMPENDIUM_EDITION}`
        : `  DRIFT compendium ${latest} published (code is on ${NATO_COMPENDIUM_EDITION}) — read Table 3 of def-exp-${latest}-en.pdf (defence as % of real GDP, PL/LT/EE/GR/DE/IT) and update the def options + NATO_COMPENDIUM_EDITION in src/lib/euPolicyPresets.ts; Germany may be unreported — keep the national-budget figure with its caveat`,
    ],
  };
};

// ---------------------------------------------------------------------------
// COUNTRY_PROFILES offline invariants (no network). Run on EVERY invocation
// before the upstream probes, because they catch DATA-edit mistakes, not drift:
//   (1) a profile field disagrees with the same-cc per-lever option — the chip
//       and the per-lever popover would then contradict each other;
//   (2) a profile value sits outside the simulator's slider bounds — it would
//       be silently clamped, so the scenario no longer reproduces the country.
// ---------------------------------------------------------------------------

// Lever families a per-lever option AND a profile can both carry (the EuLeverId
// is the apply-field name for every one of these).
const PROFILE_SHARED_LEVERS: (keyof typeof EU_LEVER_PRESETS)[] = [
  "vatStd",
  "vatRed",
  "pit",
  "corp",
  "def",
  "mat",
  "pw",
  "exDiesel",
  "exPetrol",
  "exCigarettes",
  "exSpirits",
  "exWine",
];

// Slider bounds — KEEP IN SYNC with src/screens/components/budget/
// BudgetPolicySimulator.tsx (those consts aren't exported from the component).
const PROFILE_BOUNDS: Record<string, [number, number]> = {
  vatStd: [10, 27],
  vatRed: [0, 27],
  pit: [0, 35],
  nm: [0, 1700], // NM_MAX
  corp: [0, 30],
  def: [15, 60],
  mat: [0, 12], // MATERNITY_Y2_MONTHS
  pw: [0, 100],
  exDiesel: [330, 700],
  exPetrol: [359, 900],
  exCigarettes: [90, 550],
  exSpirits: [550, 5100],
  exWine: [0, 450],
};
const T2_BOUNDS: [number, number] = [1000, 8000];
const R2_BOUNDS: [number, number] = [0, 55];

const checkProfileInvariants = (): CheckResult => {
  const lines: string[] = [];
  let failures = 0;
  const inBounds = (v: number, [lo, hi]: [number, number]): boolean =>
    v >= lo && v <= hi;

  for (const p of COUNTRY_PROFILES) {
    const apply = p.apply as Record<string, unknown>;

    // (1) consistency vs the same-cc per-lever option
    for (const lever of PROFILE_SHARED_LEVERS) {
      const opt = EU_LEVER_PRESETS[lever].find((o) => o.cc === p.cc);
      if (!opt) continue;
      const pv = apply[lever];
      const ov = (opt.apply as Record<string, unknown>)[lever];
      if (pv != null && ov != null && pv !== ov) {
        failures++;
        lines.push(
          `  DRIFT ${p.id} ${lever}=${String(pv)} disagrees with per-lever ${opt.id}=${String(ov)} — make them equal (chip and per-lever popover must never contradict)`,
        );
      }
    }

    // (2) within slider bounds
    for (const [field, range] of Object.entries(PROFILE_BOUNDS)) {
      const v = apply[field];
      if (typeof v === "number" && !inBounds(v, range)) {
        failures++;
        lines.push(
          `  OOB   ${p.id} ${field}=${v} outside slider bounds [${range[0]}, ${range[1]}] — would be silently clamped (raise the bound in BudgetPolicySimulator.tsx + here, or fix the profile)`,
        );
      }
    }
    const b2 = apply.b2 as { t2: number; r2: number } | null | undefined;
    if (b2) {
      if (!inBounds(b2.t2, T2_BOUNDS)) {
        failures++;
        lines.push(
          `  OOB   ${p.id} b2.t2=${b2.t2} outside [${T2_BOUNDS[0]}, ${T2_BOUNDS[1]}]`,
        );
      }
      if (!inBounds(b2.r2, R2_BOUNDS)) {
        failures++;
        lines.push(
          `  OOB   ${p.id} b2.r2=${b2.r2} outside [${R2_BOUNDS[0]}, ${R2_BOUNDS[1]}]`,
        );
      }
    }
  }

  if (failures === 0)
    lines.push(
      `  PASS  ${COUNTRY_PROFILES.length} country profiles consistent with per-lever options and within slider bounds`,
    );
  return {
    ok: failures === 0,
    summary: `country-profile invariants OK (${COUNTRY_PROFILES.length} profiles)`,
    lines,
  };
};

// ---------------------------------------------------------------------------

const CHECKS: Record<SourceId, () => Promise<CheckResult>> = {
  eu_tax_rates: checkEuTaxRates,
  eu_excise_rates: checkExciseRates,
  eu_alcohol_excise: checkAlcoholExcise,
  ec_forecast_bg: checkEcForecast,
  nato_defence: checkNatoDefence,
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const stamp = args.includes("--stamp");
  const sourceArg = args.includes("--source")
    ? args[args.indexOf("--source") + 1]
    : "all";
  const sources: SourceId[] =
    sourceArg === "all" ? ALL_SOURCES : [sourceArg as SourceId];
  if (sources.some((s) => !ALL_SOURCES.includes(s))) {
    console.error(
      `unknown --source ${sourceArg}; use ${ALL_SOURCES.join("|")}|all`,
    );
    process.exit(2);
  }

  let failures = 0;

  // Offline data invariants first — pure, network-free, a hard gate on every
  // run regardless of --source (they guard the code/data, not the upstream).
  console.log(`\n=== country_profiles (offline invariants) ===`);
  const inv = checkProfileInvariants();
  for (const line of inv.lines) console.log(line);
  if (!inv.ok) failures++;

  for (const id of sources) {
    console.log(`\n=== ${id} ===`);
    let result: CheckResult;
    try {
      result = await CHECKS[id]();
    } catch (e) {
      failures++;
      console.log(
        `  ERROR probe failed: ${String(e)} — transient? retry before editing anything`,
      );
      continue;
    }
    for (const line of result.lines) console.log(line);
    if (!result.ok) {
      failures++;
      continue;
    }
    if (stamp) {
      execFileSync(
        "npx",
        ["tsx", "scripts/stamp-ingest.ts", id, "--summary", result.summary],
        { cwd: PROJECT_ROOT, stdio: "inherit" },
      );
    } else {
      console.log(
        `  (stamp with: npx tsx scripts/stamp-ingest.ts ${id} --summary "${result.summary}")`,
      );
    }
  }

  if (failures > 0) {
    console.log(
      `\n${failures} anchor(s) drifted or failed to probe — manual edit required (see lines above), then re-run with --stamp.`,
    );
    process.exit(1);
  }
  console.log("\nAll policy anchors match upstream.");
};

void main();
