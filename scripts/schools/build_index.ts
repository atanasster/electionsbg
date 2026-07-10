// Build per-school index from already-downloaded MON ДЗИ CSVs.
//
// Reuses the CSVs that update-indicators (scripts/indicators/sources/mon_dzi.ts)
// already fetches into raw_data/indicators/mon/{year}.csv. Each CSV row is
// one school with subject-wise scores. We keep school-level granularity here
// instead of aggregating to município like the indicators ingest — that's the
// whole point of the My-Area schools tile.
//
// Output: data/schools/index.json with the shape the SPA useSchools hook
// expects: schoolsByObshtina[obshtina][] = { id, name, address, loc,
// scoresByYear: { '2026': { dzi_bel, dzi_math } }, countsByYear (examinee
// counts, for small-N suppression), nvoByYear (7th-grade НВО points, the
// prior-attainment baseline for value-added — folded in from
// scripts/schools/fetch_nvo.ts). Geocodes come from settlement centroids.
//
// Run: `npx tsx scripts/schools/build_index.ts` (after fetch_nvo.ts for НВО).

import fs from "node:fs";
import path from "node:path";
import { normalize } from "../indicators/normalize";
import { parseCsvRows, normRow } from "../lib/csv";

const PROJECT_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
);
const RAW_DIR = path.join(PROJECT_ROOT, "raw_data/indicators/mon");
const NVO_RAW_DIR = path.join(PROJECT_ROOT, "raw_data/indicators/mon_nvo");
const OUT_FILE = path.join(PROJECT_ROOT, "data/schools/index.json");
const SETTLEMENTS_FILE = path.join(PROJECT_ROOT, "data/settlements.json");
const MUNICIPALITIES_FILE = path.join(PROJECT_ROOT, "data/municipalities.json");

// 7th-grade НВО years to fold in (points 0–100), fetched by fetch_nvo.ts. НВО in
// year Y is the prior attainment of the ДЗИ cohort in year Y+5, powering the
// value-added ("напредък 7→12 клас") computed client-side.
const NVO_YEARS = [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];

// Столична община is a single SOF00 aggregate in the МОН data and is not a
// settlement/obshtina in settlements.json, so its ~157 schools can't be
// settlement-geocoded; place them at the Sofia city centre (lng,lat). The map
// clusters them as one Sofia pin — honest until per-school МОН-register
// coordinates land (a later phase).
const SOFIA_CENTER = "23.3219,42.6977";

type GeoLookup = {
  bySettlement: Map<string, string>; // `${obshtina}|${UPPER name}` → "lng,lat"
  byObshtina: Map<string, string>; // obshtina code → centroid "lng,lat"
};

const loadGeo = (): GeoLookup => {
  const bySettlement = new Map<string, string>();
  const byObshtina = new Map<string, string>();
  if (fs.existsSync(SETTLEMENTS_FILE)) {
    const s: { obshtina?: string; name?: string; loc?: string }[] = JSON.parse(
      fs.readFileSync(SETTLEMENTS_FILE, "utf8"),
    );
    for (const x of s) {
      if (x.obshtina && x.name && x.loc)
        bySettlement.set(`${x.obshtina}|${x.name.toUpperCase()}`, x.loc);
    }
  }
  if (fs.existsSync(MUNICIPALITIES_FILE)) {
    const m: { obshtina?: string; loc?: string }[] = JSON.parse(
      fs.readFileSync(MUNICIPALITIES_FILE, "utf8"),
    );
    for (const x of m)
      if (x.obshtina && x.loc) byObshtina.set(x.obshtina, x.loc);
  }
  return { bySettlement, byObshtina };
};

// "ГР.БАНСКО" / "С.КАРАПЕЛИТ" → "БАНСКО" / "КАРАПЕЛИТ" (drop the град/село tag).
const settlementName = (address: string): string =>
  address
    .replace(/^(ГР\.|С\.|ГР |С |ГРАД |СЕЛО )/i, "")
    .replace(/\(.*$/, "") // drop parentheticals like "(ГАРА ЕЛИН ПЕЛИН)"
    .trim()
    .toUpperCase();

// Resolve a school's coordinate: exact settlement centroid → obshtina centroid.
const geocode = (
  geo: GeoLookup,
  obshtina: string,
  address?: string,
): string | undefined => {
  if (obshtina === "SOF00") return SOFIA_CENTER;
  if (address) {
    const hit = geo.bySettlement.get(`${obshtina}|${settlementName(address)}`);
    if (hit) return hit;
  }
  return geo.byObshtina.get(obshtina); // coarse fallback (obshtina centre)
};

// Years to include. МОН publishes a mandatory May-June ДЗИ resource per year on
// data.egov.bg; the modern school-level format runs 2022→. We ingest the full
// window so the SPA can plot a real multi-year trajectory (and compute growth).
// The CSV layout drifts across years — 2022 labels the id column "Код по Админ"
// (vs "Код по НЕИСПУО" later), 2023 uses a THREE-ROW header, 2026 embeds
// newlines inside header cells — all handled by resolveHeader() below.
const YEARS = [2022, 2023, 2024, 2025, 2026];

// A year with fewer than this many parsed schools is almost certainly a header/
// format regression (real years carry ~950+), not a real drop — warn loudly.
const MIN_SCHOOLS_PER_YEAR = 300;

type SchoolRecord = {
  id: string;
  name: string;
  type?: "primary" | "secondary" | "mixed";
  address?: string;
  loc?: string;
  scoresByYear: Record<string, Record<string, number>>;
  // Per-year, per-subject examinee count (cohort size). Powers small-N
  // suppression + confidence intervals downstream, and doubles as an
  // enrollment proxy. Parallel to scoresByYear so existing consumers ignore it.
  countsByYear?: Record<string, Record<string, number>>;
  // 7th-grade НВО score in POINTS (0–100) by year — the prior-attainment
  // baseline for value-added. Kept separate from scoresByYear (different scale
  // and cohort year) so it never pollutes the matura series/composite.
  nvoByYear?: Record<string, { bel?: number; math?: number }>;
  // ЕИК (Bulstat), resolved from the procurement awarder corpus by
  // scripts/schools/match_eik.ts (run after this). Present only for confident
  // matches; links the school into the entity graph (contracts, TR).
  eik?: string;
};

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
  // Subject -> average score (per-school average as published by МОН).
  scores: Record<string, number>;
  // Subject -> examinee count (cohort size) for the same school-year.
  counts: Record<string, number>;
};

// Resolve the header, coping with МОН's three layouts:
//  - single-row (2022/2024/2025, and 2026 once normRow collapses the embedded
//    newlines): the count/score markers live in row 0, e.g. "Бр. БЕЛ(ООП) З".
//  - three-row (2023): row 0 = subject ("БЕЛ(ООП)"), row 1 = "З", row 2 =
//    "Бр."/"Ср.усп." — the markers and the subject are on different rows.
// Returns a flattened single header row + the index where data begins.
const resolveHeader = (
  rows: string[][],
): { header: string[]; dataStart: number } => {
  const r0 = normRow(rows[0]);
  // A single-row header carries a "Бр. <subject>(" / "Ср.усп. <subject>(" cell.
  const singleRow = r0.some(
    (c) => /^(бр|ср\.?\s*усп)/i.test(c) && /\(/.test(c),
  );
  if (singleRow) return { header: r0, dataStart: 1 };

  // Multi-row: find the marker row (bare "Бр." / "Ср.усп.") within the first
  // few rows, then combine it with the forward-filled subject row (row 0).
  const markerRowIdx = rows
    .slice(0, 4)
    .findIndex(
      (row, i) =>
        i > 0 && normRow(row).some((c) => /^(бр\.?$|ср\.?\s*усп\.?$)/i.test(c)),
    );
  if (markerRowIdx < 1) return { header: r0, dataStart: 1 };

  const subj = normRow(rows[0]);
  const marker = normRow(rows[markerRowIdx]);
  const filled: string[] = [];
  let last = "";
  for (let i = 0; i < subj.length; i++) {
    if (subj[i]) last = subj[i];
    filled[i] = last;
  }
  const header = filled.map((s, i) =>
    marker[i] ? `${marker[i]} ${s}`.trim() : s,
  );
  return { header, dataStart: markerRowIdx + 1 };
};

const parseYearCsv = (file: string): RawSchool[] => {
  const text = fs.readFileSync(file, "utf8");
  const rows = parseCsvRows(text);
  if (rows.length < 2) return [];
  const { header, dataStart } = resolveHeader(rows);

  const oblastIdx = header.findIndex((c) => /област/i.test(c));
  const obshtinaIdx = header.findIndex((c) => /община/i.test(c));
  const settlementIdx = header.findIndex((c) => /населено/i.test(c));
  const schoolNameIdx = header.findIndex((c) => /^училище/i.test(c));
  // 2022/2023 label the id column "Код по Админ"; 2024+ "Код по НЕИСПУО".
  const schoolIdIdx = header.findIndex((c) =>
    /код по (неиспуо|админ)/i.test(c),
  );

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
  for (let r = dataStart; r < rows.length; r++) {
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
    const counts: Record<string, number> = {};
    const readSubject = (cols: [number, number] | null, key: string): void => {
      if (!cols) return;
      const count = Number(cells[cols[0]]?.trim());
      const raw = cells[cols[1]]?.trim().replace(",", ".");
      const score = Number(raw);
      if (count > 0 && Number.isFinite(score) && score > 0) {
        scores[key] = Math.round(score * 100) / 100;
        counts[key] = count;
      }
    };
    readSubject(belCols, "dzi_bel");
    readSubject(mathCols, "dzi_math");
    if (Object.keys(scores).length === 0) continue;
    out.push({
      oblast,
      obshtina,
      settlement,
      schoolName,
      schoolId, // may be "" when the NEISPUO code is blank; the obshtina-
      // qualified fallback is applied downstream (see byObshtina keying)
      scores,
      counts,
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
  // normalize() emits matched entries sparsely (unmatched inputs are dropped),
  // so we can't pair a batch call's output back to its inputs by index. Resolve
  // one pair at a time — cheap at <300 distinct (oblast, obshtina) pairs.
  const map = new Map<string, string>();
  for (const [key, pair] of pairs) {
    const single = normalize([
      {
        year: 0,
        oblastContext: pair.oblast,
        muniName: pair.muniName,
        value: 1,
      },
    ]);
    if (single.matched.length === 1) {
      map.set(key, single.matched[0].obshtinaCode);
    }
  }
  return map;
};

// Parse one 7th-grade НВО CSV → Map<НЕИСПУО id → { bel, math }> (points 0–100).
// НВО layouts vary by year: single-row headers ("БЕЛ Ср. успех в точки" 2024–26,
// "Ср. успех в точки БЕЛ" 2019), a two-row header (2021: markers in row 0,
// subjects in row 1), and leading title rows (2023). Ids are formatted with a
// thousands-space in some years ("105 201") → strip whitespace.
const parseNvoCsv = (
  file: string,
): Map<string, { bel?: number; math?: number }> => {
  const out = new Map<string, { bel?: number; math?: number }>();
  const rows = parseCsvRows(fs.readFileSync(file, "utf8"));
  if (rows.length < 2) return out;

  // Marker row = first row carrying a "Явили се" / "Ср. успех" / "точки" cell;
  // skip any leading title/metadata rows (2023 has 4: "Резултати…", "Максимален
  // бал", per-subject max scores).
  const hi = rows.findIndex((r) =>
    normRow(r).some((c) => /(явили се|ср\.?\s*усп|точки)/i.test(c)),
  );
  if (hi < 0) return out;
  const h0 = normRow(rows[hi]);
  const hasSubject = (row: string[]): boolean =>
    row.some((c) => /(бел|мат)/i.test(c));
  const isDataRow = (row: string[]): boolean =>
    row.filter((c) => /^\d/.test(c.trim())).length >= 3;

  let header = h0;
  let dataStart = hi + 1;
  if (!h0.some((c) => /(бел|мат)/i.test(c) && /(явили|усп|точки)/i.test(c))) {
    // Two-row header: the subject row is adjacent to the marker row — BELOW it
    // (2021) or ABOVE it (2023, where subjects span the score/count pair). Merge
    // markers with the forward-filled subject so each column carries both.
    const below = rows[hi + 1] ? normRow(rows[hi + 1]) : [];
    const above = hi > 0 ? normRow(rows[hi - 1]) : [];
    let subj: string[] | null = null;
    if (hasSubject(below) && !isDataRow(below)) {
      subj = below;
      dataStart = hi + 2;
    } else if (hasSubject(above)) {
      subj = above;
      dataStart = hi + 1;
    }
    if (subj) {
      // Forward-fill the subject across its (count, score) span; keep only the
      // subject tokens so leading label columns don't smear.
      const filled: string[] = [];
      let last = "";
      for (let i = 0; i < subj.length; i++) {
        if (subj[i]) last = subj[i];
        filled[i] = /(бел|мат|mat)/i.test(last) ? last : "";
      }
      // Where the marker row (h0) is empty — the id/oblast columns, which live
      // on the SUBJECT row when it sits above (2023) — fall back to it, so the
      // id column label isn't lost.
      header = h0.map((c, i) =>
        c ? `${c} ${filled[i] ?? ""}`.trim() : (subj![i] ?? ""),
      );
    }
  }

  const idIdx = header.findIndex((c) => /код/i.test(c));
  const belIdx = header.findIndex(
    (c) => /бел/i.test(c) && /(усп|точки)/i.test(c),
  );
  const matIdx = header.findIndex(
    (c) => /(мат|mat)/i.test(c) && /(усп|точки)/i.test(c),
  );
  if (idIdx < 0 || belIdx < 0) return out;

  const num = (s: string | undefined): number | undefined => {
    const v = Number((s ?? "").trim().replace(",", "."));
    return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : undefined;
  };
  for (let r = dataStart; r < rows.length; r++) {
    const cells = rows[r];
    const id = (cells[idIdx] ?? "").replace(/\s/g, "").trim();
    if (!/^[0-9]+$/.test(id)) continue;
    const bel = num(cells[belIdx]);
    const math = matIdx >= 0 ? num(cells[matIdx]) : undefined;
    if (bel == null && math == null) continue;
    out.set(id, { bel, math });
  }
  return out;
};

// year → (id → {bel,math}); empty if the НВО raw dir is absent.
const loadNvo = (): Map<
  number,
  Map<string, { bel?: number; math?: number }>
> => {
  const byYear = new Map<
    number,
    Map<string, { bel?: number; math?: number }>
  >();
  if (!fs.existsSync(NVO_RAW_DIR)) return byYear;
  for (const year of NVO_YEARS) {
    const f = path.join(NVO_RAW_DIR, `${year}.csv`);
    if (!fs.existsSync(f)) continue;
    const parsed = parseNvoCsv(f);
    if (parsed.size < 300) {
      // A present-but-underparsed file is a silent format regression (real years
      // carry ~1,700 schools) — warn loudly rather than dropping the year.
      console.warn(
        `WARNING НВО ${year}: only ${parsed.size} schools parsed — inspect ${f}`,
      );
    }
    if (parsed.size > 0) byYear.set(year, parsed);
  }
  return byYear;
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
      console.warn(
        `skip ${year}: zero rows parsed (header/format regression?)`,
      );
      continue;
    }
    if (rows.length < MIN_SCHOOLS_PER_YEAR) {
      // Don't silently ship a degraded year — a partial parse is worse than a
      // missing one because it looks complete.
      console.warn(
        `WARNING ${year}: only ${rows.length} schools parsed (< ${MIN_SCHOOLS_PER_YEAR}) — likely a header/format regression; inspect ${file}`,
      );
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

  const geo = loadGeo();

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
          loc: geocode(geo, code, row.settlement),
          scoresByYear: {},
          countsByYear: {},
        };
        inner.set(key, rec);
      }
      rec.scoresByYear[String(year)] = row.scores;
      if (Object.keys(row.counts).length > 0) {
        (rec.countsByYear ??= {})[String(year)] = row.counts;
      }
    }
  }

  // Fold in the 7th-grade НВО (prior attainment) by НЕИСПУО id.
  const nvo = loadNvo();
  let nvoMatched = 0;
  if (nvo.size > 0) {
    for (const inner of byObshtina.values()) {
      for (const rec of inner.values()) {
        let any = false;
        for (const [year, map] of nvo) {
          const hit = map.get(rec.id);
          if (!hit) continue;
          (rec.nvoByYear ??= {})[String(year)] = hit;
          any = true;
        }
        if (any) nvoMatched += 1;
      }
    }
    console.log(
      `НВО: ${nvo.size} years, matched to ${nvoMatched} schools by НЕИСПУО id`,
    );
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
    indexName:
      "Per-school ДЗИ (matura) averages + counts, geocodes, and 7th-grade НВО prior attainment",
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
    note: `Per-school ДЗИ index. countsByYear = examinee counts (small-N suppression / CIs); loc = settlement centroid; nvoByYear = 7th-grade НВО points (prior attainment, from fetch_nvo.ts) for value-added. ДЗИ years: ${years.join(", ")}.`,
  };

  const geocoded = Object.values(schoolsByObshtina)
    .flat()
    .filter((s) => s.loc).length;

  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + "\n");
  console.log(
    `Wrote ${OUT_FILE} — ${Object.keys(schoolsByObshtina).length} municípios, ${totalSchools} schools, ${geocoded} geocoded (${Math.round((100 * geocoded) / totalSchools)}%)`,
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
