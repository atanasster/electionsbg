// Service-quality metrics from the annual "Доклад за състоянието на
// администрацията" — the административно обслужване section. Reads the already
// cached pdftotext output (raw_data/budget/doklad-<year>.txt, produced by the
// budget pipeline) and extracts the FEW numbers the report states in a stable,
// machine-readable form:
//
//   • signals   — брой сигнали във връзка с административното обслужване (годишно)
//   • proposals — брой предложения по Глава осма от АПК
//   • satisfactionMeasured — администрации, изготвили годишен доклад за оценка на
//                            удовлетвореността (count + % of all administrations)
//
// Deliberately NARROW. The report discusses "таен клиент", комплексно обслужване
// and satisfaction as PROSE (methods, not scored results), so those are NOT
// extractable as numbers — we don't invent them. The section's phrasing shifts
// year to year; every field is best-effort and null when a year's wording
// doesn't match, so a tile renders only the years that actually parsed.
//
//   npx tsx scripts/administration/parse_service_quality.ts

import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");
const CACHE_DIR = path.resolve(REPO_ROOT, "raw_data/budget");
const OUT = path.resolve(REPO_ROOT, "data/administration/service_quality.json");

const YEARS = [2020, 2021, 2022, 2023, 2024, 2025];

// "6 190" / "6190" / "360" → 6190 / 360. Strips the spaced thousands separator.
const num = (s: string): number => Number(s.replace(/\s+/g, ""));
const pct = (s: string): number => Number(s.replace(",", "."));

export interface YearQuality {
  signals: number | null;
  proposals: number | null;
  satisfactionMeasured: { count: number; pct: number } | null;
}

export const parseYear = (text: string): YearQuality => {
  const q: YearQuality = {
    signals: null,
    proposals: null,
    satisfactionMeasured: null,
  };

  const sig = text.match(
    /изпратили\s+([\d\s]+?)\s+сигнал[аи]?\s+във\s+връзка\s+с\s+администрати[вн][^.]*?обслужване/i,
  );
  if (sig) q.signals = num(sig[1]);

  const prop = text.match(/и\s+([\d\s]+?)\s+предложения,?\s+съгласно\s+Глава/i);
  if (prop) q.proposals = num(prop[1]);

  const sat = text.match(
    /([\d\s]+?)\s+администрации\s*\(\s*([\d.,]+)\s*%[^)]*\)\s*вече\s+са\s+изготвили\s+годишен\s+[Дд]оклад\s+за\s+оценка\s+на\s+удовлетвореността/i,
  );
  if (sat) q.satisfactionMeasured = { count: num(sat[1]), pct: pct(sat[2]) };

  return q;
};

const run = (): void => {
  const byYear: Record<string, YearQuality> = {};
  for (const year of YEARS) {
    const txt = path.join(CACHE_DIR, `doklad-${year}.txt`);
    if (!fs.existsSync(txt)) continue;
    const parsed = parseYear(fs.readFileSync(txt, "utf8"));
    // Keep the year only if at least one metric parsed (avoid all-null rows).
    if (
      parsed.signals != null ||
      parsed.proposals != null ||
      parsed.satisfactionMeasured != null
    ) {
      byYear[String(year)] = parsed;
      console.log(
        `  ${year}: signals=${parsed.signals} proposals=${parsed.proposals} sat=${parsed.satisfactionMeasured ? parsed.satisfactionMeasured.pct + "%" : "—"}`,
      );
    }
  }
  const years = Object.keys(byYear).map(Number);
  const payload = {
    source: {
      name: "Доклад за състоянието на администрацията",
      url: "https://iisda.government.bg/annual_reports",
    },
    generatedAt: new Date().toISOString(),
    latestYear: years.length ? Math.max(...years) : null,
    byYear,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2));
  console.log(`✓ wrote ${path.relative(REPO_ROOT, OUT)}`);
};

// Run only when invoked as the CLI entry point — not when imported by the test.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  run();
}
