// Build per-oblast crime index from the BG government's open-data
// visualisation repo.
//
// Source: github.com/governmentbg/data-viz/gh-pages → assets/data/crime/
// The official МВР statistical visualisation reads CSVs from that branch.
// Coverage: 28 oblasts × 16 years (2000-2015), per crime category.
//
// Note: the source dataset hasn't been updated since 2015 — current МВР
// monthly bulletins live behind a Cloudflare Turnstile challenge on
// mvr.bg, which would need a Playwright-based fetcher (the same pattern
// the project's cik_fetch uses). For now we ship the 2000-2015 corpus
// and surface the staleness in-tile via the snapshot year. A follow-up
// can extend the script with a CF-bypassing monthly-bulletin fetcher.
//
// Each cell value is the crime rate per 10,000 inhabitants ("perth" in
// the source filename); using rates instead of raw counts makes
// cross-oblast comparison meaningful. Top-level categories surfaced:
//   0 = Общо (Total)
//   1 = Престъпления против личността (Against person)
//   2 = Престъпления против собствеността (Against property)
//   3 = Общоопасни престъпления (Generally dangerous — drugs, traffic, weapons)
//   4 = Други криминални престъпления (Other criminal)
//   5 = Смъртни случаи без следи от насилие (Deaths without signs of violence)
//
// Run: `npx tsx scripts/crime/build_index.ts`

import fs from "node:fs";
import path from "node:path";

const PROJECT_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
);

const OUT_FILE = path.join(PROJECT_ROOT, "data/crime/index.json");
const CACHE_DIR = path.join(PROJECT_ROOT, "raw_data/crime");
const SOURCE_CSV_URL =
  "https://raw.githubusercontent.com/governmentbg/data-viz/gh-pages/assets/data/crime/mvr-aggr-13-perth-full.csv";

// 28 oblasts in the source's "София" / "Grad Sofiya" split. The source
// reports them separately ("София град" for the city, "София" for the
// surrounding region); we keep both rows but tag them with the right
// 3-letter oblast codes. The 28 names below map BG → our 3-letter
// internal oblast codes (matching data/regions/<oblast>.json).
const OBLAST_NAME_TO_CODE: Record<string, string> = {
  Благоевград: "BLG",
  Бургас: "BGS",
  Варна: "VAR",
  "Велико Търново": "VTR",
  Видин: "VID",
  Враца: "VRC",
  Габрово: "GAB",
  Добрич: "DOB",
  Кърджали: "KRZ",
  Кюстендил: "KNL",
  Ловеч: "LOV",
  Монтана: "MON",
  Пазарджик: "PAZ",
  Перник: "PER",
  Плевен: "PVN",
  Пловдив: "PDV",
  Разград: "RAZ",
  Русе: "RSE",
  Силистра: "SLS",
  Сливен: "SLV",
  Смолян: "SML",
  "София  град": "S23", // Sofia city (note: two spaces in source label)
  "София град": "S23", // Sofia city — single-space alt label
  София: "SFO", // Sofia oblast surrounding the city
  "Стара Загора": "SZR",
  Търговище: "TGV",
  Хасково: "HKV",
  Шумен: "SHU",
  Ямбол: "JAM",
};

// Top-level categories we expose in the tile. Source column IDs are the
// hierarchical numeric codes from the labels JSON; we read only the
// top-level (single-digit) columns and ignore sub-categories.
const TOP_LEVEL_CATEGORIES: Array<{
  key: string;
  columnId: string;
  bg: string;
  en: string;
}> = [
  {
    key: "against_person",
    columnId: "1",
    bg: "Срещу личността",
    en: "Against the person",
  },
  {
    key: "against_property",
    columnId: "2",
    bg: "Срещу собствеността",
    en: "Against property",
  },
  {
    key: "generally_dangerous",
    columnId: "3",
    bg: "Общоопасни",
    en: "Generally dangerous",
  },
  { key: "other", columnId: "4", bg: "Други криминални", en: "Other criminal" },
  {
    key: "deaths_no_violence",
    columnId: "5",
    bg: "Смъртни случаи без насилие",
    en: "Deaths without violence",
  },
];

const TOTAL_COL_ID = "0"; // overall crime rate

const UA = "Mozilla/5.0 (compatible; electionsbg-crime/1.0)";

const fetchCached = async (): Promise<string> => {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, "mvr-aggr-13-perth-full.csv");
  if (fs.existsSync(file) && fs.statSync(file).size > 10_000) {
    return fs.readFileSync(file, "utf-8");
  }
  const res = await fetch(SOURCE_CSV_URL, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const text = await res.text();
  fs.writeFileSync(file, text);
  return text;
};

const parseCsvLine = (line: string): string[] => {
  const cells: string[] = [];
  let buf = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === "," && !inQuotes) {
      cells.push(buf);
      buf = "";
    } else buf += c;
  }
  cells.push(buf);
  return cells;
};

const main = async () => {
  const text = await fetchCached();
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    console.error("source CSV empty");
    process.exit(1);
  }
  const header = parseCsvLine(lines[0]);
  const yearIdx = header.indexOf("Year");
  const oblastIdx = header.indexOf("Oblast");
  const totalIdx = header.indexOf(TOTAL_COL_ID);
  const catIndices = TOP_LEVEL_CATEGORIES.map((c) => ({
    key: c.key,
    idx: header.indexOf(c.columnId),
  }));
  if (yearIdx < 0 || oblastIdx < 0 || totalIdx < 0) {
    console.error("missing required columns in CSV header");
    process.exit(1);
  }

  // yearlyByOblast[oblast-code]["YYYY"][category-key | "total"] = rate.
  const yearlyByOblast: Record<
    string,
    Record<string, Record<string, number>>
  > = {};
  let latestYear = 0;
  let rowCount = 0;
  let mapped = 0;
  const unmappedNames = new Set<string>();

  for (let i = 1; i < lines.length; i++) {
    rowCount++;
    const cells = parseCsvLine(lines[i]);
    if (cells.length < header.length - 2) continue;
    const year = Number(cells[yearIdx]);
    const oblastName = cells[oblastIdx]?.trim();
    if (!Number.isFinite(year) || !oblastName) continue;
    const code = OBLAST_NAME_TO_CODE[oblastName];
    if (!code) {
      unmappedNames.add(oblastName);
      continue;
    }
    mapped++;
    if (year > latestYear) latestYear = year;

    let yearMap = yearlyByOblast[code];
    if (!yearMap) {
      yearMap = {};
      yearlyByOblast[code] = yearMap;
    }
    const inner: Record<string, number> = {};
    const total = Number(cells[totalIdx]);
    if (Number.isFinite(total)) inner.total = Math.round(total * 100) / 100;
    for (const c of catIndices) {
      if (c.idx < 0) continue;
      const v = Number(cells[c.idx]);
      if (Number.isFinite(v)) inner[c.key] = Math.round(v * 100) / 100;
    }
    yearMap[String(year)] = inner;
  }

  const out = {
    source:
      "МВР via the BG government open-data-viz repo (governmentbg/data-viz)",
    sourceUrl:
      "https://github.com/governmentbg/data-viz/tree/gh-pages/assets/data/crime",
    indexName: "Per-oblast crime rate (per 10,000 inhabitants), annual",
    grain: "oblast",
    unit: "per_10k",
    coverageYears: [2000, latestYear],
    categories: {
      total: { bg: "Общо", en: "Total" },
      ...Object.fromEntries(
        TOP_LEVEL_CATEGORIES.map((c) => [c.key, { bg: c.bg, en: c.en }]),
      ),
    },
    yearlyByOblast,
    latestYear: String(latestYear),
    note: "Source repo hasn't been updated since 2015. Current MVR monthly bulletins live on mvr.bg behind a Cloudflare Turnstile challenge that would need a Playwright-based fetcher to bypass — deferred to a follow-up. The tile surfaces the staleness via its 'as of {year}' label.",
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + "\n");
  console.log(
    `Wrote ${OUT_FILE} — ${rowCount} rows in, ${mapped} mapped, ${unmappedNames.size} unmapped oblast names, latest year ${latestYear}, ${Object.keys(yearlyByOblast).length} oblasts`,
  );
  if (unmappedNames.size > 0) {
    console.log("Unmapped oblast names:", Array.from(unmappedNames).join(", "));
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
