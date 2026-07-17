// Pure per-oblast folding for the regional (МРРБ) view — shared by the SPA hook
// (useRegionalOblast) AND the AI tool (ai/tools/regional.ts, which cannot import
// @/data/*). No React, no fetch: just the canonical oblast map + the muni-map→oblast
// aggregation, so the same numbers back the choropleth, the convergence scatter and the
// regionalInvestment chat tool.

/** Canonical oblast code (featureToCanon bucket) → bilingual display name. 28 oblasts. */
export const OBLAST_NAME: Record<string, { bg: string; en: string }> = {
  BGS: { bg: "Бургас", en: "Burgas" },
  BLG: { bg: "Благоевград", en: "Blagoevgrad" },
  DOB: { bg: "Добрич", en: "Dobrich" },
  GAB: { bg: "Габрово", en: "Gabrovo" },
  HKV: { bg: "Хасково", en: "Haskovo" },
  JAM: { bg: "Ямбол", en: "Yambol" },
  KNL: { bg: "Кюстендил", en: "Kyustendil" },
  KRZ: { bg: "Кърджали", en: "Kardzhali" },
  LOV: { bg: "Ловеч", en: "Lovech" },
  MON: { bg: "Монтана", en: "Montana" },
  PAZ: { bg: "Пазарджик", en: "Pazardzhik" },
  PDV: { bg: "Пловдив", en: "Plovdiv" },
  PER: { bg: "Перник", en: "Pernik" },
  PVN: { bg: "Плевен", en: "Pleven" },
  RAZ: { bg: "Разград", en: "Razgrad" },
  RSE: { bg: "Русе", en: "Ruse" },
  SFO: { bg: "Софийска област", en: "Sofia Province" },
  SHU: { bg: "Шумен", en: "Shumen" },
  SLS: { bg: "Силистра", en: "Silistra" },
  SLV: { bg: "Сливен", en: "Sliven" },
  SML: { bg: "Смолян", en: "Smolyan" },
  SZR: { bg: "Стара Загора", en: "Stara Zagora" },
  TGV: { bg: "Търговище", en: "Targovishte" },
  VAR: { bg: "Варна", en: "Varna" },
  VID: { bg: "Видин", en: "Vidin" },
  VRC: { bg: "Враца", en: "Vratsa" },
  VTR: { bg: "Велико Търново", en: "Veliko Tarnovo" },
  SOFIA_CITY: { bg: "София (столица)", en: "Sofia (capital)" },
};

export const oblastName = (canon: string, bg: boolean): string =>
  OBLAST_NAME[canon]?.[bg ? "bg" : "en"] ?? canon;

/** Fold a muni-map / regional.json oblast code to the canonical choropleth bucket
 *  (Sofia city shards → SOFIA_CITY, Plovdiv PDV-00 → PDV). */
export const oblastToCanon = (code: string): string => {
  if (code === "S22" || code === "S23" || code === "S24" || code === "S25")
    return "SOFIA_CITY";
  if (code === "PDV-00") return "PDV";
  return code;
};

/** One municipality row from data/funds/projects/muni-map.json. */
export interface MuniFundRow {
  oblast?: string;
  totalEur?: number;
  paidEur?: number;
  population?: number;
}

export interface RegionalOblastAgg {
  canon: string;
  name: string;
  contractedEur: number;
  paidEur: number;
  population: number;
  /** Contracted € per resident. */
  perCapitaEur: number;
  /** Absorbed (paid) € per resident. */
  paidPerCapitaEur: number;
  /** Latest GDP/capita from regional.json (EUR), or null. */
  gdpPerCapita: number | null;
}

/** Fold per-municipality ИСУН rows to the canonical oblast, joining GDP/capita.
 *  `gdpByCanon` is keyed by the SAME canonical code. Sorted by contracted € desc. */
export const aggregateRegionalOblasts = (
  munis: MuniFundRow[],
  gdpByCanon: Record<string, number>,
  bg = true,
): RegionalOblastAgg[] => {
  const agg = new Map<
    string,
    { contracted: number; paid: number; pop: number }
  >();
  for (const m of munis) {
    const canon = oblastToCanon(m.oblast ?? "");
    if (!canon) continue;
    const cur = agg.get(canon) ?? { contracted: 0, paid: 0, pop: 0 };
    cur.contracted += m.totalEur ?? 0;
    cur.paid += m.paidEur ?? 0;
    cur.pop += m.population ?? 0;
    agg.set(canon, cur);
  }
  const out: RegionalOblastAgg[] = [];
  for (const [canon, v] of agg) {
    out.push({
      canon,
      name: oblastName(canon, bg),
      contractedEur: v.contracted,
      paidEur: v.paid,
      population: v.pop,
      perCapitaEur: v.pop > 0 ? v.contracted / v.pop : 0,
      paidPerCapitaEur: v.pop > 0 ? v.paid / v.pop : 0,
      gdpPerCapita: gdpByCanon[canon] ?? null,
    });
  }
  return out.sort((a, b) => b.contractedEur - a.contractedEur);
};
