import { SearchIndexType, useSearchItems } from "@/data/search/useSearchItems";
import { searchLimitForType, TYPE_ORDER } from "@/data/search/searchConfig";
import { FuseResult } from "fuse.js";
import {
  createContext,
  FC,
  PropsWithChildren,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { trackSearch } from "@/lib/analytics";

const norm = (s: string): string => s.trim().toLowerCase();

// Live people from the unified person layer (/api/db/person-lookup) — the SINGLE people
// surface in the header search (the former CIK-JSON candidate index is gone; candidates are
// persons now). Covers everyone with a /person/<slug> page: candidates from ANY cycle, former
// MPs, magistrates, NGO boards, DS people. `party`/`partyColor` = the person's most-recent
// candidacy party (badge); `mpId` drives the avatar photo. Rendered as `p` rows.
type PersonHit = {
  slug: string;
  name: string;
  score?: number;
  party?: string | null;
  partyColor?: string | null;
  mpId?: number | null;
};
const fetchPersons = async (q: string): Promise<PersonHit[]> => {
  try {
    const res = await fetch(
      `/api/db/person-lookup?q=${encodeURIComponent(q)}&limit=6`,
    );
    if (!res.ok) return [];
    const j = (await res.json()) as PersonHit[];
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
};

export type SearchItemType = FuseResult<SearchIndexType>;

type SearchContextType = {
  arrowDown: () => void;
  arrowUp: () => void;
  items: SearchItemType[];
  selected?: SearchItemType;
  setSelected: (index: number) => void;
  searchTerm?: string;
  setSearchTerm: (searchTerm: string) => void;
  // Call this when the user interacts with the search bar (focus, popover
  // open, keystroke) to mount the data-loading branch. Until then, the
  // search index (~2.7 MB of sections/settlements/candidates JSON) is
  // never fetched — the header search appears on every page, and most
  // pages don't need it.
  activate: () => void;
};
// eslint-disable-next-line react-refresh/only-export-components
export const SearchContext = createContext<SearchContextType>({
  arrowDown: () => {},
  arrowUp: () => {},
  items: [],
  setSearchTerm: () => {},
  setSelected: () => {},
  activate: () => {},
});

type SearchFn = (q: string) => FuseResult<SearchIndexType>[] | undefined;

// Numeric sort rank per type, derived from the single canonical TYPE_ORDER so
// arrow-nav/sort order can't drift from SearchItems' visual group order.
const GROUP_ORDER = Object.fromEntries(
  TYPE_ORDER.map((t, i) => [t, i]),
) as Record<SearchIndexType["type"], number>;

// Side-effect-only child that runs the heavy useSearchItems hook chain and
// reports the resulting search function back to the parent. Mounted only
// after activation — keeping the children of SearchContextProvider stable
// across the activation flip, so the input field and its focus/open state
// survive (previous design swapped two different wrapper component types
// here, which unmounted SearchInternal on first click and dropped focus).
const SearchDataLoader: FC<{ onSearchReady: (search: SearchFn) => void }> = ({
  onSearchReady,
}) => {
  const { search } = useSearchItems();
  useEffect(() => {
    onSearchReady(search);
  }, [search, onSearchReady]);
  return null;
};

export const SearchContextProvider: FC<PropsWithChildren> = ({ children }) => {
  const [activated, setActivated] = useState(false);
  const activate = useCallback(() => setActivated(true), []);

  const searchRef = useRef<SearchFn | undefined>(undefined);
  const [searchReady, setSearchReady] = useState(false);
  const onSearchReady = useCallback((search: SearchFn) => {
    searchRef.current = search;
    setSearchReady(true);
  }, []);

  const [term, setTerm] = useState("");
  const [searchItems, setSearchItems] = useState<SearchItemType[]>([]);
  const [personHits, setPersonHits] = useState<PersonHit[]>([]);
  const [selected, setSelected] = useState<number>(-1);

  // Debounced live person lookup — runs in parallel with the static Fuse search, so the
  // dropdown shows the (fast) static rows first and the person rows land ~200ms later.
  useEffect(() => {
    // Min 3 chars: person_search can't use its trigram index below a full trigram, so a 1-2
    // char query would seq-scan every person server-side (~150ms) for noise. Mirror the SQL
    // gate here so the keystroke never round-trips; the static index still answers at 2 chars.
    if (!term || term.length < 3) {
      setPersonHits([]);
      return;
    }
    let live = true;
    const h = setTimeout(() => {
      fetchPersons(term).then((hits) => live && setPersonHits(hits));
    }, 180);
    return () => {
      live = false;
      clearTimeout(h);
    };
  }, [term]);

  // Merge Fuse rows + person rows into ONE flat, group-sorted list (the whole pipeline —
  // render, arrow-nav, selection — runs off this). Person rows are deduped by name against the
  // static MUNICIPAL-OFFICIAL rows so an official who also resolves to a person isn't shown
  // twice (officials are the one static people surface left; candidates come only via `p`).
  const items = useMemo<SearchItemType[]>(() => {
    const staticNames = new Set(
      searchItems
        .filter((r) => r.item.type === "o")
        .map((r) => norm(r.item.name)),
    );
    const personItems: SearchItemType[] = personHits
      .filter((p) => !staticNames.has(norm(p.name)))
      .map((p) => ({
        item: {
          type: "p",
          key: p.slug,
          name: p.name,
          party: p.party ?? undefined,
          partyColor: p.partyColor ?? undefined,
          mpId: p.mpId ?? undefined,
        },
        refIndex: -1,
        score: 0,
      }));
    return [...searchItems, ...personItems]
      .map((r, i) => ({ r, i }))
      .sort((a, b) => {
        const g = GROUP_ORDER[a.r.item.type] - GROUP_ORDER[b.r.item.type];
        return g !== 0 ? g : a.i - b.i;
      })
      .map(({ r }, i) => ({ ...r, refIndex: i }));
  }, [searchItems, personHits]);

  const runSearch = useCallback(
    (searchTerm: string) => {
      const search = searchRef.current;
      if (!search) {
        // Index not loaded yet — keep the term, leave results empty so the
        // dropdown shows "no results" until the data lands. We'll re-run
        // automatically once the loader reports the search function.
        setSearchItems([]);
        return;
      }
      const selectedItem =
        selected >= 0 && selected < searchItems.length
          ? searchItems[selected]
          : undefined;
      const PER_TYPE_LIMIT = 5;
      const counts: Partial<Record<SearchIndexType["type"], number>> = {};
      const filtered =
        // Per-type fuzziness budget lives in searchConfig (shared with the
        // regression harness) — names loose (0.4), settlements/munis/regions
        // 0.2 to catch typos, sections tight (0.1).
        search(searchTerm)?.filter(
          (r) => (r.score || 1) <= searchLimitForType(r.item.type),
        ) || [];
      const limited: typeof filtered = [];
      for (const r of filtered) {
        const c = counts[r.item.type] || 0;
        if (c >= PER_TYPE_LIMIT) continue;
        counts[r.item.type] = c + 1;
        limited.push(r);
      }
      const newItems = limited
        .map((r, i) => ({ r, i }))
        .sort((a, b) => {
          const g = GROUP_ORDER[a.r.item.type] - GROUP_ORDER[b.r.item.type];
          return g !== 0 ? g : a.i - b.i;
        })
        .map(({ r }) => r);
      setSearchItems(newItems);
      trackSearch(searchTerm, newItems.length);
      if (selectedItem) {
        const newIndex = newItems.findIndex(
          (n) =>
            n.item.key === selectedItem.item.key &&
            n.item.type === selectedItem.item.type,
        );
        setSelected(newIndex);
      } else setSelected(-1);
    },
    [searchItems, selected],
  );

  const setSearchTerm = useCallback(
    (searchTerm: string) => {
      if (searchTerm && searchTerm.length > 0) {
        if (!activated) setActivated(true);
        runSearch(searchTerm);
      } else {
        setSearchItems([]);
      }
      setTerm(searchTerm);
    },
    [activated, runSearch],
  );

  // When the search function arrives after the user has already typed,
  // re-run the search so the dropdown populates without requiring another
  // keystroke.
  useEffect(() => {
    if (searchReady && term && term.length > 0 && searchItems.length === 0) {
      runSearch(term);
    }
    // Intentionally run only when searchReady flips — re-running on every
    // term change would double-fire alongside setSearchTerm.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchReady]);

  const arrowDown = () => {
    const newIndex = selected < items.length - 1 ? selected + 1 : 0;
    setSelected(newIndex);
  };
  const arrowUp = () => {
    const newIndex = selected > 0 ? selected - 1 : items.length - 1;
    setSelected(newIndex);
  };

  const getSelectedItem = useCallback(() => {
    return selected >= 0 && selected < items.length
      ? items[selected]
      : undefined;
  }, [items, selected]);

  return (
    <SearchContext.Provider
      value={{
        arrowDown,
        arrowUp,
        setSearchTerm,
        items,
        selected: getSelectedItem(),
        setSelected,
        searchTerm: term,
        activate,
      }}
    >
      {children}
      {activated && <SearchDataLoader onSearchReady={onSearchReady} />}
    </SearchContext.Provider>
  );
};
