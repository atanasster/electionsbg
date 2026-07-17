// Per-oblast EU-funds (ИСУН) aggregate for the regional pack's choropleth + convergence
// scatter. Reads the static data/funds/projects/muni-map.json (per-municipality contracted
// /paid € + population + oblast) and folds it to the canonical oblast bucket used by the
// shared OblastChoropleth (featureToCanon: Sofia city → SOFIA_CITY, Plovdiv → PDV). Joins
// the latest GDP/capita from data/regional.json for the convergence axis. No DB — pure
// static join, so it renders without the procurement corpus loaded.
//
// ⚠ CAVEAT (surfaced in the tiles): muni-map is ALL ИСУН funds (every OP + the RRF), not
// only the two МРРБ regional OPs. The geo-attribution pins each project to its
// beneficiary, so Sofia city is inflated by nationally-run programmes headquartered there
// (the Kohesio caveat, §0b). The tiles label this and the convergence scatter drops Sofia
// from the fit. The two МРРБ regional OPs specifically are the RegionalCohesionTile.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

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

/** Fold a muni-map / regional.json oblast code to the canonical choropleth bucket. */
const toCanon = (code: string): string => {
  if (code === "S22" || code === "S23" || code === "S24" || code === "S25")
    return "SOFIA_CITY";
  if (code === "PDV-00") return "PDV";
  return code;
};

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

interface MuniMapFile {
  munis?: {
    oblast?: string;
    totalEur?: number;
    paidEur?: number;
    population?: number;
  }[];
}
interface RegionalFile {
  series?: {
    gdpPerCapita?: Record<string, { year: number; value: number }[]>;
  };
}

export const useRegionalOblast = (): {
  oblasts: RegionalOblastAgg[];
  isLoading: boolean;
} => {
  const muni = useQuery({
    queryKey: ["funds", "muni-map", "regional"] as const,
    queryFn: async (): Promise<MuniMapFile> => {
      const r = await fetch(dataUrl("/funds/projects/muni-map.json"));
      if (!r.ok) return {};
      return r.json();
    },
    staleTime: Infinity,
  });
  const region = useQuery({
    queryKey: ["regional", "gdpPerCapita"] as const,
    queryFn: async (): Promise<Record<string, number>> => {
      const r = await fetch(dataUrl("/regional.json"));
      if (!r.ok) return {};
      const d = (await r.json()) as RegionalFile;
      const g = d.series?.gdpPerCapita ?? {};
      const out: Record<string, number> = {};
      for (const [code, arr] of Object.entries(g)) {
        const canon = toCanon(code);
        const last = arr[arr.length - 1];
        // PDV + PDV-00 and the Sofia shards collapse to one canon; keep the first
        // non-null (they carry identical oblast values).
        if (last && out[canon] == null) out[canon] = last.value;
      }
      return out;
    },
    staleTime: Infinity,
  });

  const oblasts = useMemo<RegionalOblastAgg[]>(() => {
    const munis = muni.data?.munis ?? [];
    if (!munis.length) return [];
    const gdp = region.data ?? {};
    const agg = new Map<
      string,
      { contracted: number; paid: number; pop: number }
    >();
    for (const m of munis) {
      const canon = toCanon(m.oblast ?? "");
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
        name: oblastName(canon, true),
        contractedEur: v.contracted,
        paidEur: v.paid,
        population: v.pop,
        perCapitaEur: v.pop > 0 ? v.contracted / v.pop : 0,
        paidPerCapitaEur: v.pop > 0 ? v.paid / v.pop : 0,
        gdpPerCapita: gdp[canon] ?? null,
      });
    }
    return out.sort((a, b) => b.contractedEur - a.contractedEur);
  }, [muni.data, region.data]);

  return { oblasts, isLoading: muni.isLoading || region.isLoading };
};
