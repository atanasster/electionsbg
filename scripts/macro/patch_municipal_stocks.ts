// Fold the three national municipal-stock series into an existing
// `data/macro.json`, without the full network refresh `fetch_eurostat.ts` does.
//
//   npm run macro:municipal-stocks
//
// **This is not the durable writer.** `fetch_eurostat.ts` rebuilds macro.json
// from its indicator list and pushes the same three entries itself, so a macro
// refresh carries them with no extra command. This script exists for the case
// where the municipal corpus moved but nothing else did — re-running the whole
// Eurostat/World Bank fetch to republish three curated series would be minutes
// of network for no other change.
//
// **The corpus has TWO consumers, and a quarter that reaches only one leaves
// the other a quarter behind at a 200.** After a new workbook lands, the
// municipal-fiscal procedure is three commands, not two:
//
//   npx tsx scripts/budget/municipal_fiscal/ingest.ts   # → the per-município JSON
//   npm run db:load:municipal-fiscal:pg                 # → the municipal_fiscal table
//   npm run macro:municipal-stocks                      # → the three series in macro.json
//
// The third is this script. `/governance` reads Postgres and moves after the
// second; `/indicators/fiscal` is bucket-served from the committed macro.json
// and moves only after the third.
//
// Both paths read `municipalStockIndicators()`, so they cannot disagree about a
// figure or a caption. Two things differ, both deliberate:
//
//   - **KEY ORDER.** The assembler places the three where they sit in
//     `CURATED_INDICATORS`; this appends. Nothing reads macro.json
//     positionally, so that is diff churn rather than behaviour.
//   - **`fetchedAt` is NOT bumped.** It dates the last full Eurostat/World Bank
//     run, and 40 other series still carry that vintage — stamping today's date
//     because three curated series moved would misdate all of them.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  municipalStockIndicators,
  type MunicipalStockIndicator,
} from "./municipal_stocks";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MACRO_FILE = resolve(__dirname, "../../data/macro.json");

export interface MacroFile {
  indicators: Record<string, unknown>;
  series: Record<string, unknown>;
}

/** Merge the rebuilt indicators into a parsed macro.json. Returns how many were
 *  written. Pure, so the skip-empty rule below is testable without IO.
 *
 *  **An empty rebuild leaves the stored series ALONE.** That is the same
 *  skip-and-warn contract `hub_stats` / `sector_stats` keep, and for the same
 *  reason: a run on a machine without the corpus would otherwise overwrite three
 *  live series in the COMMITTED macro.json with `[]`, and the tile would then
 *  suppress itself on a checkout where nothing is actually wrong. Degrading to
 *  a worse published file is never better than not writing. */
export const applyIndicators = (
  macro: MacroFile,
  indicators: MunicipalStockIndicator[],
): number => {
  let wrote = 0;
  for (const ind of indicators) {
    if (ind.series.length === 0) {
      console.warn(
        `[municipal-stocks] ${ind.key}: no quarter has data — left untouched`,
      );
      continue;
    }
    const { key, series, ...meta } = ind;
    macro.indicators[key] = meta;
    macro.series[key] = series;
    const last = series[series.length - 1];
    console.log(
      `${key.padEnd(28)} ${series.length} quarter(s), latest ${last.period} = €${last.value}m ` +
        `(${last.municipalityCount} общини${last.partial ? ", PARTIAL" : ""})`,
    );
    wrote++;
  }
  return wrote;
};

const main = () => {
  const macro = JSON.parse(readFileSync(MACRO_FILE, "utf8")) as MacroFile;
  const wrote = applyIndicators(macro, municipalStockIndicators());

  if (wrote === 0) {
    console.warn("[municipal-stocks] nothing to patch — macro.json untouched.");
    return;
  }
  // Match the assembler's compact layout.
  writeFileSync(MACRO_FILE, JSON.stringify(macro));
  console.log(`\nPatched ${MACRO_FILE}`);
};

if (process.argv[1]?.endsWith("patch_municipal_stocks.ts")) main();
