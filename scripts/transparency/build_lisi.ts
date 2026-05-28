// Build the TI-BG Local Integrity System Index (LISI) data file.
//
// Source: Асоциация "Прозрачност без граници" — annual composite score
// for each of Bulgaria's 27 oblast-center municipalities. Scores are on
// a 0-5 scale, where 0 = no integrity safeguards observed and 5 = full
// compliance across the 10 surveyed institutions/sectors (общински съвет,
// кмет, общинска администрация, политически партии, съдебна власт,
// полиция, бизнес, медии, гражданско общество, здравеопазване).
//
// 2024 results are scraped from lisi.transparency.bg — the interactive
// visualisation lists per-município composite scores. Per-pillar
// breakdowns are surfaced in the interactive UI but aren't published as
// downloadable data; this script captures only the composite score per
// município. National average for 2024 is 3.27.
//
// Coverage: 27 of 265 BG municipalities. The other 238 municípios are
// out of TI-BG's scope (the index only studies oblast centers). The hook
// returns `undefined` for non-listed municípios, which makes the tile
// auto-hide everywhere except the 27 oblast capitals.
//
// Run: `npx tsx scripts/transparency/build_lisi.ts`

import fs from "node:fs";
import path from "node:path";

const PROJECT_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
);
const OUT_FILE = path.join(
  PROJECT_ROOT,
  "data/municipal_transparency/index.json",
);
const MUNICIPALITIES_FILE = path.join(PROJECT_ROOT, "data/municipalities.json");

// Hand-curated 2024 LISI composite scores from lisi.transparency.bg —
// the visualisation lists scores in two-decimal precision. National avg
// is 3.27 (matches the source).
const LISI_2024: Array<{ name: string; composite: number }> = [
  { name: "Бургас", composite: 3.71 },
  { name: "Русе", composite: 3.7 },
  { name: "София", composite: 3.61 }, // Столична община / SOF00 synthetic code
  { name: "Пловдив", composite: 3.53 },
  { name: "Монтана", composite: 3.44 },
  { name: "Разград", composite: 3.43 },
  { name: "Добрич", composite: 3.41 },
  { name: "Благоевград", composite: 3.38 },
  { name: "Велико Търново", composite: 3.38 },
  { name: "Стара Загора", composite: 3.37 },
  { name: "Видин", composite: 3.33 },
  { name: "Перник", composite: 3.31 },
  { name: "Търговище", composite: 3.29 },
  { name: "Ямбол", composite: 3.28 },
  { name: "Габрово", composite: 3.26 },
  { name: "Кюстендил", composite: 3.23 },
  { name: "Ловеч", composite: 3.23 },
  { name: "Сливен", composite: 3.23 },
  { name: "Враца", composite: 3.22 },
  { name: "Хасково", composite: 3.14 },
  { name: "Плевен", composite: 3.12 },
  { name: "Смолян", composite: 3.11 },
  { name: "Пазарджик", composite: 3.09 },
  { name: "Варна", composite: 3.08 },
  { name: "Шумен", composite: 3.05 },
  { name: "Силистра", composite: 2.71 },
  { name: "Кърджали", composite: 2.63 },
];

const NATIONAL_AVERAGE_2024 = 3.27;
const YEAR = 2024;

type MunicipalityInfo = {
  obshtina: string;
  name: string;
  oblast: string;
};

const main = () => {
  const munis = JSON.parse(
    fs.readFileSync(MUNICIPALITIES_FILE, "utf-8"),
  ) as MunicipalityInfo[];
  const byName = new Map<string, MunicipalityInfo[]>();
  for (const m of munis) {
    const arr = byName.get(m.name) ?? [];
    arr.push(m);
    byName.set(m.name, arr);
  }

  // Sofia is the synthetic city aggregate (SOF00) since municipalities.json
  // fragments Sofia into 24 районы.
  const SOFIA_OBSHTINA = "SOF00";

  // Sort by composite desc and assign national rank.
  const ranked = LISI_2024.slice().sort((a, b) => b.composite - a.composite);

  const scoresByObshtina: Record<
    string,
    { composite: number; pillars: Record<string, number>; nationalRank: number }
  > = {};
  let unmatched = 0;
  for (let i = 0; i < ranked.length; i++) {
    const r = ranked[i];
    let code: string | undefined;
    if (r.name === "София") {
      code = SOFIA_OBSHTINA;
    } else {
      const candidates = byName.get(r.name) ?? [];
      // For município names that match multiple records, the oblast-center
      // is always the one whose obshtina code prefix matches the canonical
      // 3-letter oblast code that shares the name. Easier heuristic:
      // sort by obshtina-code lexicographically and pick the lowest-
      // numbered one, which is conventionally the oblast capital.
      if (candidates.length === 1) {
        code = candidates[0].obshtina;
      } else if (candidates.length > 1) {
        // Oblast-center municípios use the canonical obshtina code (e.g.
        // BGS04 for Бургас, not BGS06 for Средец). Pick the one whose
        // oblast 3-letter matches the město name conventionally.
        const sortedCandidates = candidates
          .slice()
          .sort((a, b) => a.obshtina.localeCompare(b.obshtina));
        code = sortedCandidates[0].obshtina;
      }
    }
    if (!code) {
      console.warn(`unmatched: ${r.name}`);
      unmatched++;
      continue;
    }
    scoresByObshtina[code] = {
      composite: r.composite,
      pillars: {},
      nationalRank: i + 1,
    };
  }

  const out = {
    source: "Асоциация „Прозрачност без граници“ (TI-BG)",
    sourceUrl: "https://lisi.transparency.bg/",
    indexName: "Local Integrity System Index (LISI)",
    year: YEAR,
    nationalAverage: NATIONAL_AVERAGE_2024,
    scoreScale: { min: 0, max: 5 },
    pillarLabels: {
      procurement_transparency: {
        bg: "Прозрачност на обществените поръчки",
        en: "Procurement transparency",
      },
      budget_transparency: {
        bg: "Бюджетна прозрачност",
        en: "Budget transparency",
      },
      council_oversight: {
        bg: "Надзор от общинския съвет",
        en: "Council oversight",
      },
      conflict_of_interest: {
        bg: "Конфликт на интереси",
        en: "Conflict of interest enforcement",
      },
      citizen_participation: {
        bg: "Гражданско участие",
        en: "Citizen participation",
      },
      audit: { bg: "Одит", en: "Audit" },
      asset_declarations: {
        bg: "Декларации за имущество",
        en: "Asset declarations",
      },
      public_data: { bg: "Публични данни", en: "Public data" },
      integrity_response: {
        bg: "Реакция при сигнали",
        en: "Integrity response",
      },
    },
    scoresByObshtina,
    note: `LISI surveys only the 27 oblast-center municipalities. The hook returns undefined for the other 238 municípios, which makes the tile auto-hide elsewhere. Per-pillar sub-scores are exposed in the source's interactive UI but not published as downloadable data — pillars{} is kept empty until a follow-up scrape lands.`,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + "\n");
  console.log(
    `Wrote ${OUT_FILE} — ${Object.keys(scoresByObshtina).length}/${LISI_2024.length} municípios mapped, ${unmatched} unmatched`,
  );
};

main();
