// Auto-ingest checker for the simulator's MANUAL-EDIT policy anchors
// (eu_tax_rates, ec_forecast_bg, nato_defence). The daily watcher only says
// "something changed upstream"; this script answers the follow-up question —
// do the sourced constants in code still match the upstream? — by reusing
// the watcher sources' own fingerprint() payloads and comparing them against
// the live engine constants:
//
//   eu_tax_rates   PwC quick-chart rates  vs  EU_LEVER_PRESETS apply values
//   ec_forecast_bg live edition token     vs  EC_FORECAST_EDITION
//   nato_defence   latest compendium year vs  NATO_COMPENDIUM_EDITION
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
  natoDefence,
  ecForecastBg,
} from "../watch/sources/eu_policy_anchors";
import {
  EU_LEVER_PRESETS,
  NATO_COMPENDIUM_EDITION,
} from "../../src/lib/euPolicyPresets";
import { EC_FORECAST_EDITION } from "../../src/lib/bgFiscalProjection";

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(__filename), "../..");

type SourceId = "eu_tax_rates" | "ec_forecast_bg" | "nato_defence";
const ALL_SOURCES: SourceId[] = [
  "eu_tax_rates",
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
    summary: `auto-check PASS — PwC quick-chart rates match euPolicyPresets (VAT HU27/DK25/GR24/EE24/IE23/DE19/LU17; CIT HU9/EE22/FR25; PIT EE22 flat, SK top 35, CZ top 23)`,
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

const CHECKS: Record<SourceId, () => Promise<CheckResult>> = {
  eu_tax_rates: checkEuTaxRates,
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
