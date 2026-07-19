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
import { SOFIA_CITY_GOVERNANCE_ID } from "@/data/local/placeViews";
import { buildPlaceItems } from "./placeSearchItems";
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
    // Set by the build when the official resolves to exactly one public person in the
    // unified person layer; the row then links to /person/<personSlug>. Candidate-
    // duplicate rows are dropped at build time, so a person never appears twice.
    personSlug?: string;
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
  // s=settlement, m=municipality, d=район (admin district of a община с
  //   районно деление — Sofia's 24 S2xxx shards; labelled "район" not "община"),
  // r=region, c=section, a=candidate/MP,
  // b=budget unit (ministry / spending unit on /budget/ministry/:id),
  // v=roll-call vote item (key = "${date}|${slug}"),
  // o=municipal official (mayor / chair / deputy mayor / councillor /
  //   chief architect — from data/officials/municipal/. Key is the slug
  //   used at /officials/<slug>.)
  // p=unified person (live /api/db/person-lookup — covers everyone with a
  //   /person/<slug> page: former MPs, magistrates, NGO boards, DS, etc. that
  //   the static per-election candidate index can't hold). Key = person slug.
  type: "s" | "m" | "d" | "r" | "c" | "a" | "b" | "v" | "o" | "p";
  key: string;
  name: string;
  name_en?: string;
  parentName?: string;
  parentName_en?: string;
  // Explicit navigation target. When set, the search picks this path verbatim
  // instead of deriving one from `type` + `key` (used for the synthetic
  // София / Столична община entries that don't map to a /<type>/<key> route).
  path?: string;
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
      // Settlements + municipalities (Sofia's S2xxx shards surfaced as "район")
      // come from the shared builder; this fat index then adds sections,
      // regions, candidates, budget units, officials, votes and the synthetic
      // city rows below.
      const searchItems: SearchIndexType[] = buildPlaceItems(
        settlements,
        municipalities,
        regions,
      );
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
      regions.forEach((r) => {
        searchItems.push({
          type: "r",
          key: r.oblast,
          name: r.name,
          name_en: r.name_en,
        });
      });

      // София / Столична община have no plain entry in the trees above — the
      // city fans across МИР 23/24/25 (no single oblast/settlement row) and
      // Столична община is split into the 24 S2xxx район shards (no unified
      // "Столична" município). Both queries returned nothing. Two synthetic
      // rows fix that, with explicit paths since neither maps to a
      // /<type>/<key> route. The "(София)" on the município lets a "София"
      // query surface Столична община too.
      searchItems.push({
        type: "s",
        key: "sofia-city",
        name: "София",
        name_en: "Sofia",
        parentName: "Столична община",
        parentName_en: "Stolichna municipality",
        path: "/sofia",
      });
      searchItems.push({
        type: "m",
        key: SOFIA_CITY_GOVERNANCE_ID,
        name: "Столична община (София)",
        name_en: "Stolichna (Sofia) municipality",
        parentName: "София-град",
        parentName_en: "Sofia-grad",
        path: `/governance/${SOFIA_CITY_GOVERNANCE_ID}`,
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
            // When the person layer resolved this official to a single public person,
            // link to their unified /person profile instead of the /officials/<slug> page.
            ...(e.personSlug ? { path: `/person/${e.personSlug}` } : {}),
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
