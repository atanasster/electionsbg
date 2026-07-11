// Generator: write data/culture/funding_streams.json — the annual culture-money
// streams by scale, so the /culture view can put the film subsidies (which it
// details) in proportion to the bigger, less-visible lines (читалища, the scenic-
// arts delegated budgets). This is the honest "budget bridge" the dedicated view
// otherwise lacks — the МК ministry page owns the full budget, so here we only
// contextualise the culture streams against each other.
//
// HAND-KEYED reference data (mirrors scripts/budget/nzok/__write_budget.ts): each
// figure is an approximate ANNUAL amount with its source. Amounts already in EUR
// (BGN sources converted at 1 EUR = 1.95583 лв). Re-run to update:
//   npx tsx scripts/culture/write_funding_streams.ts

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUT = path.resolve(__dirname, "../../data/culture/funding_streams.json");

const out = {
  generatedAt: new Date().toISOString(),
  // Total Ministry of Culture budget, for context (not part of the composition —
  // it overlaps some streams and excludes the municipal ones).
  mkTotalEur: 269_400_000, // 2026 draft, ~527 млн лв — BTA
  note: {
    bg: "Приблизителни годишни суми по източник, за мащаб. Някои линии се припокриват или минават през общините; сумите са в евро. Точните числа са на съответните страници (МК бюджет, НФЦ, НФК).",
    en: "Approximate annual amounts by stream, for scale. Some lines overlap or flow through municipalities; amounts in euro. Exact figures are on the respective pages (МК budget, НФЦ, НФК).",
  },
  streams: [
    {
      id: "chitalishta",
      bg: "Читалища",
      en: "Community centres (читалища)",
      annualEur: 88_300_000, // 7 856 units × €11 240 standard, 2026
      sourceBg:
        "Единен разходен стандарт 2026 × брой субсидирани бройки (НСОРБ)",
      sourceEn: "2026 unit standard × subsidised units (NSORB)",
    },
    {
      id: "scenic",
      bg: "Сценични изкуства (делегирани бюджети)",
      en: "Performing arts (delegated budgets)",
      annualEur: 84_000_000, // ~165 млн лв performing-arts budget, 2025
      sourceBg: "Бюджет за сценични изкуства ~165 млн лв, 2025 (МК)",
      sourceEn: "Performing-arts budget ~165M лв, 2025 (МК)",
    },
    {
      id: "film",
      bg: "Филмови субсидии (НФЦ)",
      en: "Film subsidies (НФЦ)",
      annualEur: 8_000_000, // 12-yr average of the ingested register (~€95.7M / 12)
      sourceBg: "Среден годишен разход по регистъра на НФЦ 2014–2025",
      sourceEn: "Average annual spend from the НФЦ register 2014–2025",
    },
    {
      id: "ncf",
      bg: "Грантове (НФК)",
      en: "Grants (НФК)",
      annualEur: 9_360_000, // 18.3 млн лв programme budget, 2026
      sourceBg: "Индикативен бюджет на програмите 18,3 млн лв, 2026 (НФК)",
      sourceEn: "Indicative programme budget 18.3M лв, 2026 (НФК)",
    },
    {
      id: "sofia",
      bg: "Столична програма „Култура“ (община)",
      en: "Sofia municipal culture programme",
      annualEur: 2_300_000, // 2026 programme budget
      sourceBg: "Програма „Култура“ на Столична община, 2026",
      sourceEn: "Sofia municipality culture programme, 2026",
    },
  ],
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
const tot = out.streams.reduce((s, x) => s + x.annualEur, 0);
console.log(
  `✓ ${out.streams.length} culture streams · €${(tot / 1e6).toFixed(0)}M identifiable · → data/culture/funding_streams.json`,
);
