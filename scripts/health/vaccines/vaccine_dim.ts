// The 31 НЗИС vaccine labels, each classified once (vaccines-flow-v1 §4).
//
// `labelEn` is НЗИС's English label VERBATIM — it is the join key for both the
// info-app cells and the report page's counters, which carry the same 31
// strings. `labelBg` is the report page's own Bulgarian half of that label
// (read 2026-11-23 from the 2026 and 2025 pages); „Други" is ours, because
// "Other" appears only in the info-app, never on a report page.
//
// `family`:
//   flu        injectable seasonal influenza
//   flu_nasal  the nasal (live attenuated) influenza vaccine — a separate НЗИС
//              label and a separate НЗОК channel (children)
//   covid      COVID-19
//   calendar   the mandatory schedule (Наредба № 15/2005): BCG, hepatitis B,
//              the DTaP/Td combinations, MMR and conjugate pneumococcal. The
//              Наредба names "conjugate pneumococcal" without a valency, so
//              10/13/15-valent are all calendar; 20-valent is given mostly to
//              adults and is NOT classified as calendar.
//   other      everything else, including recommended-but-not-mandatory
//              vaccines (HPV, rotavirus), sera and the PPD skin test
//
// The loader REFUSES a label that is not here rather than defaulting it: a new
// НЗИС vaccine must be classified by a person before it reaches a total.

export type VaccineFamily =
  | "flu"
  | "flu_nasal"
  | "covid"
  | "calendar"
  | "other";

export interface VaccineDimRow {
  code: string;
  labelEn: string;
  labelBg: string;
  family: VaccineFamily;
}

export const VACCINE_DIM: readonly VaccineDimRow[] = [
  {
    code: "flu",
    labelEn: "Seasonal influenza vaccine",
    labelBg: "Ваксина срещу сезонен грип",
    family: "flu",
  },
  {
    code: "flu_nasal",
    labelEn: "Nasal seasonal influenza vaccine",
    labelBg: "Ваксина срещу сезонен грип (назална)",
    family: "flu_nasal",
  },
  {
    code: "covid",
    labelEn: "COVID-19 vaccine",
    labelBg: "Ваксина срещу COVID-19",
    family: "covid",
  },
  {
    code: "bcg",
    labelEn: "Tuberculosis vaccine",
    labelBg: "Ваксина срещу туберкулоза",
    family: "calendar",
  },
  {
    code: "hepb",
    labelEn: "Hepatitis B vaccine",
    labelBg: "Ваксина срещу хепатит Б",
    family: "calendar",
  },
  {
    code: "dtap_hepb_ipv_hib",
    labelEn: "DTaP-HepB-IPV-Hib vaccine",
    labelBg: "Ваксина ДТКаХепБПиХИБ",
    family: "calendar",
  },
  {
    code: "dtap_ipv_hib",
    labelEn: "DTaP-IPV-Hib vaccine",
    labelBg: "Ваксина ДТКаПиХИБ",
    family: "calendar",
  },
  {
    code: "dtap_ipv",
    labelEn: "DTaP-IPV vaccine",
    labelBg: "Ваксина ДТКаПи",
    family: "calendar",
  },
  {
    code: "tdap",
    labelEn: "TDaP vaccine",
    labelBg: "Ваксина Тдка",
    family: "calendar",
  },
  {
    code: "td",
    labelEn: "Td vaccine",
    labelBg: "Ваксина Тд",
    family: "calendar",
  },
  {
    code: "mmr",
    labelEn: "Measles, Mumps, and Rubella (MMR) combined vaccine",
    labelBg: "Комбинирана ваксина срещу морбили, паротит, рубеола",
    family: "calendar",
  },
  {
    code: "pcv10",
    labelEn: "10-valent pneumococcal conjugate vaccine",
    labelBg: "Конюгирана ваксина срещу пневмококи (10-валентна)",
    family: "calendar",
  },
  {
    code: "pcv13",
    labelEn: "13-valent pneumococcal conjugate vaccine",
    labelBg: "Конюгирана ваксина срещу пневмококи (13-валентна)",
    family: "calendar",
  },
  {
    code: "pcv15",
    labelEn: "15-valent pneumococcal conjugate vaccine",
    labelBg: "Конюгирана ваксина срещу пневмококи (15-валентна)",
    family: "calendar",
  },
  {
    code: "pcv20",
    labelEn: "20-valent pneumococcal conjugate vaccine",
    labelBg: "Конюгирана ваксина срещу пневмококи (20-валентна)",
    family: "other",
  },
  {
    code: "hpv",
    labelEn: "Human papillomavirus (HPV) vaccine",
    labelBg: "Ваксина срещу човешки папилома вирус (HPV)",
    family: "other",
  },
  {
    code: "rotavirus",
    labelEn: "Rotavirus vaccine",
    labelBg: "Ротавирусна ваксина",
    family: "other",
  },
  {
    code: "varicella",
    labelEn: "Varicella (chickenpox) vaccine",
    labelBg: "Ваксина срещу варицела",
    family: "other",
  },
  {
    code: "rsv",
    labelEn: "RSV vaccine (Respiratory Syncytial Virus vaccine)",
    labelBg: "Ваксина срещу RSV",
    family: "other",
  },
  {
    code: "rabies",
    labelEn: "Rabies vaccine",
    labelBg: "Ваксина срещу бяс",
    family: "other",
  },
  {
    code: "yellow_fever",
    labelEn: "Yellow fever vaccine",
    labelBg: "Ваксина срещу жълта треска",
    family: "other",
  },
  {
    code: "cchf",
    labelEn: "CCHF vaccine (Crimean-Congo Hemorrhagic Fever vaccine)",
    labelBg: "Ваксина срещу ККХТ",
    family: "other",
  },
  {
    code: "menacwy",
    labelEn: "Meningococcal vaccine (A, C, W135, Y)",
    labelBg: "Ваксина срещу менингококи (А, C, W135, Y)",
    family: "other",
  },
  {
    code: "menb",
    labelEn: "Meningococcal vaccine (В)",
    labelBg: "Ваксина срещу менингококи (В)",
    family: "other",
  },
  {
    code: "tetanus",
    labelEn: "Tetanus vaccine",
    labelBg: "Ваксина срещу тетанус",
    family: "other",
  },
  {
    code: "hepa",
    labelEn: "Hepatitis A vaccine",
    labelBg: "Ваксина срещу хепатит А",
    family: "other",
  },
  {
    code: "hepab",
    labelEn: "Combined Hepatitis A and B vaccine",
    labelBg: "Комбинирана ваксина срещу хепатити А и Б",
    family: "other",
  },
  {
    code: "antitetanus_serum",
    labelEn: "Antitetanus serum",
    labelBg: "Антитетаничен серум",
    family: "other",
  },
  {
    code: "antidiphtheria_serum",
    labelEn: "Antidiphtheria serum",
    labelBg: "Антидифтериен серум",
    family: "other",
  },
  {
    code: "ppd",
    labelEn: "Purified Protein Derivative (PPD)",
    labelBg: "Пречистен протеинов дериват (ППД)",
    family: "other",
  },
  {
    code: "other",
    labelEn: "Other",
    labelBg: "Други",
    family: "other",
  },
];

const BY_LABEL = new Map(VACCINE_DIM.map((v) => [v.labelEn, v]));

/** The dimension row for an НЗИС English label; throws on an unclassified one. */
export const vaccineByLabel = (labelEn: string): VaccineDimRow => {
  const v = BY_LABEL.get(labelEn);
  if (!v)
    throw new Error(
      `НЗИС vaccine label ${JSON.stringify(labelEn)} is not classified — add it to scripts/health/vaccines/vaccine_dim.ts`,
    );
  return v;
};

// ------------------------------------------------------------------ oblasts

/** НЗИС's oblast key (cl015_key, also the ISO 3166-2:BG number) → its English
 *  label → the place_dim oblast code. The label is asserted, not just the key,
 *  so a renumbered source fails instead of moving a count between oblasts.
 *  „Sofia" (23, Софийска област) and „Sofia City" (22) are different oblasts. */
export const HIS_OBLASTS: ReadonlyArray<{
  key: number;
  labelEn: string;
  code: string;
}> = [
  { key: 1, labelEn: "Blagoevgrad", code: "BLG" },
  { key: 2, labelEn: "Burgas", code: "BGS" },
  { key: 3, labelEn: "Varna", code: "VAR" },
  { key: 4, labelEn: "Veliko Tarnovo", code: "VTR" },
  { key: 5, labelEn: "Vidin", code: "VID" },
  { key: 6, labelEn: "Vratsa", code: "VRC" },
  { key: 7, labelEn: "Gabrovo", code: "GAB" },
  { key: 8, labelEn: "Dobrich", code: "DOB" },
  { key: 9, labelEn: "Kardzhali", code: "KRZ" },
  { key: 10, labelEn: "Kyustendil", code: "KNL" },
  { key: 11, labelEn: "Lovech", code: "LOV" },
  { key: 12, labelEn: "Montana", code: "MON" },
  { key: 13, labelEn: "Pazardzhik", code: "PAZ" },
  { key: 14, labelEn: "Pernik", code: "PER" },
  { key: 15, labelEn: "Pleven", code: "PVN" },
  { key: 16, labelEn: "Plovdiv", code: "PDV" },
  { key: 17, labelEn: "Razgrad", code: "RAZ" },
  { key: 18, labelEn: "Ruse", code: "RSE" },
  { key: 19, labelEn: "Silistra", code: "SLS" },
  { key: 20, labelEn: "Sliven", code: "SLV" },
  { key: 21, labelEn: "Smolyan", code: "SML" },
  { key: 22, labelEn: "Sofia City", code: "SOFIA_CITY" },
  { key: 23, labelEn: "Sofia", code: "SFO" },
  { key: 24, labelEn: "Stara Zagora", code: "SZR" },
  { key: 25, labelEn: "Targovishte", code: "TGV" },
  { key: 26, labelEn: "Haskovo", code: "HKV" },
  { key: 27, labelEn: "Shumen", code: "SHU" },
  { key: 28, labelEn: "Yambol", code: "JAM" },
];

const OBLAST_BY_KEY = new Map(HIS_OBLASTS.map((o) => [o.key, o]));

/** place_dim code for an НЗИС (key, label) pair; throws on any mismatch. */
export const oblastCodeFor = (key: number, labelEn: string): string => {
  const o = OBLAST_BY_KEY.get(key);
  if (!o || o.labelEn !== labelEn)
    throw new Error(
      `НЗИС oblast ${key} ${JSON.stringify(labelEn)} does not match the curated map (expected ${JSON.stringify(o?.labelEn ?? null)})`,
    );
  return o.code;
};

/** place_dim code for the report page's ISO key ("BG-22"). */
export const oblastCodeForIso = (iso: string): string => {
  const m = /^BG-(\d{2})$/.exec(iso);
  const o = m ? OBLAST_BY_KEY.get(Number(m[1])) : undefined;
  if (!o)
    throw new Error(`НЗИС district ${JSON.stringify(iso)} is not BG-01…BG-28`);
  return o.code;
};

/** НЦЗПБ names the capital and the province differently from place_dim's
 *  name_bg; every other area is place_dim's own Bulgarian name. */
export const NCIPD_AREA_OVERRIDES: Readonly<Record<string, string>> = {
  "София-град": "SOFIA_CITY",
  "София-област": "SFO",
  "Общо за страната": "BG",
};
