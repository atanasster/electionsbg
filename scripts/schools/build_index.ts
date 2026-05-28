// Build per-school index from already-downloaded MON ДЗИ CSVs.
//
// Reuses the CSVs that update-indicators (scripts/indicators/sources/mon_dzi.ts)
// already fetches into raw_data/indicators/mon/{year}.csv. Each CSV row is
// one school with subject-wise scores. We keep school-level granularity here
// instead of aggregating to município like the indicators ingest — that's the
// whole point of the My-Area schools tile.
//
// Output: data/schools/index.json with the shape the SPA useSchools hook
// expects: schoolsByObshtina[obshtina][] = { id, name, type, address,
// scoresByYear: { '2025': { dzi_bel, dzi_math } } }.
//
// NVO (7th grade) per-school data is published as a separate MON dataset;
// not included in this first cut. The tile filters absent subjects so DZI-
// only output already powers the top-N / bottom-N ranking on every município.
//
// Run: `npx tsx scripts/schools/build_index.ts`

import fs from "node:fs";
import path from "node:path";
import { normalize } from "../indicators/normalize";

const PROJECT_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
);
const RAW_DIR = path.join(PROJECT_ROOT, "raw_data/indicators/mon");
const OUT_FILE = path.join(PROJECT_ROOT, "data/schools/index.json");

// Years to include. We keep the last 3 years so the SPA can plot a small
// trajectory per school later. Older years use different CSV layouts that
// don't ship the school-id column; skip them.
const YEARS = [2023, 2024, 2025];

type SchoolRecord = {
  id: string;
  name: string;
  type?: "primary" | "secondary" | "mixed";
  address?: string;
  loc?: string;
  scoresByYear: Record<string, Record<string, number>>;
};

const parseCsvLine = (line: string): string[] => {
  const cells: string[] = [];
  let buf = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (c === "," && !inQuotes) {
      cells.push(buf);
      buf = "";
    } else {
      buf += c;
    }
  }
  cells.push(buf);
  return cells;
};

const parseCsvRows = (text: string): string[][] => {
  // Strip leading UTF-8 BOM (U+FEFF) via Unicode escape to keep eslint
  // happy under no-irregular-whitespace.
  const t = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '"') inQuotes = !inQuotes;
    if (c === "\n" && !inQuotes) {
      rows.push(parseCsvLine(cur));
      cur = "";
    } else if (c === "\r" && !inQuotes) {
      // skip
    } else {
      cur += c;
    }
  }
  if (cur.length > 0) rows.push(parseCsvLine(cur));
  return rows;
};

const stripBom = (s: string): string =>
  s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
const normRow = (row: string[]) =>
  row.map((h) => stripBom(h).replace(/\s+/g, " ").trim());

// Locate a paired (count, score) header at given subject regex. Returns
// `[countIdx, scoreIdx]` or null. The CSV uses two adjacent columns:
// "Бр. <subject>" + "Ср.усп. <subject>".
const findSubjectCols = (
  header: string[],
  countPattern: RegExp,
  scorePattern: RegExp,
): [number, number] | null => {
  const c = header.findIndex((h) => countPattern.test(h));
  const s = header.findIndex((h) => scorePattern.test(h));
  if (c < 0 || s < 0) return null;
  return [c, s];
};

type RawSchool = {
  oblast: string;
  obshtina: string;
  settlement: string;
  schoolName: string;
  schoolId: string;
  // Subject -> score (count-weighted-mean isn't relevant — we already have
  // the per-school average from the source).
  scores: Record<string, number>;
};

const parseYearCsv = (file: string): RawSchool[] => {
  const text = fs.readFileSync(file, "utf8");
  const rows = parseCsvRows(text);
  if (rows.length < 2) return [];
  const header = normRow(rows[0]);

  const oblastIdx = header.findIndex((c) => /област/i.test(c));
  const obshtinaIdx = header.findIndex((c) => /община/i.test(c));
  const settlementIdx = header.findIndex((c) => /населено/i.test(c));
  const schoolNameIdx = header.findIndex((c) => /^училище/i.test(c));
  const schoolIdIdx = header.findIndex((c) => /код по неиспуо/i.test(c));

  if (oblastIdx < 0 || obshtinaIdx < 0 || schoolNameIdx < 0) {
    return [];
  }

  const belCols = findSubjectCols(
    header,
    /^бр\.?\s*БЕЛ\(ООП\)/i,
    /^ср\.?\s*усп\.?\s*БЕЛ\(ООП\)/i,
  );
  const mathCols = findSubjectCols(
    header,
    /^бр\.?\s*Мат\(ПП\)/i,
    /^ср\.?\s*усп\.?\s*Мат\(ПП\)/i,
  );

  const out: RawSchool[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    if (cells.length < 4) continue;
    const oblast = cells[oblastIdx]?.trim();
    const obshtina = cells[obshtinaIdx]?.trim();
    const settlement =
      settlementIdx >= 0 ? (cells[settlementIdx] ?? "").trim() : "";
    const schoolName = cells[schoolNameIdx]?.trim();
    const schoolId = schoolIdIdx >= 0 ? (cells[schoolIdIdx] ?? "").trim() : "";
    if (!oblast || !obshtina || !schoolName) continue;
    // Skip aggregate rows ("ОБЛАСТ", totals etc.).
    if (/^област/i.test(oblast) && !cells[obshtinaIdx]) continue;

    const scores: Record<string, number> = {};
    if (belCols) {
      const count = Number(cells[belCols[0]]?.trim());
      const raw = cells[belCols[1]]?.trim().replace(",", ".");
      const score = Number(raw);
      if (count > 0 && Number.isFinite(score) && score > 0) {
        scores.dzi_bel = Math.round(score * 100) / 100;
      }
    }
    if (mathCols) {
      const count = Number(cells[mathCols[0]]?.trim());
      const raw = cells[mathCols[1]]?.trim().replace(",", ".");
      const score = Number(raw);
      if (count > 0 && Number.isFinite(score) && score > 0) {
        scores.dzi_math = Math.round(score * 100) / 100;
      }
    }
    if (Object.keys(scores).length === 0) continue;
    out.push({
      oblast,
      obshtina,
      settlement,
      schoolName,
      schoolId: schoolId || schoolName, // fallback when NEISPUO code is blank
      scores,
    });
  }
  return out;
};

// Resolve raw (oblast, obshtina) string pairs to obshtina codes via the
// existing indicators normalize() helper. We feed it one row per
// distinct (oblast, obshtina) pair (value is meaningless, ignored by
// caller) so we get back code mappings without doing N×normalize passes.
const buildObshtinaMap = (
  byYear: Record<number, RawSchool[]>,
): Map<string, string> => {
  const pairs = new Map<string, { oblast: string; muniName: string }>();
  for (const rows of Object.values(byYear)) {
    for (const r of rows) {
      const key = `${r.oblast}||${r.obshtina}`;
      if (!pairs.has(key)) {
        pairs.set(key, { oblast: r.oblast, muniName: r.obshtina });
      }
    }
  }
  const inputs = Array.from(pairs.values()).map((p) => ({
    year: 0,
    oblastContext: p.oblast,
    muniName: p.muniName,
    value: 1,
  }));
  const report = normalize(inputs);
  const map = new Map<string, string>();
  let i = 0;
  for (const [key] of pairs) {
    const mapped = report.matched.find(
      (m) =>
        m.year === 0 &&
        // matched preserves order of input, so we can pair by index
        report.matched.indexOf(m) === i,
    );
    if (mapped) map.set(key, mapped.obshtinaCode);
    i++;
  }
  // Faster + correct: ignore the .find acrobatics and use input order
  // directly — normalize() preserves order and emits at most one matched
  // entry per matched input. Rebuild the map cleanly.
  map.clear();
  const pairKeys = Array.from(pairs.keys());
  // matched is sparse (some inputs may be unmatched); rebuild by walking
  // matched in order against the input list to find which input each
  // matched entry came from. Cheap: <300 pairs.
  const mIdx = 0;
  for (let inputIdx = 0; inputIdx < inputs.length; inputIdx++) {
    if (mIdx >= report.matched.length) break;
    // normalize() returns matched in the same order as it processed inputs,
    // skipping unmatched ones. We don't know which inputs were skipped
    // without a side-channel — re-run per-input.
    void inputIdx;
  }
  // Cleanest: call normalize one pair at a time.
  for (let pk = 0; pk < pairKeys.length; pk++) {
    const pair = pairs.get(pairKeys[pk])!;
    const single = normalize([
      {
        year: 0,
        oblastContext: pair.oblast,
        muniName: pair.muniName,
        value: 1,
      },
    ]);
    if (single.matched.length === 1) {
      map.set(pairKeys[pk], single.matched[0].obshtinaCode);
    }
  }
  return map;
};

const main = () => {
  if (!fs.existsSync(RAW_DIR)) {
    console.error(`raw dir missing: ${RAW_DIR}`);
    process.exit(1);
  }
  const byYear: Record<number, RawSchool[]> = {};
  for (const year of YEARS) {
    const file = path.join(RAW_DIR, `${year}.csv`);
    if (!fs.existsSync(file)) {
      console.warn(`skip ${year}: missing ${file}`);
      continue;
    }
    const rows = parseYearCsv(file);
    if (rows.length === 0) {
      console.warn(`skip ${year}: zero rows parsed`);
      continue;
    }
    byYear[year] = rows;
    console.log(`parsed ${year}: ${rows.length} school rows`);
  }
  const years = Object.keys(byYear).map(Number).sort();
  if (years.length === 0) {
    console.error("no usable CSV years");
    process.exit(1);
  }
  const latestYear = Math.max(...years);

  // Map (oblast, município name) → obshtina code via the indicators
  // normalize() helper, including Sofia city-aggregate fallback.
  const pairMap = buildObshtinaMap(byYear);
  console.log(`mapped ${pairMap.size} (oblast, obshtina-name) pairs to codes`);

  // Schools keyed by a stable identifier so we can merge across years.
  // Use NEISPUO id when present; otherwise fall back to a deterministic
  // hash of (obshtina-code, school name) per year.
  const byObshtina = new Map<string, Map<string, SchoolRecord>>();
  for (const year of years) {
    for (const row of byYear[year]) {
      const code = pairMap.get(`${row.oblast}||${row.obshtina}`);
      if (!code) continue;
      let inner = byObshtina.get(code);
      if (!inner) {
        inner = new Map();
        byObshtina.set(code, inner);
      }
      const key = row.schoolId || `${code}::${row.schoolName}`;
      let rec = inner.get(key);
      if (!rec) {
        rec = {
          id: key,
          name: row.schoolName,
          address: row.settlement || undefined,
          scoresByYear: {},
        };
        inner.set(key, rec);
      }
      rec.scoresByYear[String(year)] = row.scores;
    }
  }

  // Build output, sorting schools per município by latest-year composite
  // score desc — gives the SPA a stable ordering.
  const schoolsByObshtina: Record<string, SchoolRecord[]> = {};
  let totalSchools = 0;
  for (const [code, inner] of byObshtina) {
    const arr = Array.from(inner.values()).sort((a, b) => {
      const av = compositeFor(a, latestYear);
      const bv = compositeFor(b, latestYear);
      return (bv ?? -1) - (av ?? -1);
    });
    schoolsByObshtina[code] = arr;
    totalSchools += arr.length;
  }

  const out = {
    source: "МОН (Министерство на образованието и науката) via data.egov.bg",
    sourceUrl:
      "https://data.egov.bg/data/view/066b4b04-d81d-444e-a61c-8ca0516079e4",
    indexName: "Per-school ДЗИ average scores (matura)",
    latestYear,
    subjects: {
      nvo_bel: {
        bg: "НВО Български език и литература",
        en: "NVO Bulgarian language",
      },
      nvo_math: { bg: "НВО Математика", en: "NVO Mathematics" },
      dzi_bel: {
        bg: "ДЗИ Български език и литература",
        en: "Matura Bulgarian language",
      },
      dzi_math: { bg: "ДЗИ Математика", en: "Matura Mathematics" },
    },
    schoolsByObshtina,
    note: `First-cut DZI per-school index (NVO 7th-grade per-school data published as a separate dataset, pending follow-up). Years covered: ${years.join(", ")}.`,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + "\n");
  console.log(
    `Wrote ${OUT_FILE} — ${Object.keys(schoolsByObshtina).length} municípios, ${totalSchools} schools`,
  );
};

const compositeFor = (s: SchoolRecord, year: number): number | null => {
  const y = s.scoresByYear[String(year)];
  if (!y) return null;
  const vals = Object.values(y).filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v),
  );
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
};

main();
