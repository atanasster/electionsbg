import { useMemo } from "react";
import { useSettlementsInfo } from "../settlements/useSettlements";
import Fuse from "fuse.js";
import { useMunicipalities } from "../municipalities/useMunicipalities";
import { useRegions } from "../regions/useRegions";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { SectionIndex } from "../dataTypes";
import { useElectionContext } from "../ElectionContext";
import { useCandidates } from "../preferences/useCandidates";
import { useMps } from "../parliament/useMps";
import { dataUrl } from "@/data/dataUrl";

// Per-year ministry rosters from data/budget/derived/admin_flow.json. We
// dedupe across years to get the union set of unique spending units; each
// becomes a search-bar entry that routes to /budget/ministry/:nodeId.
type AdminFlowFile = {
  fiscalYears: Record<
    string,
    {
      ministries: Array<{
        nodeId: string;
        nameBg: string;
        nameEn: string;
      }>;
    }
  >;
};

const fetchAdminFlow = async (): Promise<AdminFlowFile | null> => {
  try {
    const r = await fetch(dataUrl("/budget/derived/admin_flow.json"));
    if (!r.ok) return null;
    return (await r.json()) as AdminFlowFile;
  } catch {
    return null;
  }
};

const useBudgetMinistriesForSearch = () =>
  useQuery({
    queryKey: ["search", "budget-ministries"] as const,
    queryFn: fetchAdminFlow,
    staleTime: Infinity,
  });

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string | null | undefined]>): Promise<
  SectionIndex[]
> => {
  if (!queryKey[1]) {
    return [];
  }
  const response = await fetch(dataUrl(`/${queryKey[1]}/sections_index.json`));
  const data = await response.json();
  return data;
};

export type SearchIndexType = {
  // s=settlement, m=municipality, r=region, c=section, a=candidate/MP,
  // b=budget unit (ministry / spending unit on /budget/ministry/:id)
  type: "s" | "m" | "r" | "c" | "a" | "b";
  key: string;
  name: string;
  name_en?: string;
  parentName?: string;
  parentName_en?: string;
  photoUrl?: string;
};
export const useSearchItems = () => {
  const { selected } = useElectionContext();
  const { data: sections } = useQuery({
    queryKey: ["sections_index", selected],
    queryFn,
  });
  const { settlements } = useSettlementsInfo();
  const { municipalities } = useMunicipalities();
  const { candidates } = useCandidates();
  const { regions } = useRegions();
  const { findMpByName } = useMps();
  const { data: adminFlow } = useBudgetMinistriesForSearch();
  const fuse = useMemo(() => {
    if (settlements && municipalities && sections && candidates) {
      const regionByCode = new Map(regions.map((r) => [r.oblast, r]));
      const muniByCode = new Map(municipalities.map((m) => [m.obshtina, m]));
      const searchItems: SearchIndexType[] = settlements.map((s) => {
        const muni = muniByCode.get(s.obshtina);
        const region = regionByCode.get(s.oblast);
        const parts = [muni?.name, region?.name].filter(Boolean);
        const partsEn = [muni?.name_en, region?.name_en].filter(Boolean);
        return {
          type: "s",
          key: s.ekatte,
          name: s.name,
          name_en: s.name_en,
          parentName: parts.length ? parts.join(", ") : undefined,
          parentName_en: partsEn.length ? partsEn.join(", ") : undefined,
        };
      });
      sections.forEach((s) => {
        searchItems.push({
          type: "c",
          key: s.section,
          name: s.section,
          name_en: s.settlement,
          parentName: s.settlement,
          parentName_en: s.settlement,
        });
      });
      municipalities.forEach((m) => {
        const region = regionByCode.get(m.oblast);
        searchItems.push({
          type: "m",
          key: m.obshtina,
          name: m.name,
          name_en: m.name_en,
          parentName: region?.name,
          parentName_en: region?.name_en,
        });
      });
      regions.forEach((r) => {
        searchItems.push({
          type: "r",
          key: r.oblast,
          name: r.name,
          name_en: r.name_en,
        });
      });
      const candidateOblasts = new Map<
        string,
        { en: string; oblasts: Set<string> }
      >();
      candidates?.forEach((r) => {
        if (!candidateOblasts.has(r.name)) {
          candidateOblasts.set(r.name, { en: r.name_en, oblasts: new Set() });
        }
        candidateOblasts.get(r.name)!.oblasts.add(r.oblast);
      });
      const candidateEntries = Array.from(candidateOblasts.entries())
        .map(([name, v]) => ({
          name,
          name_en: v.en,
          oblastCount: v.oblasts.size,
        }))
        .sort((a, b) => b.oblastCount - a.oblastCount);
      candidateEntries.forEach((c) => {
        const mp = findMpByName(c.name);
        // Prefer the MP's name_en (parliament.bg EN API) when matched, since
        // it carries the canonical Wikipedia spelling for well-known
        // politicians; fall back to the candidate's transliterated name_en.
        searchItems.push({
          type: "a",
          key: c.name,
          name: c.name,
          name_en: mp?.name_en ?? c.name_en,
          photoUrl: mp?.photoUrl,
        });
      });

      // Budget spending units (ministries / agencies). Dedupe across years —
      // the same nodeId appears in every year's ministries[]; we want one
      // search entry per unit. Adds ~50 items to the index.
      if (adminFlow) {
        const seen = new Set<string>();
        for (const yearKey of Object.keys(adminFlow.fiscalYears)
          .sort()
          .reverse()) {
          const ms = adminFlow.fiscalYears[yearKey].ministries;
          for (const m of ms) {
            if (seen.has(m.nodeId)) continue;
            seen.add(m.nodeId);
            searchItems.push({
              type: "b",
              key: m.nodeId,
              name: m.nameBg,
              name_en: m.nameEn || m.nameBg,
            });
          }
        }
      }

      return new Fuse<SearchIndexType>(searchItems, {
        includeScore: true,
        includeMatches: true,
        // Match anywhere in the string. Without this, Fuse anchors the
        // search to position 0 and a query like "образование" misses
        // "Министерството на образованието" because the match sits 19
        // chars in. Per-type score limits in SearchContext keep noise out.
        ignoreLocation: true,
        keys: ["name", "name_en"],
      });
    }
    return undefined;
  }, [
    adminFlow,
    candidates,
    findMpByName,
    municipalities,
    regions,
    sections,
    settlements,
  ]);
  const search = (searchTern: string) => {
    return fuse?.search(searchTern);
  };
  return { search };
};
