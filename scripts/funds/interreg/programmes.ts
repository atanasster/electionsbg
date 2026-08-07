// The curated register of Interreg programmes we admit into the corpus.
//
// CURATED, NOT DERIVED — the same rule `src/data/funds/programmeNamesEn.ts`
// states for the ИСУН programme names, for the same reason. `programme_code` is
// a stable slug we own; the Bulgarian and English names are the forms МРРБ and
// the programme itself publish. Nothing here is machine-translated and nothing
// is inferred from a keep.eu title, because a title is a display string that can
// change under us while a code must not.
//
// THIS FILE IS THE ADMISSION GATE. `programmeFor()` returning undefined is how a
// keep.eu programme stays OUT of the corpus: the ingest skips it with a warning
// rather than minting an unnamed code from whatever keep.eu happens to call it.
// That matters because keep.eu carries 390 programmes, all but these 22 of which
// have no Bulgarian participation at all — an ingest that admitted a programme
// by inference would quietly pull in Interreg Aurora the first time somebody
// widened a regex.
//
// Sources for every row:
//   - roster + Bulgarian names: МРРБ's two index pages
//     https://www.mrrb.bg/bg/infrastruktura-i-programi/programi-za-teritorialno-sutrudnichestvo-2014-2020/
//     https://www.mrrb.bg/bg/infrastruktura-i-programi/programi-za-teritorialno-sutrudnichestvo-2021-2027/
//   - keep.eu programme id, CCI, English name and eligible area:
//     https://keep.eu/api/programme/<keepProgrammeId>/  (field `eligible_geographical_area`)
//   - coverage notes: https://keep.eu/api/partner/partner_coverage?detailed=true&excel=true
// Measured 2026-08-06. Data credit: keep.eu (INTERACT).
//
// Tier T0 of docs/plans/interreg-funds-ingest-v1.md §10. Expected siblings:
// keep_fetch.ts + measure.ts (T0), parse.ts + ingest.ts (T1), resolve_place.ts
// (T2, loader-side — it is the consumer of `isEligibleNuts` below).

import type { InterregPeriod, InterregProgramme } from "./types";

// ─── 2021-2027 ──────────────────────────────────────────────────────────────
// Land-border (CBC) programmes first, then transnational, then interregional.

const P_2021: InterregProgramme[] = [
  {
    keepProgrammeId: 342,
    code: "INTERREG-ROBG-2127",
    period: "2021-2027",
    nameBg: "ИНТЕРРЕГ VI-A Румъния - България 2021-2027",
    nameEn: "Interreg VI-A Romania-Bulgaria",
    cci: "2021TC16RFCB020",
    eligibleNuts: [
      "BG311", // Видин
      "BG312", // Монтана
      "BG313", // Враца
      "BG314", // Плевен
      "BG321", // Велико Търново
      "BG323", // Русе
      "BG325", // Силистра
      "BG332", // Добрич
    ],
  },
  {
    keepProgrammeId: 343,
    code: "INTERREG-GRBG-2127",
    period: "2021-2027",
    nameBg: "ИНТЕРРЕГ VI-A Гърция - България 2021-2027",
    nameEn: "Interreg VI-A Greece-Bulgaria",
    cci: "2021TC16RFCB021",
    eligibleNuts: ["BG413", "BG422", "BG424", "BG425"],
    // The thinnest arm we still admit: 10 of 26 partnerships present, and
    // BOTH the partner-budget and postcode fill rates are 0%. Operations and
    // partners ingest; money does not, and placement must come from the EIK.
    coverageNote:
      "38% of partnerships in keep.eu; 0% partner budget, 0% postcode. Money is unpublished; place via EIK only.",
  },
  {
    keepProgrammeId: 305,
    code: "INTERREG-BGTR-2127",
    period: "2021-2027",
    nameBg: "ИНТЕРРЕГ VI-A ИПП България - Турция 2021-2027",
    nameEn: "Interreg VI-A IPA Bulgaria-Türkiye",
    cci: "2021TC16IPCB005",
    eligibleNuts: ["BG341", "BG343", "BG422"],
    coverageNote: "111 of 151 partnerships in keep.eu; 40 absent.",
  },
  {
    keepProgrammeId: 306,
    code: "INTERREG-BGMK-2127",
    period: "2021-2027",
    nameBg: "ИНТЕРРЕГ VI-A ИПП България - Северна Македония 2021-2027",
    nameEn: "Interreg VI-A IPA Bulgaria-North Macedonia",
    cci: "2021TC16IPCB006",
    eligibleNuts: ["BG413", "BG415"],
  },
  {
    keepProgrammeId: 307,
    code: "INTERREG-BGRS-2127",
    period: "2021-2027",
    nameBg: "ИНТЕРРЕГ VI-A ИПП България - Сърбия 2021-2027",
    nameEn: "Interreg VI-A IPA Bulgaria-Serbia",
    cci: "2021TC16IPCB007",
    eligibleNuts: ["BG311", "BG312", "BG313", "BG412", "BG414", "BG415"],
    // Registered deliberately while EMPTY. 8 operations and 48 partnerships are
    // known to exist and keep.eu holds none of them, so this programme yields
    // zero rows today. Keeping the entry means the day keep.eu imports it we
    // pick it up automatically instead of silently skipping a whole border.
    coverageNote:
      "0 of 8 operations in keep.eu as of 2026-08-06. A named gap: registered so a later import is picked up, not skipped.",
  },
  {
    keepProgrammeId: 387,
    code: "INTERREG-BSB-2127",
    period: "2021-2027",
    nameBg: "ИНТЕРРЕГ NEXT Черноморски басейн 2021-2027",
    nameEn: "Interreg VI-B NEXT Black Sea Basin",
    cci: "2021TC16NXTN002",
    // NUTS2, not NUTS3 — this is why eligibility is a prefix test.
    eligibleNuts: ["BG33", "BG34"],
  },
  {
    keepProgrammeId: 369,
    code: "INTERREG-DANUBE-2127",
    period: "2021-2027",
    nameBg: "ИНТЕРРЕГ VI-Б Дунавски регион 2021-2027",
    nameEn: "Interreg VI-B Danube Region",
    cci: "2021TC16FFTN004",
    eligibleNuts: null,
  },
  {
    keepProgrammeId: 377,
    code: "INTERREG-EUROMED-2127",
    period: "2021-2027",
    nameBg: "ИНТЕРРЕГ VI-Б Евро-Средиземноморски басейн (EURO MED) 2021-2027",
    nameEn: "Interreg VI-B Euro-MED",
    cci: "2021TC16FFTN001",
    eligibleNuts: null,
  },
  {
    keepProgrammeId: 394,
    code: "INTERREG-EUROPE-2127",
    period: "2021-2027",
    nameBg: "ИНТЕРРЕГ VI-С Европа 2021-2027",
    nameEn: "Interreg VI-C Interreg Europe",
    cci: "2021TC16RFIR001",
    eligibleNuts: null,
  },
  {
    keepProgrammeId: 393,
    code: "INTERREG-URBACT-2127",
    period: "2021-2027",
    nameBg: "ИНТЕРРЕГ VI-С УРБАКТ IV 2021-2027",
    nameEn: "Interreg VI-C URBACT IV",
    cci: "2021TC16FFIR001",
    eligibleNuts: null,
    coverageNote:
      "30 of 2,081 partnerships in keep.eu (1%); 0% partner budget. A named gap.",
  },
  {
    keepProgrammeId: 395,
    code: "INTERREG-ESPON-2127",
    period: "2021-2027",
    nameBg: "ЕСПОН 2030",
    nameEn: "Interreg VI-C ESPON 2030",
    cci: "2021TC16RFIR004",
    eligibleNuts: null,
    coverageNote:
      "0 of 616 partnerships in keep.eu. Registered empty, like BG-RS 21-27.",
  },
];

// ─── 2014-2020 ──────────────────────────────────────────────────────────────
// No CCI: keep.eu carries none for this period.

const P_2014: InterregProgramme[] = [
  {
    keepProgrammeId: 35,
    code: "INTERREG-ROBG-1420",
    period: "2014-2020",
    nameBg: "ИНТЕРРЕГ V-A Румъния - България 2014-2020",
    nameEn: "INTERREG V-A Romania-Bulgaria",
    eligibleNuts: [
      "BG311",
      "BG312",
      "BG313",
      "BG314",
      "BG321",
      "BG323",
      "BG325",
      "BG332",
    ],
  },
  {
    keepProgrammeId: 10,
    code: "INTERREG-GRBG-1420",
    period: "2014-2020",
    nameBg: "ИНТЕРРЕГ V-A Гърция - България 2014-2020",
    nameEn: "INTERREG V-A Greece-Bulgaria",
    eligibleNuts: ["BG413", "BG422", "BG424", "BG425"],
  },
  {
    keepProgrammeId: 66,
    code: "INTERREG-BGTR-1420",
    period: "2014-2020",
    nameBg: "ИНТЕРРЕГ - ИПП България - Турция 2014-2020",
    nameEn: "Interreg IPA CBC Bulgaria-Turkey",
    eligibleNuts: ["BG341", "BG343", "BG422"],
  },
  {
    keepProgrammeId: 72,
    code: "INTERREG-BGRS-1420",
    period: "2014-2020",
    nameBg: "ИНТЕРРЕГ - ИПП България - Сърбия 2014-2020",
    nameEn: "Interreg IPA CBC Bulgaria-Serbia",
    eligibleNuts: ["BG311", "BG312", "BG313", "BG412", "BG414", "BG415"],
    coverageNote: "232 of 245 partnerships in keep.eu.",
  },
  {
    keepProgrammeId: 73,
    code: "INTERREG-BGMK-1420",
    period: "2014-2020",
    // keep.eu still titles this one "Former Yugoslav Republic of Macedonia",
    // the name in force when the programme ran. We publish the country's
    // current name, as МРРБ does; `keepTitle` carries the source's own string
    // so a registry-vs-keep.eu check reads this as a deliberate divergence
    // rather than as a wrong keepProgrammeId.
    nameBg: "ИНТЕРРЕГ - ИПП България - Северна Македония 2014-2020",
    nameEn: "Interreg IPA CBC Bulgaria-North Macedonia",
    keepTitle:
      "2014 - 2020 Interreg IPA CBC Bulgaria - Former Yugoslav Republic of Macedonia",
    eligibleNuts: ["BG413", "BG415"],
  },
  {
    keepProgrammeId: 64,
    code: "INTERREG-BSB-1420",
    period: "2014-2020",
    nameBg: "Черноморски басейн 2014-2020",
    nameEn: "Black Sea Basin ENI CBC",
    eligibleNuts: ["BG33", "BG34"],
    coverageNote: "74% partner-budget fill rate — the money gap here is real.",
  },
  {
    keepProgrammeId: 63,
    code: "INTERREG-DANUBE-1420",
    period: "2014-2020",
    nameBg: "„Дунав“ 2014-2020",
    nameEn: "INTERREG V-B Danube",
    eligibleNuts: null,
  },
  {
    keepProgrammeId: 125,
    code: "INTERREG-BALKANMED-1420",
    period: "2014-2020",
    nameBg: "„Балкани - Средиземно море“ 2014-2020",
    nameEn: "INTERREG V-B Balkan-Mediterranean",
    eligibleNuts: null,
  },
  {
    keepProgrammeId: 58,
    code: "INTERREG-EUROPE-1420",
    period: "2014-2020",
    nameBg: "ИНТЕРРЕГ ЕВРОПА 2014-2020",
    nameEn: "Interreg Europe",
    eligibleNuts: null,
  },
  {
    keepProgrammeId: 85,
    code: "INTERREG-URBACT-1420",
    period: "2014-2020",
    nameBg: "УРБАКТ III 2014-2020",
    nameEn: "URBACT III",
    eligibleNuts: null,
  },
  {
    keepProgrammeId: 69,
    code: "INTERREG-ESPON-1420",
    period: "2014-2020",
    nameBg: "ЕСПОН 2020",
    nameEn: "ESPON 2020",
    eligibleNuts: null,
    coverageNote:
      "353 of 370 partnerships in keep.eu but 0% partner budget — operations and partners only, no money.",
  },
];

// DELIBERATELY ABSENT, and each for a stated reason — this list is the other
// half of the admission gate, so a future reader does not "helpfully" add one:
//   - INTERACT III / IV: pure programme-level technical assistance. No
//     Bulgarian beneficiary exists to attribute money to.
//   - Mediterranean Sea Basin ENI CBC (77), NEXT MED (385), INTERREG V-B
//     Mediterranean (55): Bulgaria is not a participating country.
//   - Every 2007-2013 and 2000-2006 programme: keep.eu holds them, but the
//     partner-budget field did not exist and reads `n/a` on every row. They
//     would be operation counts with no attributable money.
// Frozen, not merely `readonly`. `readonly T[]` freezes the array and leaves
// every element writable, and `programmeFor()` hands out live references into
// the module-global maps below — so one caller normalising a name in place
// would rewrite the admission gate for the rest of the process. A gate whose
// contents its own callers can edit is not a gate.
export const INTERREG_PROGRAMMES: readonly InterregProgramme[] = Object.freeze(
  [...P_2021, ...P_2014].map((p) => Object.freeze(p)),
);

const BY_KEEP_ID = new Map<number, InterregProgramme>(
  INTERREG_PROGRAMMES.map((p) => [p.keepProgrammeId, p]),
);

const BY_CODE = new Map<string, InterregProgramme>(
  INTERREG_PROGRAMMES.map((p) => [p.code, p]),
);

/** The admission gate. `undefined` means "not ours" — skip it, never invent a code. */
export const programmeFor = (
  keepProgrammeId: number,
): InterregProgramme | undefined => BY_KEEP_ID.get(keepProgrammeId);

export const programmeByCode = (code: string): InterregProgramme | undefined =>
  BY_CODE.get(code);

export const isAdmittedProgramme = (keepProgrammeId: number): boolean =>
  BY_KEEP_ID.has(keepProgrammeId);

/** Every keep.eu programme id we ingest — the filter for the index walk. */
export const admittedKeepProgrammeIds = (): number[] =>
  INTERREG_PROGRAMMES.map((p) => p.keepProgrammeId);

export const programmesForPeriod = (
  period: InterregPeriod,
): InterregProgramme[] =>
  INTERREG_PROGRAMMES.filter((p) => p.period === period);

// A Bulgarian NUTS3 code as `data/municipalities.json` and `data/settlements.json`
// spell it. The `-\d+` tail is not defensive padding: 17 Пловдив-oblast rows
// really carry `BG421-1` (the PDV-00/PDV split recorded in the oblast-code-shard
// memo), and a stricter pattern would throw on live data.
const NUTS3_BG = /^BG\d{3}(-\d+)?$/;

/**
 * Is `nuts` inside the programme's Bulgarian eligible area?
 *
 * A PREFIX test, not equality: the Black Sea Basin programmes declare NUTS2
 * (BG33) while the land-border ones declare NUTS3 (BG341), and a settlement
 * carries NUTS3. Equality would silently exclude every Black Sea row.
 * A programme with `eligibleNuts: null` is nationwide and matches any BG code.
 *
 * @param nuts MUST be a Bulgarian NUTS3 code (`BG###`, optionally `-N`), or a
 *   foreign NUTS code, or empty. This is a REQUIREMENT, not a description:
 *   prefix semantics only answer the question when the input is at least as
 *   fine-grained as the declared area. `BG31` contains four of Romania-Bulgaria's
 *   eight eligible areas, so the truthful answer is "partially" and a bare
 *   `false` would read as "no Interreg money here" — the more dangerous of the
 *   two wrong answers. A malformed Bulgarian code therefore THROWS rather than
 *   returning a confident wrong `false`; a foreign code is a legitimate question
 *   with a legitimate `false`.
 */
export const isEligibleNuts = (
  programme: InterregProgramme,
  nuts: string | null | undefined,
): boolean => {
  if (!nuts) return false;
  if (!NUTS3_BG.test(nuts)) {
    // Leading whitespace and lowercase both land here, and both are malformed
    // Bulgarian codes rather than foreign ones — a caller passing " BG311"
    // wants an answer about Видин, not a silent `false`.
    if (/^\s*bg/i.test(nuts))
      throw new Error(
        `isEligibleNuts: expected a Bulgarian NUTS3 code, got ${JSON.stringify(nuts)}`,
      );
    return false;
  }
  if (programme.eligibleNuts === null) return true;
  return programme.eligibleNuts.some((area) => nuts.startsWith(area));
};

// One warning per unknown programme id per process. keep.eu has 390 programmes
// and the index walk sees every one of them, so warning per ROW would bury the
// signal under ~30k lines.
const warned = new Set<number>();

export const warnUnknownProgramme = (
  keepProgrammeId: number,
  title?: string,
): void => {
  if (warned.has(keepProgrammeId)) return;
  warned.add(keepProgrammeId);
  console.warn(
    `interreg: skipping keep.eu programme ${keepProgrammeId}` +
      (title ? ` (${title})` : "") +
      " — not in the curated register (scripts/funds/interreg/programmes.ts)",
  );
};

/** Test seam: the warn-once memo is process-global, which a test must be able to reset. */
export const __resetProgrammeWarnings = (): void => warned.clear();
