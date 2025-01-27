import { useMemo } from "react";
import { useSettlementsInfo } from "../settlements/useSettlements";
import Fuse from "fuse.js";
import { useMunicipalities } from "../municipalities/useMunicipalities";
import { useRegions } from "../regions/useRegions";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { SectionIndex } from "../dataTypes";
import { useElectionContext } from "../ElectionContext";
import { useCandidates } from "../preferences/useCandidates";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string | null | undefined]>): Promise<
  SectionIndex[]
> => {
  if (!queryKey[1]) {
    return [];
  }
  const response = await fetch(`/${queryKey[1]}/sections_index.json`);
  const data = await response.json();
  return data;
};

export type SearchIndexType = {
  type: "s" | "m" | "r" | "c" | "a";
  key: string;
  name: string;
  name_en?: string;
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
  const fuse = useMemo(() => {
    if (settlements && municipalities && sections && candidates) {
      const searchItems: SearchIndexType[] = settlements.map((s) => ({
        type: "s",
        key: s.ekatte,
        name: s.name,
        name_en: s.name_en,
      }));
      sections.forEach((s) => {
        searchItems.push({
          type: "c",
          key: s.section,
          name: s.section,
          name_en: s.settlement,
        });
      });
      municipalities.forEach((m) => {
        searchItems.push({
          type: "m",
          key: m.obshtina,
          name: m.name,
          name_en: m.name_en,
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
      const names: string[] = [];
      candidates?.forEach((r) => {
        if (!names.includes(r.name)) {
          searchItems.push({
            type: "a",
            key: r.name,
            name: r.name,
          });
          names.push(r.name);
        }
      });

      return new Fuse<SearchIndexType>(searchItems, {
        includeScore: true,
        keys: ["name", "name_en"],
      });
    }
    return undefined;
  }, [candidates, municipalities, regions, sections, settlements]);
  const search = (searchTern: string) => {
    return fuse?.search(searchTern);
  };
  return { search };
};
