// The 6 районни администрации of Община Пловдив. Pattern mirrors
// sofia_rayons.ts.

export interface PlovdivRayon {
  code: string;
  labelBg: string;
  labelEn: string;
  obshtinaCode: string; // settlement.obshtina value (PDV codes)
}

// Plovdiv's 6 районi. Unlike Sofia (where every район has its own S2XXX
// obshtina code), Plovdiv is ONE obshtina (PDV22, EKATTE 56784) covering
// the whole city — settlement-level data has no per-район granularity.
// So no obshtina→район map; the frontend tile shows ALL 6 районi stacked
// on the single Plovdiv settlement / município page. obshtinaCode is kept
// in the type for forward-compatibility with future municipalities that
// follow the Sofia pattern.
export const PLOVDIV_RAYONS: PlovdivRayon[] = [
  {
    code: "CENTRALEN",
    labelBg: "Централен",
    labelEn: "Tsentralen",
    obshtinaCode: "",
  },
  {
    code: "IZTOCHEN",
    labelBg: "Източен",
    labelEn: "Iztochen",
    obshtinaCode: "",
  },
  { code: "ZAPADEN", labelBg: "Западен", labelEn: "Zapaden", obshtinaCode: "" },
  { code: "SEVEREN", labelBg: "Северен", labelEn: "Severen", obshtinaCode: "" },
  { code: "YUZHEN", labelBg: "Южен", labelEn: "Yuzhen", obshtinaCode: "" },
  { code: "TRAKIYA", labelBg: "Тракия", labelEn: "Trakiya", obshtinaCode: "" },
];

const normalise = (s: string): string =>
  s.toLowerCase().normalize("NFKC").replace(/\s+/g, " ").trim();

const NAME_TO_CODE: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const r of PLOVDIV_RAYONS) m.set(normalise(r.labelBg), r.code);
  return m;
})();

// Match the FIRST район name inside an arbitrary column-A string —
// "Район Централен" → "CENTRALEN", "ДГ Мая - Район Южен" → "YUZHEN".
export const lookupRayonCode = (raw: string): string | null => {
  const re = /Район\s+([А-ЯЁа-яё]+)/u;
  const m = raw.match(re);
  if (!m) return null;
  return NAME_TO_CODE.get(normalise(m[1])) ?? null;
};
