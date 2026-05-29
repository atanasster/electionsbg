import { SearchIndexType, useSearchItems } from "@/data/search/useSearchItems";
import { FuseResult } from "fuse.js";
import {
  createContext,
  FC,
  PropsWithChildren,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { trackSearch } from "@/lib/analytics";

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
  const [selected, setSelected] = useState<number>(-1);

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
      const groupOrder: Record<SearchIndexType["type"], number> = {
        s: 0,
        m: 1,
        r: 2,
        c: 3,
        a: 4,
        o: 4.5,
        b: 5,
        v: 6,
      };
      const PER_TYPE_LIMIT = 5;
      const counts: Partial<Record<SearchIndexType["type"], number>> = {};
      const filtered =
        search(searchTerm)?.filter((r) => {
          // Per-type fuzziness budget. Candidate names, ministry names and
          // vote titles are typically searched by a partial keyword
          // ("отбран" → Defence ministry, "Радев" → Radev, "корупция" → an
          // anti-corruption bill), so they get a looser threshold than
          // settlements/sections where the user usually types an exact name.
          // Municipal officials (type "o") share the name-search loose
          // threshold with candidates / MPs — users type partial names.
          const limit =
            r.item.type === "a" ||
            r.item.type === "b" ||
            r.item.type === "v" ||
            r.item.type === "o"
              ? 0.4
              : 0.1;
          return (r.score || 1) <= limit;
        }) || [];
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
          const g = groupOrder[a.r.item.type] - groupOrder[b.r.item.type];
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
    const newIndex = selected < searchItems.length - 1 ? selected + 1 : 0;
    setSelected(newIndex);
  };
  const arrowUp = () => {
    const newIndex = selected > 0 ? selected - 1 : searchItems.length - 1;
    setSelected(newIndex);
  };

  const getSelectedItem = useCallback(() => {
    return selected >= 0 && selected < searchItems.length
      ? searchItems[selected]
      : undefined;
  }, [searchItems, selected]);

  return (
    <SearchContext.Provider
      value={{
        arrowDown,
        arrowUp,
        setSearchTerm,
        items: searchItems,
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
