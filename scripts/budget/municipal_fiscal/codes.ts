// МФ/ЕБК municipality code → canonical obshtina code.
//
// The „Финансови показатели за общините" workbook (ЗПФ чл. 130г ал. 2) keys its
// 265 rows on the МФ/ЕБК municipal code (col A: `5101` Банско … `7805`), not on
// the `RSE27`-style obshtina code the rest of the repo uses. This module is the
// bridge, and it is deliberately a COMMITTED table rather than a runtime match:
// the roster below travels with the code, so the crosswalk is gateable without
// the gitignored workbook, and a workbook that adds or drops a município is
// detectable instead of silently changing coverage.
//
// **A NAME MATCH ALONE IS WRONG.** Measured against the real workbook it
// mis-assigns 7 of 265, in two classes, both silent:
//
//   - Sofia's районни administrations share names with real municipalities —
//     `Средец` is both BGS06 and the Sofia district S2401, `Искър` is both
//     PVN23 and S2414. Picking the district puts a Burgas or Pleven
//     município's liabilities on a Sofia district page.
//   - `Бяла` is TWO different municipalities (VAR05 in Varna oblast, RSE04 in
//     Ruse oblast). A name cannot separate them at all.
//
// What resolves BOTH classes is one mechanism: the МФ code's first two digits
// encode the OBLAST. 27 prefixes over the 265 rows, a clean bijection, so the
// key is (prefix → oblast, folded name). Sofia's districts carry oblast
// `S23`/`S24`/`S25` while `Средец` is `BGS` and `Искър` is `PVN`, so those keys
// never collide — the prefix closes the district class exactly as it closes
// `Бяла`.
//
// `buildNameIndex` ALSO filters Sofia districts out of the candidate set, and
// that filter is deliberately redundant: mutation-tested 2026-08-12, removing it
// changes 0 of 265 answers and introduces 0 ambiguous keys. It is kept as
// defence-in-depth against `municipalities.json` ever restating district
// `oblast` values as `SOF`. Do not read it as the thing that makes `Средец`
// work — that is the prefix, and confusing the two is how the load-bearing half
// gets removed by someone tidying up.
//
// Verified 2026-08-11: 264/265 resolve by rule; the remainder is one genuine
// name difference (`Добричка` = `Добрич-селска`) carried as an explicit alias.
// `Бяла` splits correctly to VAR05/RSE04, `Средец` → BGS06, `Искър` → PVN23.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Sofia city has no obshtina row in `data/municipalities.json` — that file
 *  carries only its 24 S2xxx districts — so МФ 7200 maps to the repo's
 *  established synthetic code `SOF00` (there is a live `/governance/SOF00`
 *  route).
 *
 *  `place_dim` is the exception worth knowing: it DOES carry a city-wide row,
 *  keyed `code = 'SFO_CITY'` with `governance_code = 'SOF00'` (117_place_dim.sql,
 *  load_place_dim_pg.ts). So a `place_dim` join for Sofia must be on
 *  **`governance_code`, not `code`** — which also means the label comes for free
 *  and nothing downstream needs to hand-label the city. */
export const SOFIA_MF_CODE = 7200;
export const SOFIA_OBSHTINA = "SOF00";

/** МФ code prefix (first two digits) → oblast code. A clean bijection over the
 *  265-row roster; `codes.test.ts` asserts it stays one, which is what catches
 *  МФ renumbering an oblast (that would otherwise silently re-assign a whole
 *  region). */
export const MF_PREFIX_TO_OBLAST: Readonly<Record<string, string>> = {
  "51": "BLG",
  "52": "BGS",
  "53": "VAR",
  "54": "VTR",
  "55": "VID",
  "56": "VRC",
  "57": "GAB",
  "58": "DOB",
  "59": "KRZ",
  "60": "KNL",
  "61": "LOV",
  "62": "MON",
  "63": "PAZ",
  "64": "PER",
  "65": "PVN",
  "66": "PDV",
  "67": "RAZ",
  "68": "RSE",
  "69": "SLS",
  "70": "SLV",
  "71": "SML",
  "72": "SOF",
  "73": "SFO",
  "74": "SZR",
  "75": "TGV",
  "76": "HKV",
  "77": "SHU",
  "78": "JAM",
};

/** Folded-name aliases, applied after `foldMuniName`. Exactly one entry, and it
 *  should stay that way: a fuzzy fallback here would silently re-open the
 *  collisions the oblast prefix just closed.
 *
 *  @see scripts/local_taxes/lib/match_obshtina.ts — a second município-name
 *  resolver that independently hit the same exceptions (`Столична община`,
 *  `Добричка`, `Вълчидол`, `Бяла`). If you are adding an alias here, check
 *  whether it belongs there too. Consolidation should run TOWARD this module:
 *  keying on the МФ oblast prefix is strictly stronger than matching an oblast
 *  NAME, and `foldMuniName`'s lowercasing subsumes that module's case-only
 *  aliases outright. */
export const NAME_ALIASES: Readonly<Record<string, string>> = {
  // МФ writes „Добричка"; municipalities.json has „Добрич-селска" (DOB15).
  добричка: "добричселска",
};

export interface MuniRef {
  obshtina: string;
  name: string;
  oblast: string;
}

/** Collapse whitespace and every dash variant ENTIRELY, not merely normalise
 *  them: МФ writes „Вълчидол" where municipalities.json has „Вълчи дол".
 *
 *  Two things about this character class are load-bearing. The `U+2010..U+2015`
 *  range goes **first**, because with `\s` ahead of it the following `-` is
 *  consumed as a pseudo-range separator and the real range is destroyed — that
 *  shipped once, silently leaving en dash, em dash, non-breaking hyphen and
 *  figure dash unfolded. And the **`u` flag** is what makes that class of bug
 *  loud: under `u` a malformed class is a `SyntaxError` rather than a silent
 *  reinterpretation. `U+00AD` (soft hyphen) is included because the input is an
 *  Office workbook. */
export const foldMuniName = (s: string): string =>
  s
    .normalize("NFC")
    .trim()
    .toLowerCase()
    .replace(/[‐-―\s\-­−]+/gu, "");

/** Sofia's районни administrations, which must never be a crosswalk target. */
export const isSofiaRayonObshtina = (obshtina: string): boolean =>
  /^S2\d{3}$/.test(obshtina);

/** Own-property check. `Object.hasOwn` would read better but needs lib es2022,
 *  which this project does not target. */
const hasOwn = (o: object, k: string): boolean =>
  Object.prototype.hasOwnProperty.call(o, k);

/** `municipalities.json` carries `PDV-00` alongside `PDV` — a known
 *  inconsistency in that file, not a crosswalk failure. Compare on the stem. */
const oblastStem = (oblast: string): string => oblast.split("-")[0];

/** Out-of-country pseudo-obshtini (`oblast: "32"` — Европа, Азия, Африка,
 *  Океания, Северна/Южна Америка). Never a crosswalk target; excluded so a
 *  coverage gate's denominator is the 264 REAL municipalities rather than
 *  `municipalities.json`'s 294 rows. Mirrors `SKIP_OBLAST` in
 *  `scripts/officials/municipality_join.ts`. */
export const ABROAD_OBLAST = "32";

export const loadMunicipalities = (): MuniRef[] => {
  const rows = JSON.parse(
    readFileSync(
      resolve(__dirname, "../../../data/municipalities.json"),
      "utf8",
    ),
  ) as MuniRef[];
  // `data/municipalities.json` is a moving input (it has been proposed to widen
  // it toward settlements). Without this the failure is still loud — a widened
  // file collides names within an oblast and buildCrosswalk throws — but it
  // reports "unresolved municipalities" and points at the wrong cause.
  if (
    !Array.isArray(rows) ||
    !rows.every((r) => r?.obshtina && r?.name && r?.oblast)
  ) {
    throw new Error(
      "data/municipalities.json: expected [{ obshtina, name, oblast }] — shape changed",
    );
  }
  return rows;
};

/** (oblast, folded name) → obshtina. Sofia districts and the out-of-country
 *  pseudo-rows are both excluded; see the header on why the district filter is
 *  redundant-but-kept. */
export const buildNameIndex = (munis: MuniRef[]): Map<string, string[]> => {
  const idx = new Map<string, string[]>();
  for (const m of munis) {
    if (isSofiaRayonObshtina(m.obshtina)) continue;
    if (m.oblast === ABROAD_OBLAST) continue;
    const key = `${oblastStem(m.oblast)}|${foldMuniName(m.name)}`;
    const hit = idx.get(key);
    if (hit) hit.push(m.obshtina);
    else idx.set(key, [m.obshtina]);
  }
  return idx;
};

export type ResolveFailure =
  | "malformed-code"
  | "unknown-prefix"
  | "no-match"
  | "ambiguous";

export interface ResolveResult {
  obshtina: string | null;
  reason?: ResolveFailure;
  candidates?: string[];
}

/** Resolve one МФ row. Returns `{ obshtina: null, reason }` rather than
 *  throwing, so the caller can report every failure in one pass instead of
 *  dying on the first. */
export const resolveMfCode = (
  mf: number,
  nameBg: string,
  index: Map<string, string[]>,
): ResolveResult => {
  if (mf === SOFIA_MF_CODE) return { obshtina: SOFIA_OBSHTINA };
  const code = String(mf);
  // МФ codes are 4-digit throughout (5101..7805). Without this guard a 3- or
  // 5-digit code BORROWS a valid prefix and resolves to a real município with
  // no failure recorded: `510` and `51011` both returned BLG01. The parser
  // reads col A of a spreadsheet, where a stripped leading zero, a merged-cell
  // artefact or an off-by-one column read all produce exactly that shape.
  if (!/^\d{4}$/.test(code))
    return { obshtina: null, reason: "malformed-code" };
  const oblast = hasOwn(MF_PREFIX_TO_OBLAST, code.slice(0, 2))
    ? MF_PREFIX_TO_OBLAST[code.slice(0, 2)]
    : undefined;
  if (!oblast) return { obshtina: null, reason: "unknown-prefix" };
  const folded = foldMuniName(nameBg);
  // An own-property check, not `??`: a folded name of `constructor` would
  // otherwise read an inherited value off the prototype rather than missing.
  const aliased = hasOwn(NAME_ALIASES, folded) ? NAME_ALIASES[folded] : folded;
  const hit = index.get(`${oblast}|${aliased}`) ?? [];
  if (hit.length === 1) return { obshtina: hit[0] };
  if (hit.length === 0) return { obshtina: null, reason: "no-match" };
  return { obshtina: null, reason: "ambiguous", candidates: hit };
};

/** The committed 265-row МФ roster, as published in the „показатели" sheet
 *  (col A + col B). Its purpose is threefold: it makes the crosswalk gateable
 *  without the gitignored workbook; it lets the parser detect МФ adding or
 *  dropping a município (a coverage change that would otherwise pass as an
 *  ordinary row-count move — see `diffRoster`); and it pins the spelling each
 *  alias is written against.
 *
 *  **Provenance.** Minted 2026-08-12 from
 *  `data/_cache/minfin_municipal_fiscal/1. quarterly-reports-Q32024-Q42024-Q32025-website.xlsx`,
 *  sheet „показатели", rows 3–274, cols A (`mf`) and B (`nameBg`). Regenerate
 *  only from a real workbook and update this stamp — a roster whose vintage is
 *  unknown cannot be told apart from a stale one. */
export interface MfRosterEntry {
  mf: number;
  nameBg: string;
}

export const MF_ROSTER: readonly MfRosterEntry[] = [
  { mf: 5101, nameBg: "Банско" },
  { mf: 5102, nameBg: "Белица" },
  { mf: 5103, nameBg: "Благоевград" },
  { mf: 5104, nameBg: "Гоце Делчев" },
  { mf: 5105, nameBg: "Гърмен" },
  { mf: 5106, nameBg: "Кресна" },
  { mf: 5107, nameBg: "Петрич" },
  { mf: 5108, nameBg: "Разлог" },
  { mf: 5109, nameBg: "Сандански" },
  { mf: 5110, nameBg: "Сатовча" },
  { mf: 5111, nameBg: "Симитли" },
  { mf: 5112, nameBg: "Струмяни" },
  { mf: 5113, nameBg: "Хаджидимово" },
  { mf: 5114, nameBg: "Якоруда" },
  { mf: 5201, nameBg: "Айтос" },
  { mf: 5202, nameBg: "Бургас" },
  { mf: 5203, nameBg: "Камено" },
  { mf: 5204, nameBg: "Карнобат" },
  { mf: 5205, nameBg: "Малко Търново" },
  { mf: 5206, nameBg: "Несебър" },
  { mf: 5207, nameBg: "Поморие" },
  { mf: 5208, nameBg: "Приморско" },
  { mf: 5209, nameBg: "Руен" },
  { mf: 5210, nameBg: "Созопол" },
  { mf: 5211, nameBg: "Средец" },
  { mf: 5212, nameBg: "Сунгурларе" },
  { mf: 5213, nameBg: "Царево" },
  { mf: 5301, nameBg: "Аврен" },
  { mf: 5302, nameBg: "Аксаково" },
  { mf: 5303, nameBg: "Белослав" },
  { mf: 5304, nameBg: "Бяла" },
  { mf: 5305, nameBg: "Варна" },
  { mf: 5306, nameBg: "Ветрино" },
  { mf: 5307, nameBg: "Вълчидол" },
  { mf: 5308, nameBg: "Девня" },
  { mf: 5309, nameBg: "Долни Чифлик" },
  { mf: 5310, nameBg: "Дългопол" },
  { mf: 5311, nameBg: "Провадия" },
  { mf: 5312, nameBg: "Суворово" },
  { mf: 5401, nameBg: "Велико Търново" },
  { mf: 5402, nameBg: "Горна Оряховица" },
  { mf: 5403, nameBg: "Елена" },
  { mf: 5404, nameBg: "Златарица" },
  { mf: 5405, nameBg: "Лясковец" },
  { mf: 5406, nameBg: "Павликени" },
  { mf: 5407, nameBg: "Полски Тръмбеш" },
  { mf: 5408, nameBg: "Свищов" },
  { mf: 5409, nameBg: "Стражица" },
  { mf: 5410, nameBg: "Сухиндол" },
  { mf: 5501, nameBg: "Белоградчик" },
  { mf: 5502, nameBg: "Бойница" },
  { mf: 5503, nameBg: "Брегово" },
  { mf: 5504, nameBg: "Видин" },
  { mf: 5505, nameBg: "Грамада" },
  { mf: 5506, nameBg: "Димово" },
  { mf: 5507, nameBg: "Кула" },
  { mf: 5508, nameBg: "Макреш" },
  { mf: 5509, nameBg: "Ново село" },
  { mf: 5510, nameBg: "Ружинци" },
  { mf: 5511, nameBg: "Чупрене" },
  { mf: 5601, nameBg: "Борован" },
  { mf: 5602, nameBg: "Бяла Слатина" },
  { mf: 5603, nameBg: "Враца" },
  // 5604 is unused by МФ — NOT a dropped row. Враца oblast has 10 municipalities
  // in data/municipalities.json and all 10 are present here (5601-5603,
  // 5605-5611). Verified 2026-08-12; leave the gap alone.
  { mf: 5605, nameBg: "Козлодуй" },
  { mf: 5606, nameBg: "Криводол" },
  { mf: 5607, nameBg: "Мездра" },
  { mf: 5608, nameBg: "Мизия" },
  { mf: 5609, nameBg: "Оряхово" },
  { mf: 5610, nameBg: "Роман" },
  { mf: 5611, nameBg: "Хайредин" },
  { mf: 5701, nameBg: "Габрово" },
  { mf: 5702, nameBg: "Дряново" },
  { mf: 5703, nameBg: "Севлиево" },
  { mf: 5704, nameBg: "Трявна" },
  { mf: 5801, nameBg: "Балчик" },
  { mf: 5802, nameBg: "Генерал Тошево" },
  { mf: 5803, nameBg: "Добрич" },
  { mf: 5804, nameBg: "Добричка" },
  { mf: 5805, nameBg: "Каварна" },
  { mf: 5806, nameBg: "Крушари" },
  { mf: 5807, nameBg: "Тервел" },
  { mf: 5808, nameBg: "Шабла" },
  { mf: 5901, nameBg: "Ардино" },
  { mf: 5902, nameBg: "Джебел" },
  { mf: 5903, nameBg: "Кирково" },
  { mf: 5904, nameBg: "Крумовград" },
  { mf: 5905, nameBg: "Кърджали" },
  { mf: 5906, nameBg: "Момчилград" },
  { mf: 5907, nameBg: "Черноочене" },
  { mf: 6001, nameBg: "Бобов дол" },
  { mf: 6002, nameBg: "Бобошево" },
  { mf: 6003, nameBg: "Дупница" },
  { mf: 6004, nameBg: "Кочериново" },
  { mf: 6005, nameBg: "Кюстендил" },
  { mf: 6006, nameBg: "Невестино" },
  { mf: 6007, nameBg: "Рила" },
  { mf: 6008, nameBg: "Сапарева баня" },
  { mf: 6009, nameBg: "Трекляно" },
  { mf: 6101, nameBg: "Априлци" },
  { mf: 6102, nameBg: "Летница" },
  { mf: 6103, nameBg: "Ловеч" },
  { mf: 6104, nameBg: "Луковит" },
  { mf: 6105, nameBg: "Тетевен" },
  { mf: 6106, nameBg: "Троян" },
  { mf: 6107, nameBg: "Угърчин" },
  { mf: 6108, nameBg: "Ябланица" },
  { mf: 6201, nameBg: "Берковица" },
  { mf: 6202, nameBg: "Бойчиновци" },
  { mf: 6203, nameBg: "Брусарци" },
  { mf: 6204, nameBg: "Вълчедръм" },
  { mf: 6205, nameBg: "Вършец" },
  { mf: 6206, nameBg: "Георги Дамяново" },
  { mf: 6207, nameBg: "Лом" },
  { mf: 6208, nameBg: "Медковец" },
  { mf: 6209, nameBg: "Монтана" },
  { mf: 6210, nameBg: "Чипровци" },
  { mf: 6211, nameBg: "Якимово" },
  { mf: 6301, nameBg: "Батак" },
  { mf: 6302, nameBg: "Белово" },
  { mf: 6303, nameBg: "Брацигово" },
  { mf: 6304, nameBg: "Велинград" },
  { mf: 6305, nameBg: "Лесичово" },
  { mf: 6306, nameBg: "Пазарджик" },
  { mf: 6307, nameBg: "Панагюрище" },
  { mf: 6308, nameBg: "Пещера" },
  { mf: 6309, nameBg: "Ракитово" },
  { mf: 6310, nameBg: "Септември" },
  { mf: 6311, nameBg: "Стрелча" },
  { mf: 6312, nameBg: "Сърница" },
  { mf: 6401, nameBg: "Брезник" },
  { mf: 6402, nameBg: "Земен" },
  { mf: 6403, nameBg: "Ковачевци" },
  { mf: 6404, nameBg: "Перник" },
  { mf: 6405, nameBg: "Радомир" },
  { mf: 6406, nameBg: "Трън" },
  { mf: 6501, nameBg: "Белене" },
  { mf: 6502, nameBg: "Гулянци" },
  { mf: 6503, nameBg: "Долна Митрополия" },
  { mf: 6504, nameBg: "Долни Дъбник" },
  { mf: 6505, nameBg: "Искър" },
  { mf: 6506, nameBg: "Левски" },
  { mf: 6507, nameBg: "Никопол" },
  { mf: 6508, nameBg: "Плевен" },
  { mf: 6509, nameBg: "Пордим" },
  { mf: 6510, nameBg: "Червен бряг" },
  { mf: 6511, nameBg: "Кнежа" },
  { mf: 6601, nameBg: "Асеновград" },
  { mf: 6602, nameBg: "Брезово" },
  { mf: 6603, nameBg: "Калояново" },
  { mf: 6604, nameBg: "Карлово" },
  { mf: 6605, nameBg: "Кричим" },
  { mf: 6606, nameBg: "Лъки" },
  { mf: 6607, nameBg: "Марица" },
  { mf: 6608, nameBg: "Перущица" },
  { mf: 6609, nameBg: "Пловдив" },
  { mf: 6610, nameBg: "Първомай" },
  { mf: 6611, nameBg: "Раковски" },
  { mf: 6612, nameBg: "Родопи" },
  { mf: 6613, nameBg: "Садово" },
  { mf: 6614, nameBg: "Стамболийски" },
  { mf: 6615, nameBg: "Съединение" },
  { mf: 6616, nameBg: "Хисаря" },
  { mf: 6617, nameBg: "Куклен" },
  { mf: 6618, nameBg: "Сопот" },
  { mf: 6701, nameBg: "Завет" },
  { mf: 6702, nameBg: "Исперих" },
  { mf: 6703, nameBg: "Кубрат" },
  { mf: 6704, nameBg: "Лозница" },
  { mf: 6705, nameBg: "Разград" },
  { mf: 6706, nameBg: "Самуил" },
  { mf: 6707, nameBg: "Цар Калоян" },
  { mf: 6801, nameBg: "Борово" },
  { mf: 6802, nameBg: "Бяла" },
  { mf: 6803, nameBg: "Ветово" },
  { mf: 6804, nameBg: "Две могили" },
  { mf: 6805, nameBg: "Иваново" },
  { mf: 6806, nameBg: "Русе" },
  { mf: 6807, nameBg: "Сливо поле" },
  { mf: 6808, nameBg: "Ценово" },
  { mf: 6901, nameBg: "Алфатар" },
  { mf: 6902, nameBg: "Главиница" },
  { mf: 6903, nameBg: "Дулово" },
  { mf: 6904, nameBg: "Кайнарджа" },
  { mf: 6905, nameBg: "Силистра" },
  { mf: 6906, nameBg: "Ситово" },
  { mf: 6907, nameBg: "Тутракан" },
  { mf: 7001, nameBg: "Котел" },
  { mf: 7002, nameBg: "Нова Загора" },
  { mf: 7003, nameBg: "Сливен" },
  { mf: 7004, nameBg: "Твърдица" },
  { mf: 7101, nameBg: "Баните" },
  { mf: 7102, nameBg: "Борино" },
  { mf: 7103, nameBg: "Девин" },
  { mf: 7104, nameBg: "Доспат" },
  { mf: 7105, nameBg: "Златоград" },
  { mf: 7106, nameBg: "Мадан" },
  { mf: 7107, nameBg: "Неделино" },
  { mf: 7108, nameBg: "Рудозем" },
  { mf: 7109, nameBg: "Смолян" },
  { mf: 7110, nameBg: "Чепеларе" },
  { mf: 7200, nameBg: "Столична община" },
  { mf: 7301, nameBg: "Антон" },
  { mf: 7302, nameBg: "Божурище" },
  { mf: 7303, nameBg: "Ботевград" },
  { mf: 7304, nameBg: "Годеч" },
  { mf: 7305, nameBg: "Горна Малина" },
  { mf: 7306, nameBg: "Долна Баня" },
  { mf: 7307, nameBg: "Драгоман" },
  { mf: 7308, nameBg: "Елин Пелин" },
  { mf: 7309, nameBg: "Етрополе" },
  { mf: 7310, nameBg: "Златица" },
  { mf: 7311, nameBg: "Ихтиман" },
  { mf: 7312, nameBg: "Копривщица" },
  { mf: 7313, nameBg: "Костенец" },
  { mf: 7314, nameBg: "Костинброд" },
  { mf: 7315, nameBg: "Мирково" },
  { mf: 7316, nameBg: "Пирдоп" },
  { mf: 7317, nameBg: "Правец" },
  { mf: 7318, nameBg: "Самоков" },
  { mf: 7319, nameBg: "Своге" },
  { mf: 7320, nameBg: "Сливница" },
  { mf: 7321, nameBg: "Чавдар" },
  { mf: 7322, nameBg: "Челопеч" },
  { mf: 7401, nameBg: "Братя Даскалови" },
  { mf: 7402, nameBg: "Гурково" },
  { mf: 7403, nameBg: "Гълъбово" },
  { mf: 7404, nameBg: "Казанлък" },
  { mf: 7405, nameBg: "Мъглиж" },
  { mf: 7406, nameBg: "Николаево" },
  { mf: 7407, nameBg: "Опан" },
  { mf: 7408, nameBg: "Павел баня" },
  { mf: 7409, nameBg: "Раднево" },
  { mf: 7410, nameBg: "Стара Загора" },
  { mf: 7411, nameBg: "Чирпан" },
  { mf: 7501, nameBg: "Антоново" },
  { mf: 7502, nameBg: "Омуртаг" },
  { mf: 7503, nameBg: "Опака" },
  { mf: 7504, nameBg: "Попово" },
  { mf: 7505, nameBg: "Търговище" },
  { mf: 7601, nameBg: "Димитровград" },
  { mf: 7602, nameBg: "Ивайловград" },
  { mf: 7603, nameBg: "Любимец" },
  { mf: 7604, nameBg: "Маджарово" },
  { mf: 7605, nameBg: "Минерални Бани" },
  { mf: 7606, nameBg: "Свиленград" },
  { mf: 7607, nameBg: "Симеоновград" },
  { mf: 7608, nameBg: "Стамболово" },
  { mf: 7609, nameBg: "Тополовград" },
  { mf: 7610, nameBg: "Харманли" },
  { mf: 7611, nameBg: "Хасково" },
  { mf: 7701, nameBg: "Велики Преслав" },
  { mf: 7702, nameBg: "Венец" },
  { mf: 7703, nameBg: "Върбица" },
  { mf: 7704, nameBg: "Каолиново" },
  { mf: 7705, nameBg: "Каспичан" },
  { mf: 7706, nameBg: "Никола Козлево" },
  { mf: 7707, nameBg: "Нови пазар" },
  { mf: 7708, nameBg: "Смядово" },
  { mf: 7709, nameBg: "Хитрино" },
  { mf: 7710, nameBg: "Шумен" },
  { mf: 7801, nameBg: "Болярово" },
  { mf: 7802, nameBg: "Елхово" },
  { mf: 7803, nameBg: "Стралджа" },
  { mf: 7804, nameBg: "Тунджа" },
  { mf: 7805, nameBg: "Ямбол" },
];

/** Diff a parsed workbook's МФ codes against the committed roster. Returns the
 *  two directions SEPARATELY because they mean different things: `added` is МФ
 *  publishing a município we do not carry (the crosswalk will fail loudly on
 *  it), `dropped` is one vanishing from the workbook (which fails silently — the
 *  município simply stops appearing, and a row-count check reads the move as
 *  ordinary). This is the helper that makes committing `MF_ROSTER` pay off; the
 *  parser should call it rather than comparing lengths. */
export const diffRoster = (
  parsed: readonly number[],
): { added: number[]; dropped: number[] } => {
  const known = new Set(MF_ROSTER.map((r) => r.mf));
  const seen = new Set(parsed);
  return {
    added: [...seen].filter((mf) => !known.has(mf)).sort((a, b) => a - b),
    dropped: [...known].filter((mf) => !seen.has(mf)).sort((a, b) => a - b),
  };
};

/** mf → obshtina for the whole committed roster. Throws with every failure
 *  listed, because a partial crosswalk silently drops municipalities. */
export const buildCrosswalk = (
  munis: MuniRef[] = loadMunicipalities(),
): Map<number, string> => {
  const index = buildNameIndex(munis);
  const out = new Map<number, string>();
  const failures: string[] = [];
  for (const { mf, nameBg } of MF_ROSTER) {
    const r = resolveMfCode(mf, nameBg, index);
    if (r.obshtina) out.set(mf, r.obshtina);
    else
      failures.push(
        `${mf} ${nameBg} (${r.reason}${r.candidates ? ": " + r.candidates.join(", ") : ""})`,
      );
  }
  if (failures.length > 0) {
    throw new Error(
      `municipal_fiscal crosswalk: ${failures.length} of ${MF_ROSTER.length} unresolved:\n  ${failures.join("\n  ")}`,
    );
  }
  return out;
};
