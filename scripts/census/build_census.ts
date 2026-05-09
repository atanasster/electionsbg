/**
 * Parse NSI Census 2021 XLSX files into public/census_2021.json.
 *
 * Drop the four NSI publications into raw_data/census_2021/:
 *   - Census2021_Population_EN.xlsx
 *   - Census2021_Ethnocultural characteristics_EN.xlsx
 *   - Census2021_Economic characteristics_EN.xlsx
 *   - Census2021_Health status_EN.xlsx (optional)
 *
 * Output: oblast and obshtina rows keyed by NSI 3-letter / 5-char codes
 * (BLG / VID01 / ...) so they can be joined to our regions/municipalities
 * data via the `oblast` and `obshtina` fields.
 *
 * Usage: tsx scripts/census/build_census.ts
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as XLSX from "xlsx";

import type {
  CensusAge,
  CensusEducation,
  CensusEmployment,
  CensusEntity,
  CensusEthnic,
  CensusGender,
  CensusMunicipalityEntity,
  CensusOblastEntity,
  CensusPayload,
  CensusReligion,
} from "../../src/data/census/censusTypes";
import { regionCodes } from "../parsers/region_codes";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RAW_DIR = path.resolve(__dirname, "../../raw_data/census_2021");
const OUT_FILE = path.resolve(__dirname, "../../public/census_2021.json");
const OUT_SETTLEMENTS = path.resolve(
  __dirname,
  "../../public/census_2021_settlements.json",
);

const FILE_POP = "Census2021_Population_EN.xlsx";
const FILE_ETHNO = "Census2021_Ethnocultural characteristics_EN.xlsx";
const FILE_ECON = "Census2021_Economic characteristics_EN.xlsx";

// Bulgarian names for oblasts. NSI's English XLSX has only Latin names;
// the Bulgarian names come from our regions.json. We resolve oblasts via the
// 3-letter code and fall back to the English name if the lookup misses.
const oblastBgNames: Record<string, string> = {
  BLG: "Благоевград",
  BGS: "Бургас",
  VAR: "Варна",
  VTR: "Велико Търново",
  VID: "Видин",
  VRC: "Враца",
  GAB: "Габрово",
  DOB: "Добрич",
  KRZ: "Кърджали",
  KNL: "Кюстендил",
  LOV: "Ловеч",
  MON: "Монтана",
  PAZ: "Пазарджик",
  PER: "Перник",
  PVN: "Плевен",
  PDV: "Пловдив",
  RAZ: "Разград",
  RSE: "Русе",
  SLS: "Силистра",
  SLV: "Сливен",
  SML: "Смолян",
  SOF: "София (столица)",
  SFO: "София",
  SZR: "Стара Загора",
  TGV: "Търговище",
  HKV: "Хасково",
  SHU: "Шумен",
  JAM: "Ямбол",
};

type Row = (string | number | null | undefined)[];

const readSheet = (file: string, sheetName: string): Row[] => {
  const buf = fs.readFileSync(path.resolve(RAW_DIR, file));
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`Sheet "${sheetName}" not found in ${file}`);
  return XLSX.utils.sheet_to_json<Row>(ws, {
    header: 1,
    defval: null,
    raw: true,
  });
};

const num = (v: unknown): number => {
  if (v === null || v === undefined || v === "" || v === "-") return 0;
  if (typeof v === "number") return v;
  const cleaned = String(v).replace(/\s/g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
};

const isOblastCode = (code: string) => /^[A-Z]{3}$/.test(code);
const isMunicipalityCode = (code: string) =>
  /^[A-Z]{3}\d{2}$/.test(code) || /^[A-Z]{3}\d{2}-\d{2}$/.test(code);

const isCountryRow = (code: string) => code === "BG";

// NSI's NUTS prefixes (BG3, BG31, BG33, BG4, BG41, BG42) introduce
// macro/meso-region rows we want to skip — they are never oblast or
// municipality codes.
const isNutsRollupRow = (code: string) =>
  /^BG[34][0-9]?$/.test(code) && !isOblastCode(code);

const oblastNuts3FromCode = (code: string): string | undefined => {
  // Our region_codes.ts maps CIK 2-digit codes to NUTS3. Build a reverse map
  // from oblast 3-letter to NUTS3 by joining via regions.json.
  return oblastNuts3Cache[code];
};

const oblastNuts3Cache: Record<string, string> = (() => {
  // Lazily filled on first use from src/data/json/regions.json so we don't
  // have to duplicate the mapping here.
  const out: Record<string, string> = {};
  try {
    const raw = fs.readFileSync(
      path.resolve(__dirname, "../../src/data/json/regions.json"),
      "utf-8",
    );
    const arr = JSON.parse(raw) as { oblast: string; nuts3: string }[];
    for (const r of arr) {
      // Skip CIK-only synthetic codes (S23, S24, S25, PDV-00, "32") — those
      // don't correspond to NSI oblasts.
      if (!isOblastCode(r.oblast)) continue;
      out[r.oblast] = r.nuts3;
    }
  } catch {
    // Falls through with empty mapping; nuts3 will be undefined on rows.
  }
  void regionCodes;
  return out;
})();

// Bulgarian names for obshtinas, resolved from public/municipalities.json.
// NSI's English XLSX has only Latin names; we look up the Cyrillic form by
// the obshtina code so the demographics UI can show "Столична община",
// "Стара Загора" etc. instead of the Latin transliteration. SOF46 is not in
// public/municipalities.json (it's a single-obshtina oblast handled at the
// oblast level) so we hardcode that one.
const muniBgNames: Record<string, string> = (() => {
  const out: Record<string, string> = { SOF46: "Столична община" };
  try {
    const raw = fs.readFileSync(
      path.resolve(__dirname, "../../public/municipalities.json"),
      "utf-8",
    );
    const arr = JSON.parse(raw) as { obshtina: string; name: string }[];
    for (const m of arr) {
      if (m.obshtina && m.name && !out[m.obshtina]) out[m.obshtina] = m.name;
    }
  } catch {
    // Leave the hardcoded fallback in place if the file isn't available.
  }
  return out;
})();

// Build raw oblast/municipality population frames from the Population sheet.
// Population_EN sheet "1" has 5-year age bands columns 3..23 followed by
// male/female mirror blocks. The header row (row 5, index 4) lists age bands.
const parsePopulationSheet = () => {
  const rows = readSheet(FILE_POP, "1");
  // Locate header row by finding the row whose 3rd column is "Total".
  let ageHeaderIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (
      typeof rows[i][2] === "string" &&
      String(rows[i][2]).trim() === "Total" &&
      typeof rows[i][3] === "string" &&
      String(rows[i][3]).match(/^\d/)
    ) {
      ageHeaderIdx = i;
      break;
    }
  }
  if (ageHeaderIdx === -1)
    throw new Error("Could not locate age header row in Population sheet");

  // Layout: cols 0..1 are code/name. Each Total/Male/Female block is then
  // a "Total" subheader followed by 18 5-year age bands (0-4 .. 85+), so each
  // block is 19 cols wide (col 2..20 Total, col 21..39 Male, col 40..58 Female).
  const blockSize = 19;
  // Age-band labels live in cols 3..20 of the header row.
  const ageBands = rows[ageHeaderIdx].slice(3, 3 + (blockSize - 1)) as string[];

  const colsForRange = (lo: number, hi: number): number[] => {
    const out: number[] = [];
    for (let i = 0; i < ageBands.length; i++) {
      const band = String(ageBands[i] ?? "");
      const m = band.match(/^(\d+)\s*-\s*(\d+)$/);
      const open = band.match(/^(\d+)\s*\+/);
      let bandLo = -1;
      let bandHi = -1;
      if (m) {
        bandLo = Number(m[1]);
        bandHi = Number(m[2]);
      } else if (open) {
        bandLo = Number(open[1]);
        bandHi = 200;
      }
      if (bandLo >= lo && bandHi <= hi) out.push(3 + i);
    }
    return out;
  };
  const cols0_14 = colsForRange(0, 14);
  const cols15_29 = colsForRange(15, 29);
  const cols30_44 = colsForRange(30, 44);
  const cols45_64 = colsForRange(45, 64);
  const cols65plus = colsForRange(65, 200);

  type Pop = {
    code: string;
    name: string;
    population: number;
    age: CensusAge;
    gender: CensusGender;
  };
  type SettlementPop = Pop & {
    ekatte: string;
    obshtina: string;
    oblast: string;
  };
  const out = new Map<string, Pop>();
  const settlements: SettlementPop[] = [];
  let currentOblast: string | undefined;
  let currentMuni: string | undefined;

  const isSettlementCode = (c: string) => /^\d{5}$/.test(c);

  for (let i = ageHeaderIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const code = row[0];
    if (typeof code !== "string") continue;
    const trimmed = code.trim();
    if (!trimmed || isNutsRollupRow(trimmed)) continue;

    // Track oblast/municipality context as we walk the hierarchical rows so
    // we can attach the right parent codes to settlement entries.
    if (isOblastCode(trimmed)) currentOblast = trimmed;
    else if (isMunicipalityCode(trimmed)) currentMuni = trimmed;

    const isAccepted =
      isCountryRow(trimmed) ||
      isOblastCode(trimmed) ||
      isMunicipalityCode(trimmed) ||
      isSettlementCode(trimmed);
    if (!isAccepted) continue;

    const name = String(row[1] ?? "").trim();
    const total = num(row[2]);
    const sumCols = (cols: number[]) =>
      cols.reduce((a, c) => a + num(row[c]), 0);
    const age: CensusAge = {
      age0_14: sumCols(cols0_14),
      age15_29: sumCols(cols15_29),
      age30_44: sumCols(cols30_44),
      age45_64: sumCols(cols45_64),
      age65plus: sumCols(cols65plus),
    };
    // Each block starts with its own "Total" cell at col 2 + blockSize*N.
    const maleTotalCol = 2 + blockSize;
    const femaleTotalCol = 2 + blockSize * 2;
    const gender: CensusGender = {
      male: num(row[maleTotalCol]),
      female: num(row[femaleTotalCol]),
    };
    if (isSettlementCode(trimmed)) {
      if (!currentOblast || !currentMuni) continue;
      settlements.push({
        code: trimmed,
        name,
        population: total,
        age,
        gender,
        ekatte: trimmed,
        obshtina: currentMuni,
        oblast: currentOblast,
      });
    } else {
      out.set(trimmed, {
        code: trimmed,
        name,
        population: total,
        age,
        gender,
      });
    }
  }
  return { entities: out, settlements };
};

const parseSimpleSheet = <T>(
  file: string,
  sheetName: string,
  // (cells starting at col 2, where col 2 is "Total")
  pickFn: (totalCell: number, row: Row) => T,
): Map<string, T> => {
  const rows = readSheet(file, sheetName);
  // Find the data start: a row whose col 0 is "BG".
  let dataStart = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] === "BG") {
      dataStart = i;
      break;
    }
  }
  if (dataStart === -1)
    throw new Error(`Could not find BG data row in ${file} / ${sheetName}`);

  const out = new Map<string, T>();
  for (let i = dataStart; i < rows.length; i++) {
    const row = rows[i];
    const code = row[0];
    if (typeof code !== "string") continue;
    const trimmed = code.trim();
    if (
      !trimmed ||
      isNutsRollupRow(trimmed) ||
      (!isCountryRow(trimmed) &&
        !isOblastCode(trimmed) &&
        !isMunicipalityCode(trimmed))
    ) {
      continue;
    }
    out.set(trimmed, pickFn(num(row[2]), row));
  }
  return out;
};

// Ethnocultural Sheet 2: ethnic group. Cols: Total, Bulgarian, Turkish, Roma,
// Other, CantDetermine, DontWantAnswer, Unknown.
const parseEthnic = () =>
  parseSimpleSheet<CensusEthnic>(
    FILE_ETHNO,
    "2",
    (_total, row): CensusEthnic => ({
      bulgarian: num(row[3]),
      turkish: num(row[4]),
      roma: num(row[5]),
      other: num(row[6]),
      cantDetermine: num(row[7]),
      dontWantAnswer: num(row[8]),
      unknown: num(row[9]),
    }),
  );

// Ethnocultural Sheet 3: mother tongue. Same column layout as ethnic.
const parseMotherTongue = () =>
  parseSimpleSheet<CensusEthnic>(
    FILE_ETHNO,
    "3",
    (_total, row): CensusEthnic => ({
      bulgarian: num(row[3]),
      turkish: num(row[4]),
      roma: num(row[5]),
      other: num(row[6]),
      cantDetermine: num(row[7]),
      dontWantAnswer: num(row[8]),
      unknown: num(row[9]),
    }),
  );

// Ethnocultural Sheet 4: religion. Cols: Total, Christian, Muslim, Jewish,
// Other, NoReligion, CantDetermine, DontWantAnswer, Unknown.
const parseReligion = () =>
  parseSimpleSheet<CensusReligion>(
    FILE_ETHNO,
    "4",
    (_total, row): CensusReligion => ({
      christian: num(row[3]),
      muslim: num(row[4]),
      jewish: num(row[5]),
      other: num(row[6]),
      noReligion: num(row[7]),
      cantDetermine: num(row[8]),
      dontWantAnswer: num(row[9]),
      unknown: num(row[10]),
    }),
  );

// Economic Sheet 1: education (population 7+). Cols: Total, Tertiary,
// UpperSecondary, LowerSecondary, PrimaryOrLower, PreSchool.
const parseEducation = () =>
  parseSimpleSheet<CensusEducation>(
    FILE_ECON,
    "1",
    (_total, row): CensusEducation => ({
      tertiary: num(row[3]),
      upperSecondary: num(row[4]),
      lowerSecondary: num(row[5]),
      primaryOrLower: num(row[6]),
      preSchool: num(row[7]),
    }),
  );

// Economic Sheet 5: employment percentages. Cols: Total activity rate, Male,
// Female; Total employment rate, Male, Female; Total unemployment rate, ...
const parseEmployment = () =>
  parseSimpleSheet<CensusEmployment>(
    FILE_ECON,
    "5",
    (_total, row): CensusEmployment => ({
      activityRate: num(row[2]),
      employmentRate: num(row[5]),
      unemploymentRate: num(row[8]),
    }),
  );

type ParsedPop = {
  code: string;
  name: string;
  population: number;
  age: CensusAge;
  gender: CensusGender;
};

const buildEntity = (
  code: string,
  nameEn: string,
  nameBg: string,
  pop: ParsedPop,
  ethnic: CensusEthnic | undefined,
  motherTongue: CensusEthnic | undefined,
  religion: CensusReligion | undefined,
  education: CensusEducation | undefined,
  employment: CensusEmployment | undefined,
): CensusEntity => ({
  code,
  nameBg,
  nameEn,
  population: pop.population,
  age: pop.age,
  gender: pop.gender,
  ethnic,
  motherTongue,
  religion,
  education,
  employment,
});

const main = () => {
  if (!fs.existsSync(RAW_DIR)) {
    throw new Error(
      `${RAW_DIR} does not exist. Drop the NSI Census 2021 XLSX files into raw_data/census_2021/.`,
    );
  }
  for (const f of [FILE_POP, FILE_ETHNO, FILE_ECON]) {
    if (!fs.existsSync(path.resolve(RAW_DIR, f))) {
      throw new Error(`Missing required file: ${f} in ${RAW_DIR}`);
    }
  }
  const { entities: pop, settlements: settlementPop } = parsePopulationSheet();
  const ethnic = parseEthnic();
  const motherTongue = parseMotherTongue();
  const religion = parseReligion();
  const education = parseEducation();
  const employment = parseEmployment();

  const countryPop = pop.get("BG");
  if (!countryPop) throw new Error("Missing country (BG) row in Population.");

  const country: CensusEntity = buildEntity(
    "BG",
    "Bulgaria",
    "България",
    countryPop,
    ethnic.get("BG"),
    motherTongue.get("BG"),
    religion.get("BG"),
    education.get("BG"),
    employment.get("BG"),
  );

  const oblasts: CensusOblastEntity[] = [];
  const munis: CensusMunicipalityEntity[] = [];

  for (const [code, p] of pop.entries()) {
    if (isOblastCode(code)) {
      oblasts.push({
        ...buildEntity(
          code,
          p.name,
          oblastBgNames[code] ?? p.name,
          p,
          ethnic.get(code),
          motherTongue.get(code),
          religion.get(code),
          education.get(code),
          employment.get(code),
        ),
        nuts3: oblastNuts3FromCode(code),
      });
    } else if (isMunicipalityCode(code)) {
      munis.push({
        ...buildEntity(
          code,
          p.name,
          muniBgNames[code] ?? p.name,
          p,
          ethnic.get(code),
          motherTongue.get(code),
          religion.get(code),
          education.get(code),
          employment.get(code),
        ),
        oblast: code.slice(0, 3),
      });
    }
  }

  oblasts.sort((a, b) => a.code.localeCompare(b.code));
  munis.sort((a, b) => a.code.localeCompare(b.code));

  const settlements = settlementPop
    .map((s) => ({
      ekatte: s.ekatte,
      obshtina: s.obshtina,
      oblast: s.oblast,
      nameEn: s.name,
      // Bulgarian names live in public/settlements.json keyed by ekatte and
      // are joined client-side; the Census XLSX is English-only.
      nameBg: s.name,
      population: s.population,
      age: s.age,
      gender: s.gender,
    }))
    .sort((a, b) => a.ekatte.localeCompare(b.ekatte));

  // Settlements are split into a sidecar file so the Demographics screen
  // and per-region/per-obshtina tiles can render without paying for ~5k
  // settlement rows up-front. The settlement-level UI loads the sidecar on
  // demand via useCensusSettlements().
  const payload: Omit<CensusPayload, "settlements"> = {
    source: "NSI Census 2021",
    sourceUrl: "https://census2021.bg/",
    generatedAt: new Date().toISOString(),
    censusDate: "2021-09-07",
    country,
    oblasts,
    municipalities: munis,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2));
  fs.writeFileSync(OUT_SETTLEMENTS, JSON.stringify(settlements, null, 2));
  console.log(
    `Wrote ${OUT_FILE}: country + ${oblasts.length} oblasts + ${munis.length} municipalities`,
  );
  console.log(`Wrote ${OUT_SETTLEMENTS}: ${settlements.length} settlements`);
};

main();
