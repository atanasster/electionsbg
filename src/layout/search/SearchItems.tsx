import { CommandGroup, CommandItem } from "@/components/ui/command";
import { SearchIndexType } from "@/data/search/useSearchItems";
import { cn } from "@/lib/utils";
import { FuseResult } from "fuse.js";
import { FC, useContext } from "react";
import { useTranslation } from "react-i18next";
import { SearchContext } from "./SearchContext";
import { Badge } from "@/components/ui/badge";
import { Hint } from "@/ux/Hint";

export const SearchItems: FC<{
  onSelect: (item: FuseResult<SearchIndexType>) => void;
}> = ({ onSelect }) => {
  const { t } = useTranslation();
  const itemType = (item: SearchIndexType) => {
    switch (item.type) {
      case "r":
        return t("region");
      case "c":
        return t("section");
      case "m":
        return t("municipality");
      case "s":
        return t("settlement");
    }
  };
  const itemLang = (item: SearchIndexType) => {
    if (i18n.language === "bg") {
      switch (item.type) {
        case "r":
          return "РГ";
        case "c":
          return "СК";
        case "m":
          return "ОБ";
        case "s":
          return "НМ";
      }
    } else {
      return item.type;
    }
  };
  const { selected, items, searchTerm } = useContext(SearchContext);
  const { i18n } = useTranslation();
  return (
    <CommandGroup>
      {items.map((r) => (
        <CommandItem
          key={r.item.key}
          value={searchTerm}
          onMouseDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
          }}
          onMouseUp={() => onSelect(r)}
          className={cn(
            "truncate flex w-full text-popover-foreground items-center gap-2 cursor-pointer hover:bg-muted py-0.5",
            selected?.refIndex === r.refIndex ? "bg-muted" : "",
          )}
        >
          <Hint text={itemType(r.item)}>
            <Badge className="w-10 ml-2 flex-col">
              {itemLang(r.item).toUpperCase()}
            </Badge>
          </Hint>
          {r.item.type !== "c" ? (
            <div>
              {`${i18n.language === "bg" ? r.item.name : r.item.name_en}`}
            </div>
          ) : (
            <div>{`${r.item.name} ${r.item.name_en}`}</div>
          )}
        </CommandItem>
      ))}
    </CommandGroup>
  );
};
