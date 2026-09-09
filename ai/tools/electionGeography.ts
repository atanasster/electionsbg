import { oblastName } from "./place";
import type { Lang } from "./types";

export type ElectionGeography = "mir" | "oblast";
export type ElectionRegion = {
  key: string;
  results: { votes: { partyNum: number; totalVotes: number }[] };
};

const adminKey = (mir: string): string | null => {
  if (mir === "32") return null;
  if (["S23", "S24", "S25"].includes(mir)) return "SOF-CITY";
  if (mir === "PDV-00") return "PDV";
  return mir;
};

export const electionAreaLabel = (
  key: string,
  geography: ElectionGeography,
  lang: Lang,
): string => {
  if (geography === "oblast" && key === "SOF-CITY")
    return lang === "bg" ? "София (столица)" : "Sofia City";
  if (geography === "oblast" && key === "PDV")
    return lang === "bg" ? "Пловдив" : "Plovdiv";
  return oblastName(key)[lang];
};

export const groupElectionRegions = (
  regions: ElectionRegion[],
  geography: ElectionGeography,
): ElectionRegion[] => {
  if (geography === "mir") return regions;
  const grouped = new Map<string, Map<number, number>>();
  for (const region of regions) {
    const key = adminKey(region.key);
    if (!key) continue;
    const votes = grouped.get(key) ?? new Map<number, number>();
    for (const row of region.results.votes)
      votes.set(
        row.partyNum,
        (votes.get(row.partyNum) ?? 0) + (row.totalVotes ?? 0),
      );
    grouped.set(key, votes);
  }
  return [...grouped].map(([key, votes]) => ({
    key,
    results: {
      votes: [...votes].map(([partyNum, totalVotes]) => ({
        partyNum,
        totalVotes,
      })),
    },
  }));
};

export const expandAdministrativeAreas = <T extends { code: string }>(
  areas: T[],
): T[] =>
  areas.flatMap((area) => {
    if (area.code === "SOF-CITY")
      return ["S23", "S24", "S25"].map((code) => ({ ...area, code }));
    if (area.code === "PDV")
      return ["PDV", "PDV-00"].map((code) => ({ ...area, code }));
    return [area];
  });
