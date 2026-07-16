// Citizen digital skills — Eurostat isoc_sk_dskl_i21 (Digital Skills Indicator
// 2.0, the DESI human-capital pillar). The demand-side companion to egov.json:
// e-government adoption is the supply of digital public services, this is the
// population's ability to use them. Bulgaria ranks 26/27 in the EU on the
// headline "at least basic digital skills" and dead last among young people
// (16-24) — the story the /sector/administration page tells beside egov.
//
//   npx tsx scripts/administration/fetch_digital_skills.ts
//
// Written as a self-contained artifact (data/administration/digital_skills.json)
// like egov.json, not folded into macro.json — the peer geos and the full-27
// youth cross-section (needed for the EU choropleth) don't belong in the BG-only
// macro series. Refresh cadence is biennial (Eurostat publishes odd years:
// 2021 / 2023 / 2025). The `eurostat_digital_skills` watcher flips it.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");
const OUT = path.resolve(REPO_ROOT, "data/administration/digital_skills.json");

const DATASET = "isoc_sk_dskl_i21";
const BASE =
  "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data";

// Same peer set as egov.json / macro_peers.json (EL = Greece in Eurostat codes).
const PEERS = ["BG", "EU27_2020", "RO", "EL", "HU", "HR"] as const;

// The 27 EU members in Eurostat geo codes (EL = Greece). Used to compute BG's
// EU rank from the full cross-section rather than hard-coding "26 of 27" — the
// margin over Romania is razor-thin, so a future release can flip it.
const EU27 = new Set([
  "BE",
  "BG",
  "CZ",
  "DK",
  "DE",
  "EE",
  "IE",
  "EL",
  "ES",
  "FR",
  "HR",
  "IT",
  "CY",
  "LV",
  "LT",
  "LU",
  "HU",
  "MT",
  "NL",
  "AT",
  "PL",
  "PT",
  "RO",
  "SI",
  "SK",
  "FI",
  "SE",
]);

// BG's rank among the EU-27 for a geo→value map, counting from the best
// (rank 1 = best; rank === total = last). Returns null if BG is absent.
const euRankOfBg = (
  byGeo: Record<string, number>,
  higherIsBetter = true,
): { rank: number; total: number; isLast: boolean } | null => {
  const members = Object.entries(byGeo).filter(([g]) => EU27.has(g));
  if (!members.some(([g]) => g === "BG")) return null;
  // Sort best-first: for higher-is-better, descending value = best first.
  members.sort((a, b) => (higherIsBetter ? b[1] - a[1] : a[1] - b[1]));
  const rank = members.findIndex(([g]) => g === "BG") + 1;
  return { rank, total: members.length, isLast: rank === members.length };
};

// The five DigComp 2.0 competence areas — basic-or-above indicator code + label.
const AREAS = [
  {
    code: "IL",
    indic: "I_DSK2_IL_BAB",
    labelBg: "Информация и грамотност",
    labelEn: "Information & data literacy",
  },
  {
    code: "CC",
    indic: "I_DSK2_CC_BAB",
    labelBg: "Комуникация и сътрудничество",
    labelEn: "Communication & collaboration",
  },
  {
    code: "DCC",
    indic: "I_DSK2_DCC_BAB",
    labelBg: "Създаване на съдържание",
    labelEn: "Digital content creation",
  },
  {
    code: "SF",
    indic: "I_DSK2_SF_BAB",
    labelBg: "Безопасност",
    labelEn: "Safety",
  },
  {
    code: "PS",
    indic: "I_DSK2_PS_BAB",
    labelBg: "Решаване на проблеми",
    labelEn: "Problem solving",
  },
] as const;

interface StatRecord {
  [dim: string]: string | number;
  value: number;
}

// Minimal N-dimensional JSON-stat v2 decoder: yields one record per non-null
// value with each dimension resolved to its category code plus `value`.
const decodeJsonStat = (j: {
  id: string[];
  size: number[];
  dimension: Record<string, { category: { index: Record<string, number> } }>;
  value: Record<string, number>;
}): StatRecord[] => {
  const { id, size, dimension } = j;
  // position -> code, per dimension.
  const codeAt: Record<string, string[]> = {};
  for (const dim of id) {
    const arr: string[] = [];
    for (const [code, pos] of Object.entries(dimension[dim].category.index)) {
      arr[pos] = code;
    }
    codeAt[dim] = arr;
  }
  // Row-major strides (last dimension varies fastest).
  const strides = new Array(id.length).fill(1);
  for (let d = id.length - 2; d >= 0; d--) {
    strides[d] = strides[d + 1] * size[d + 1];
  }
  const out: StatRecord[] = [];
  for (const [flatStr, val] of Object.entries(j.value)) {
    if (typeof val !== "number") continue;
    const flat = Number(flatStr);
    const rec = { value: val } as StatRecord;
    for (let d = 0; d < id.length; d++) {
      const pos = Math.floor(flat / strides[d]) % size[d];
      rec[id[d]] = codeAt[id[d]][pos];
    }
    out.push(rec);
  }
  return out;
};

const fetchStat = async (
  params: Record<string, string | string[]>,
): Promise<StatRecord[]> => {
  const qs = new URLSearchParams();
  qs.set("format", "JSON");
  qs.set("lang", "EN");
  qs.set("freq", "A");
  qs.set("unit", "PC_IND");
  for (const [k, v] of Object.entries(params)) {
    for (const item of Array.isArray(v) ? v : [v]) qs.append(k, item);
  }
  const url = `${BASE}/${DATASET}?${qs.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} (${url})`);
  return decodeJsonStat(
    (await res.json()) as Parameters<typeof decodeJsonStat>[0],
  );
};

interface Point {
  year: number;
  value: number;
}
const sortByYear = (pts: Point[]) => pts.sort((a, b) => a.year - b.year);

const run = async (): Promise<void> => {
  // --- Call A: headline + composition + areas (IND_TOTAL, peer geos, all years).
  // The below-basic overall levels (low / narrow / limited) are fetched
  // explicitly so the composition "below basic" segment is a real sum, not a
  // 100−rest residual that would silently absorb any rounding/category drift.
  const BELOW_BASIC = ["I_DSK2_LW", "I_DSK2_N", "I_DSK2_LM"];
  const totalIndics = [
    "I_DSK2_BAB", // at least basic overall
    ...BELOW_BASIC, // low / narrow / limited overall
    "I_DSK2_X", // no skills
    "I_DSK2_NA", // could not be assessed (non-internet-users)
    ...AREAS.map((a) => a.indic),
  ];
  const totalRecs = await fetchStat({
    ind_type: "IND_TOTAL",
    indic_is: totalIndics,
    geo: [...PEERS],
  });

  // Headline "at least basic" time series, by peer geo.
  const atLeastBasic: Record<string, Point[]> = {};
  for (const geo of PEERS) atLeastBasic[geo] = [];
  for (const r of totalRecs) {
    if (r.indic_is !== "I_DSK2_BAB") continue;
    const geo = String(r.geo);
    if (!atLeastBasic[geo]) continue;
    atLeastBasic[geo].push({ year: Number(r.time), value: r.value });
  }
  for (const geo of PEERS) sortByYear(atLeastBasic[geo]);

  // Composition over waves (BG only): at-least-basic / below-basic (explicit sum
  // of low+narrow+limited) / no-skills / not-assessed. The four partition ~100%.
  const compByYear = new Map<
    number,
    {
      year: number;
      atLeastBasic?: number;
      below?: number;
      noSkills?: number;
      notAssessed?: number;
    }
  >();
  const directField: Record<
    string,
    "atLeastBasic" | "noSkills" | "notAssessed"
  > = {
    I_DSK2_BAB: "atLeastBasic",
    I_DSK2_X: "noSkills",
    I_DSK2_NA: "notAssessed",
  };
  const belowSet = new Set(BELOW_BASIC);
  for (const r of totalRecs) {
    if (r.geo !== "BG") continue;
    const indic = String(r.indic_is);
    const year = Number(r.time);
    const row = compByYear.get(year) ?? { year };
    const key = directField[indic];
    if (key) row[key] = r.value;
    else if (belowSet.has(indic)) row.below = (row.below ?? 0) + r.value;
    compByYear.set(year, row);
  }
  const composition = [...compByYear.values()]
    .map((r) => ({
      ...r,
      below: r.below != null ? Math.round(r.below * 100) / 100 : r.below,
    }))
    .sort((a, b) => a.year - b.year);

  // Anchor on BG's OWN latest year (Eurostat sometimes ships EU27/peers first).
  const bgBasic = atLeastBasic.BG ?? [];
  const latestYear = bgBasic.length
    ? Math.max(...bgBasic.map((p) => p.year))
    : Math.max(...composition.map((c) => c.year));

  // Five competence areas at the latest year, BG value + EU average.
  const latestTotal = totalRecs.filter((r) => Number(r.time) === latestYear);
  const valAt = (indic: string, geo: string): number | null => {
    const r = latestTotal.find((x) => x.indic_is === indic && x.geo === geo);
    return r ? r.value : null;
  };
  const areas = AREAS.map((a) => ({
    code: a.code,
    labelBg: a.labelBg,
    labelEn: a.labelEn,
    bgValue: valAt(a.indic, "BG"),
    euValue: valAt(a.indic, "EU27_2020"),
  }));

  // --- Call A2: headline at-least-basic (16-74), ALL geos, latest year — the
  // full EU-27 cross-section needed to derive BG's rank instead of hard-coding.
  const headlineRecs = await fetchStat({
    ind_type: "IND_TOTAL",
    indic_is: "I_DSK2_BAB",
    lastTimePeriod: "1",
  });
  const headlineByGeo: Record<string, number> = {};
  for (const r of headlineRecs) headlineByGeo[String(r.geo)] = r.value;
  const headlineRank = euRankOfBg(headlineByGeo);

  // --- Call B: youth (16-24) at-least-basic, ALL geos, latest year — powers the
  // EU choropleth + ranking strip.
  const youthRecs = await fetchStat({
    ind_type: "Y16_24",
    indic_is: "I_DSK2_BAB",
    lastTimePeriod: "1",
  });
  const youthByGeo: Record<string, number> = {};
  for (const r of youthRecs) youthByGeo[String(r.geo)] = r.value;
  // Anchor the youth year on the max across records, not iteration order.
  const youthYear = youthRecs.length
    ? Math.max(...youthRecs.map((r) => Number(r.time)))
    : latestYear;
  const youthRank = euRankOfBg(youthByGeo);

  // --- Call C: youth by sex (BG) — the reverse gender gap.
  const sexRecs = await fetchStat({
    ind_type: ["Y16_24", "M_Y16_24", "F_Y16_24"],
    indic_is: "I_DSK2_BAB",
    geo: "BG",
    lastTimePeriod: "1",
  });
  const sexVal = (t: string) =>
    sexRecs.find((r) => r.ind_type === t)?.value ?? null;

  const payload = {
    indicator: {
      dataset: DATASET,
      code: "I_DSK2_BAB",
      titleBg: "Дигитални умения на гражданите",
      titleEn: "Citizen digital skills",
      unit: "% of individuals aged 16-74",
    },
    source: {
      name: "Eurostat",
      url: `https://ec.europa.eu/eurostat/databrowser/view/${DATASET}/default/table`,
    },
    fetchedAt: new Date().toISOString(),
    latestYear,
    peers: [...PEERS],
    // BG's rank among the EU-27 on the headline "at least basic" metric,
    // computed from the full cross-section (rank 1 = lowest).
    rank: headlineRank,
    atLeastBasic,
    composition,
    areas,
    youth: {
      latestYear: youthYear,
      unit: "% of individuals aged 16-24",
      byGeo: youthByGeo,
      rank: youthRank,
      bg: {
        total: sexVal("Y16_24"),
        male: sexVal("M_Y16_24"),
        female: sexVal("F_Y16_24"),
      },
    },
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2));
  const bgLatest = bgBasic.at(-1);
  console.log(
    `✓ wrote ${path.relative(REPO_ROOT, OUT)} — BG at-least-basic ${bgLatest?.value}% (${latestYear}); youth ${youthYear}: BG ${youthByGeo.BG}%, EU ${youthByGeo.EU27_2020}%, ${Object.keys(youthByGeo).length} geos`,
  );
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
