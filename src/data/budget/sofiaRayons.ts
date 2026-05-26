// Frontend mirror of scripts/budget/capital_programs/sofia_rayons.ts.
// Keeps the same 24-район canonical slug list + obshtina→район map so the
// SofiaCapitalProjectsTile can resolve which район a settlement belongs to
// without importing from scripts/ (forbidden cross-tree). Kept small.

export interface SofiaRayon {
  code: string;
  labelBg: string;
  labelEn: string;
  obshtinaCode: string; // settlement.obshtina value (S2XXX)
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

const OBSHTINA_TO_RAYON: Map<string, string> = new Map(
  SOFIA_RAYONS.map((r) => [r.obshtinaCode, r.code]),
);

export const rayonFromObshtina = (
  obshtinaCode: string | null | undefined,
): string | null =>
  obshtinaCode ? (OBSHTINA_TO_RAYON.get(obshtinaCode) ?? null) : null;
