// The 24 районни администрации of Столична община + a canonical lookup
// for район names that appear inside project descriptions in Sofia's
// annual капиталова програма XLSX.
//
// XLSX rows tag projects in free-form Bulgarian: район "БАНКЯ", район
// „БАНКЯ", "Банкя" — same район, three spellings. We normalise to a
// stable upper-case ASCII-ish slug (BANKYA, IZGREV, NOVI_ISKAR) and
// keep the canonical bg/en labels separately. The slug is what the
// frontend stores in JSON; bg/en labels render in the UI.
//
// The codebase's own "obshtina" code for Sofia settlements (S2XXX) is
// already the район — one S-code per районна администрация. So we
// expose both an XLSX→code lookup (used by the parser) and an
// obshtina→code map (used by the frontend tile to filter by location).

export interface SofiaRayon {
  code: string; // stable slug, used as the JSON key
  labelBg: string;
  labelEn: string;
  // Codebase obshtina identifier for this район (settlements.json).
  obshtinaCode: string;
}

export const SOFIA_RAYONS: SofiaRayon[] = [
  {
    code: "SREDETS",
    labelBg: "Средец",
    labelEn: "Sredets",
    obshtinaCode: "S2401",
  },
  {
    code: "KRASNO_SELO",
    labelBg: "Красно село",
    labelEn: "Krasno selo",
    obshtinaCode: "S2302",
  },
  {
    code: "VAZRAZHDANE",
    labelBg: "Възраждане",
    labelEn: "Vazrazhdane",
    obshtinaCode: "S2403",
  },
  {
    code: "OBORISHTE",
    labelBg: "Оборище",
    labelEn: "Oborishte",
    obshtinaCode: "S2404",
  },
  {
    code: "SERDIKA",
    labelBg: "Сердика",
    labelEn: "Serdika",
    obshtinaCode: "S2405",
  },
  {
    code: "PODUYANE",
    labelBg: "Подуяне",
    labelEn: "Poduyane",
    obshtinaCode: "S2406",
  },
  {
    code: "SLATINA",
    labelBg: "Слатина",
    labelEn: "Slatina",
    obshtinaCode: "S2407",
  },
  {
    code: "IZGREV",
    labelBg: "Изгрев",
    labelEn: "Izgrev",
    obshtinaCode: "S2308",
  },
  {
    code: "LOZENETS",
    labelBg: "Лозенец",
    labelEn: "Lozenets",
    obshtinaCode: "S2309",
  },
  {
    code: "TRIADITSA",
    labelBg: "Триадица",
    labelEn: "Triaditsa",
    obshtinaCode: "S2310",
  },
  {
    code: "KRASNA_POLYANA",
    labelBg: "Красна поляна",
    labelEn: "Krasna polyana",
    obshtinaCode: "S2511",
  },
  {
    code: "ILINDEN",
    labelBg: "Илинден",
    labelEn: "Ilinden",
    obshtinaCode: "S2512",
  },
  {
    code: "NADEZHDA",
    labelBg: "Надежда",
    labelEn: "Nadezhda",
    obshtinaCode: "S2513",
  },
  { code: "ISKAR", labelBg: "Искър", labelEn: "Iskar", obshtinaCode: "S2414" },
  {
    code: "MLADOST",
    labelBg: "Младост",
    labelEn: "Mladost",
    obshtinaCode: "S2315",
  },
  {
    code: "STUDENTSKI",
    labelBg: "Студентски",
    labelEn: "Studentski",
    obshtinaCode: "S2316",
  },
  {
    code: "VITOSHA",
    labelBg: "Витоша",
    labelEn: "Vitosha",
    obshtinaCode: "S2317",
  },
  {
    code: "OVCHA_KUPEL",
    labelBg: "Овча купел",
    labelEn: "Ovcha kupel",
    obshtinaCode: "S2518",
  },
  {
    code: "LYULIN",
    labelBg: "Люлин",
    labelEn: "Lyulin",
    obshtinaCode: "S2519",
  },
  {
    code: "VRABNITSA",
    labelBg: "Връбница",
    labelEn: "Vrabnitsa",
    obshtinaCode: "S2520",
  },
  {
    code: "NOVI_ISKAR",
    labelBg: "Нови Искър",
    labelEn: "Novi Iskar",
    obshtinaCode: "S2521",
  },
  {
    code: "KREMIKOVTSI",
    labelBg: "Кремиковци",
    labelEn: "Kremikovtsi",
    obshtinaCode: "S2422",
  },
  {
    code: "PANCHAREVO",
    labelBg: "Панчарево",
    labelEn: "Pancharevo",
    obshtinaCode: "S2323",
  },
  {
    code: "BANKYA",
    labelBg: "Банкя",
    labelEn: "Bankya",
    obshtinaCode: "S2524",
  },
];

const normalise = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[„""«»"']/g, "")
    .replace(/\s+/g, " ")
    .trim();

// Maps an XLSX raw район token (e.g. "БАНКЯ" extracted from
// `район "БАНКЯ"`) onto a stable code. Built from labelBg of each район.
const ALIAS_TO_CODE: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const r of SOFIA_RAYONS) m.set(normalise(r.labelBg), r.code);
  return m;
})();

export const lookupRayonCode = (raw: string): string | null =>
  ALIAS_TO_CODE.get(normalise(raw)) ?? null;

// Frontend-side lookup: given a settlement's `obshtina` code, what район
// does it belong to? Null when the obshtina isn't a Sofia район (i.e.
// the settlement is outside Столична община).
const OBSHTINA_TO_RAYON: Map<string, string> = new Map(
  SOFIA_RAYONS.map((r) => [r.obshtinaCode, r.code]),
);

export const rayonFromObshtina = (obshtinaCode: string): string | null =>
  OBSHTINA_TO_RAYON.get(obshtinaCode) ?? null;
