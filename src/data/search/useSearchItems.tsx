import { useMemo } from "react";
import { useSettlementsInfo } from "../settlements/useSettlements";
import Fuse from "fuse.js";
import { useMunicipalities } from "../municipalities/useMunicipalities";
import { useRegions } from "../regions/useRegions";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { SectionIndex } from "../dataTypes";
import { useElectionContext } from "../ElectionContext";
import { useCikGroups } from "@/data/candidates/useResolvedCandidate";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { dataUrl } from "@/data/dataUrl";
import { transliterateName } from "@/data/candidates/transliterateName";
import { SEARCH_FUSE_OPTIONS } from "./searchConfig";
import type { SearchVoteIndexFile } from "../parliament/votes/types";

// Slim municipal-officials roster for search — built by
// scripts/officials/build_municipal_search.ts. ~915 KB raw → ~200 KB gz.
// Lazy-fetched alongside the other heavy search indexes; React Query
// caches forever.
type MunicipalSearchFile = {
  entries: Array<{
    slug: string;
    name: string;
    role: string;
    municipality: string;
    district?: string;
  }>;
};

const fetchMunicipalSearch = async (): Promise<MunicipalSearchFile | null> => {
  try {
    const r = await fetch(dataUrl("/officials/municipal/search_index.json"));
    if (!r.ok) return null;
    return (await r.json()) as MunicipalSearchFile;
  } catch {
    return null;
  }
};

const useMunicipalSearchIndex = () =>
  useQuery({
    queryKey: ["search", "municipal-officials"] as const,
    queryFn: fetchMunicipalSearch,
    staleTime: Infinity,
  });

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

// Slim per-NS search projection emitted by the derived runner. ~80 KB
// gzipped vs. the ~580 KB topic_index.json that the header used to pull
// on every page. The ranking + per-NS cap (most-contested titled items
// first, newest-first as a tiebreaker, top-N) is baked in at build time
// — see scripts/parliament/derived/search_index.ts.
const fetchSearchVoteIndex = async (): Promise<SearchVoteIndexFile | null> => {
  try {
    const r = await fetch(
      dataUrl("/parliament/votes/derived/search_index.json"),
    );
    if (!r.ok) return null;
    return (await r.json()) as SearchVoteIndexFile;
  } catch {
    return null;
  }
};

const useSearchVoteIndex = () =>
  useQuery({
    queryKey: ["search", "vote-index"] as const,
    queryFn: fetchSearchVoteIndex,
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
  // b=budget unit (ministry / spending unit on /budget/ministry/:id),
  // v=roll-call vote item (key = "${date}|${slug}"),
  // o=municipal official (mayor / chair / deputy mayor / councillor /
  //   chief architect — from data/officials/municipal/. Key is the slug
  //   used at /officials/<slug>.)
  type: "s" | "m" | "r" | "c" | "a" | "b" | "v" | "o";
  key: string;
  name: string;
  name_en?: string;
  parentName?: string;
  parentName_en?: string;
  photoUrl?: string;
  // candidate (type "a") only: the party label + colour, so namesakes are
  // told apart in the dropdown (display-only — not a Fuse search key).
  party?: string;
  partyColor?: string;
};
export const useSearchItems = () => {
  const { selected } = useElectionContext();
  const { data: sections } = useQuery({
    queryKey: ["sections_index", selected],
    queryFn,
  });
  const { settlements } = useSettlementsInfo();
  const { municipalities } = useMunicipalities();
  // Resolved (name, partyNum) buckets — one per distinct person, each with an
  // unambiguous slug so a dropdown pick lands on the right candidate page (no
  // namesake chooser). Plus party lookups for the dropdown badge.
  const cikGroups = useCikGroups();
  const { findParty } = usePartyInfo();
  const { displayNameFor } = useCanonicalParties();
  const { regions } = useRegions();
  const { data: adminFlow } = useBudgetMinistriesForSearch();
  const { data: voteIndex } = useSearchVoteIndex();
  const { data: municipalOfficials } = useMunicipalSearchIndex();
  const fuse = useMemo(() => {
    if (settlements && municipalities && sections) {
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
      // Candidates / MPs — one entry per DISTINCT PERSON (a (name, partyNum)
      // bucket), keyed by its unambiguous slug (mp-… / c-…) so picking from the
      // dropdown lands straight on that candidate's page rather than a bare-name
      // URL that re-opens the namesake chooser. The party label + colour tell
      // namesakes apart inline. name_en already prefers the matched MP's
      // canonical (parliament.bg) spelling. Most-районs-first so a prominent
      // candidate wins a score tie. Optional — appears once the roster loads.
      if (cikGroups) {
        [...cikGroups]
          .sort((a, b) => b.oblasts.length - a.oblasts.length)
          .forEach((g) => {
            const party =
              g.partyNum != null ? findParty(g.partyNum) : undefined;
            const partyLabel = party
              ? (displayNameFor(party.nickName) ?? party.nickName ?? party.name)
              : undefined;
            searchItems.push({
              type: "a",
              key: g.slug,
              name: g.name,
              name_en: g.name_en,
              photoUrl: g.mpEntry?.photoUrl ?? undefined,
              party: partyLabel,
              partyColor: party?.color,
            });
          });
      }

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

      // Municipal officials — cacbg roster (mayors / chairs / deputy
      // mayors / councillors / chief architects). The slim search file
      // carries the {slug, name, role, municipality} projection only;
      // the parentName surfaces the município so two homonymous
      // councillors in different общини can be told apart in the
      // dropdown.
      if (municipalOfficials?.entries) {
        for (const e of municipalOfficials.entries) {
          searchItems.push({
            type: "o",
            key: e.slug,
            name: e.name,
            // The cacbg roster is Cyrillic-only, so we romanize the name with
            // the same Streamlined Romanization the candidate pages use. Without
            // this, a Latin-script query ("Terziev") missed officials entirely
            // while every other type was Latin-searchable via name_en.
            name_en: transliterateName(e.name),
            parentName: e.municipality,
            parentName_en: e.municipality,
          });
        }
      }

      // Roll-call vote items. Per-NS ranking + cap already applied at build
      // time by scripts/parliament/derived/search_index.ts — we just flatten
      // every slice into the searchItems list.
      if (voteIndex?.byNs) {
        for (const slice of Object.values(voteIndex.byNs)) {
          for (const e of slice.entries) {
            searchItems.push({
              type: "v",
              key: `${e.date}|${e.slug}`,
              name: e.title,
              parentName: e.date,
            });
          }
        }
      }

      // Options live in ./searchConfig (shared with the regression harness) so
      // the live index and its test never drift. ignoreLocation lets a match sit
      // anywhere; per-type score limits in SearchContext keep noise out.
      return new Fuse<SearchIndexType>(
        searchItems,
        SEARCH_FUSE_OPTIONS as ConstructorParameters<
          typeof Fuse<SearchIndexType>
        >[1],
      );
    }
    return undefined;
  }, [
    adminFlow,
    cikGroups,
    displayNameFor,
    findParty,
    municipalities,
    municipalOfficials,
    regions,
    sections,
    settlements,
    voteIndex,
  ]);
  const search = (searchTern: string) => {
    return fuse?.search(searchTern);
  };
  return { search };
};
