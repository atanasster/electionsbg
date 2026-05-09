import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import type {
  CensusEntity,
  CensusMetric,
  CensusMunicipalityEntity,
  CensusOblastEntity,
  CensusPayload,
  CensusSettlementEntity,
  CensusSettlementsPayload,
} from "./censusTypes";

const fetchJson = async <T,>(path: string): Promise<T | undefined> => {
  const res = await fetch(path);
  if (!res.ok) return undefined;
  return (await res.json()) as T;
};

export const useCensus = () =>
  useQuery({
    queryKey: ["census_2021"],
    queryFn: () => fetchJson<CensusPayload>("/census_2021.json"),
  });

const sumEthnicDeclared = (e: CensusEntity["ethnic"]): number => {
  if (!e) return 0;
  return e.bulgarian + e.turkish + e.roma + e.other;
};

const sumReligionDeclared = (r: CensusEntity["religion"]): number => {
  if (!r) return 0;
  return r.christian + r.muslim + r.jewish + r.other + r.noReligion;
};

const sumEducation = (e: CensusEntity["education"]): number => {
  if (!e) return 0;
  return (
    e.tertiary +
    e.upperSecondary +
    e.lowerSecondary +
    e.primaryOrLower +
    e.preSchool
  );
};

// Returns the metric value for an entity as either an absolute count or a
// share (0..1) — share for percentage-like metrics, absolute for population.
// Undefined when the entity doesn't have the relevant dimension.
export const censusMetricValue = (
  e: CensusEntity | undefined,
  metric: CensusMetric,
): number | undefined => {
  if (!e) return undefined;
  switch (metric) {
    case "population":
      return e.population;
    case "popChange":
      // Population change is computed externally (needs a 2011 baseline).
      return undefined;
    case "ethnicBulgarian": {
      const denom = sumEthnicDeclared(e.ethnic);
      return denom > 0 && e.ethnic ? e.ethnic.bulgarian / denom : undefined;
    }
    case "ethnicTurkish": {
      const denom = sumEthnicDeclared(e.ethnic);
      return denom > 0 && e.ethnic ? e.ethnic.turkish / denom : undefined;
    }
    case "ethnicRoma": {
      const denom = sumEthnicDeclared(e.ethnic);
      return denom > 0 && e.ethnic ? e.ethnic.roma / denom : undefined;
    }
    case "religionChristian": {
      const denom = sumReligionDeclared(e.religion);
      return denom > 0 && e.religion ? e.religion.christian / denom : undefined;
    }
    case "religionMuslim": {
      const denom = sumReligionDeclared(e.religion);
      return denom > 0 && e.religion ? e.religion.muslim / denom : undefined;
    }
    case "religionNoneOrUndecl": {
      const denom = sumReligionDeclared(e.religion);
      return denom > 0 && e.religion
        ? e.religion.noReligion / denom
        : undefined;
    }
    case "eduTertiary": {
      const denom = sumEducation(e.education);
      return denom > 0 && e.education
        ? e.education.tertiary / denom
        : undefined;
    }
    case "eduSecondary": {
      // Cumulative attainment: share of population whose highest level is at
      // least upper-secondary (so it includes tertiary). NSI's standard
      // framing — "средно и по-високо образование" — pools the two so the
      // figure reads as "people who finished high school or beyond".
      const denom = sumEducation(e.education);
      return denom > 0 && e.education
        ? (e.education.upperSecondary + e.education.tertiary) / denom
        : undefined;
    }
    case "eduPrimaryOrLower": {
      const denom = sumEducation(e.education);
      return denom > 0 && e.education
        ? e.education.primaryOrLower / denom
        : undefined;
    }
    case "ageUnder15":
      return e.age && e.population > 0
        ? e.age.age0_14 / e.population
        : undefined;
    case "age65plus":
      return e.age && e.population > 0
        ? e.age.age65plus / e.population
        : undefined;
    case "employmentRate":
      return e.employment ? e.employment.employmentRate / 100 : undefined;
    case "unemploymentRate":
      return e.employment ? e.employment.unemploymentRate / 100 : undefined;
    case "activityRate":
      return e.employment ? e.employment.activityRate / 100 : undefined;
  }
};

// Map our internal `oblast` (BLG, S23, PDV-00, ...) to the NSI 3-letter code
// the Census file is keyed on. Sofia city's three election MIRs all collapse
// into NSI's "SOF". Plovdiv's election split (PDV / PDV-00) collapses into
// the geographic "PDV".
export const oblastToCensusCode = (
  oblast: string | undefined,
): string | undefined => {
  if (!oblast) return undefined;
  if (oblast === "S23" || oblast === "S24" || oblast === "S25") return "SOF";
  if (oblast === "PDV-00") return "PDV";
  if (/^[A-Z]{3}$/.test(oblast)) return oblast;
  return undefined;
};

export const useCensusOblast = () => {
  const { data } = useCensus();
  return useCallback(
    (oblast?: string): CensusOblastEntity | undefined => {
      if (!data) return undefined;
      const code = oblastToCensusCode(oblast);
      if (!code) return undefined;
      return data.oblasts.find((o) => o.code === code);
    },
    [data],
  );
};

export const useCensusMunicipality = () => {
  const { data } = useCensus();
  return useCallback(
    (obshtina?: string): CensusMunicipalityEntity | undefined => {
      if (!data) return undefined;
      if (!obshtina) return undefined;
      return data.municipalities.find((m) => m.code === obshtina);
    },
    [data],
  );
};

// Lazy-loaded settlement-level data (only population + age + gender; NSI does
// not publish ethnicity/religion/education at this granularity). Pass
// `enabled: false` to defer the fetch until a settlement view actually mounts.
export const useCensusSettlements = (enabled: boolean = true) =>
  useQuery({
    queryKey: ["census_2021_settlements"],
    queryFn: () =>
      fetchJson<CensusSettlementsPayload>("/census_2021_settlements.json"),
    enabled,
  });

// Pass `enabled: false` from callers that only conditionally need a
// settlement lookup, so we don't always pull the 1.8MB sidecar onto pages
// that aren't at settlement granularity (e.g. region/oblast dashboards).
export const useCensusSettlement = (enabled: boolean = true) => {
  const { data } = useCensusSettlements(enabled);
  return useCallback(
    (ekatte?: string): CensusSettlementEntity | undefined => {
      if (!data) return undefined;
      if (!ekatte) return undefined;
      return data.find((s) => s.ekatte === ekatte);
    },
    [data],
  );
};

// Per-entity census slice hooks. Dashboards use these so a region or
// municipality page only fetches its own ~1KB slice instead of the full
// 28-oblast + 265-municipality payload. The slice files are generated by
// scripts/census/build_census.ts.
export const useCensusOblastSlice = (oblast?: string) => {
  const code = oblastToCensusCode(oblast);
  return useQuery({
    queryKey: ["census_oblast_slice", code],
    queryFn: () =>
      fetchJson<CensusOblastEntity>(`/census/oblasts/${code}.json`),
    enabled: !!code,
  });
};

export const useCensusMunicipalitySlice = (obshtina?: string) =>
  useQuery({
    queryKey: ["census_municipality_slice", obshtina],
    queryFn: () =>
      fetchJson<CensusMunicipalityEntity>(
        `/census/municipalities/${obshtina}.json`,
      ),
    enabled: !!obshtina,
  });
