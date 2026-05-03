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
};
// eslint-disable-next-line react-refresh/only-export-components
export const SearchContext = createContext<SearchContextType>({
  arrowDown: () => {},
  arrowUp: () => {},
  items: [],
  setSearchTerm: () => {},
  setSelected: () => {},
});
export const SearchContextProvider: FC<PropsWithChildren> = ({ children }) => {
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
      }}
    >
      {children}
    </SearchContext.Provider>
  );
};
