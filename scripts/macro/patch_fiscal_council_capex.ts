// Fold the two Фискален съвет capex-execution series into an existing
// `data/macro.json` without the full network refresh `fetch_eurostat.ts` does.
//
//   npm run macro:fiscal-council-capex
//
// Not the durable writer — `fetch_eurostat.ts` pushes the same entries, so a
// macro refresh carries them. Like `patch_municipal_stocks.ts` this appends and
// does NOT bump `fetchedAt`, which dates the last full Eurostat run.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fiscalCouncilCapexIndicators } from "./fiscal_council_capex";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MACRO_FILE = resolve(__dirname, "../../data/macro.json");

const macro = JSON.parse(readFileSync(MACRO_FILE, "utf8")) as {
  indicators: Record<string, unknown>;
  series: Record<string, unknown>;
};
for (const { key, series, ...meta } of fiscalCouncilCapexIndicators()) {
  macro.indicators[key] = meta;
  macro.series[key] = series;
  console.log(
    `${key.padEnd(22)} ${series.map((p) => `${p.year}:${p.value}`).join(" ")}`,
  );
}
writeFileSync(MACRO_FILE, JSON.stringify(macro));
