import { SearchIndexType, useSearchItems } from "@/data/search/useSearchItems";
import { FuseResult } from "fuse.js";
import {
  createContext,
  FC,
  PropsWithChildren,
  useCallback,
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

// Heavy implementation — calls useSearchItems which pulls the search index.
// Only mounted after the user activates the bar, so direct-entry pages like
// /governance pay zero cost when search isn't used.
const ActivatedSearchProvider: FC<PropsWithChildren> = ({ children }) => {
  const { search } = useSearchItems();
  const [term, setTerm] = useState("");
  const [searchItems, setSearchItems] = useState<SearchItemType[]>([]);
  const [selected, setSelected] = useState<number>(-1);
  const setSearchTerm = useCallback(
    (searchTerm: string) => {
      if (searchTerm && searchTerm.length > 0) {
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
        };
        const PER_TYPE_LIMIT = 5;
        const counts: Partial<Record<SearchIndexType["type"], number>> = {};
        const filtered =
          search(searchTerm)?.filter(
            (r) => (r.score || 1) <= (r.item.type === "a" ? 0.4 : 0.1),
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
            const g = groupOrder[a.r.item.type] - groupOrder[b.r.item.type];
            return g !== 0 ? g : a.i - b.i;
          })
          .map(({ r }) => r);
        setSearchItems(newItems);
        // Track search in Google Analytics
        trackSearch(searchTerm, newItems.length);
        if (selectedItem) {
          const newIndex = newItems.findIndex(
            (n) =>
              n.item.key === selectedItem.item.key &&
              n.item.type === selectedItem.item.type,
          );
          setSelected(newIndex);
        } else setSelected(-1);
      } else {
        setSearchItems([]);
      }
      setTerm(searchTerm);
    },
    [search, searchItems, selected],
  );
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
        activate: () => {},
      }}
    >
      {children}
    </SearchContext.Provider>
  );
};

// Lightweight stub — no data hooks, no fetches. setSearchTerm and activate
// both flip the activation flag and the parent mounts the heavy provider on
// the next render. Until then this is what every page in the app sees.
const InactiveSearchProvider: FC<
  PropsWithChildren<{ onActivate: () => void }>
> = ({ children, onActivate }) => (
  <SearchContext.Provider
    value={{
      arrowDown: () => {},
      arrowUp: () => {},
      items: [],
      setSelected: () => {},
      setSearchTerm: (term) => {
        if (term && term.length > 0) onActivate();
      },
      activate: onActivate,
    }}
  >
    {children}
  </SearchContext.Provider>
);

export const SearchContextProvider: FC<PropsWithChildren> = ({ children }) => {
  const [activated, setActivated] = useState(false);
  const activate = useCallback(() => setActivated(true), []);
  if (!activated) {
    return (
      <InactiveSearchProvider onActivate={activate}>
        {children}
      </InactiveSearchProvider>
    );
  }
  return <ActivatedSearchProvider>{children}</ActivatedSearchProvider>;
};
