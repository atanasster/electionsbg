import { CommandGroup, CommandItem } from "@/components/ui/command";
import { SearchIndexType } from "@/data/search/useSearchItems";
import { cn, initials } from "@/lib/utils";
import { FuseResult, FuseResultMatch } from "fuse.js";
import { FC, ReactNode, useContext } from "react";
import { useTranslation } from "react-i18next";
import { SearchContext } from "./SearchContext";
import { Building2, MapPin, Map, Vote } from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";

type ItemType = SearchIndexType["type"];

const TYPE_ORDER: ItemType[] = ["s", "m", "r", "c", "a"];

const TYPE_ICON: Record<Exclude<ItemType, "a">, FC<{ className?: string }>> = {
  s: MapPin,
  m: Building2,
  r: Map,
  c: Vote,
};

const Highlight: FC<{
  text: string;
  match?: FuseResultMatch;
}> = ({ text, match }) => {
  const indices = match?.indices;
  if (!indices || indices.length === 0) return <>{text}</>;
  const sorted = [...indices]
    .filter(([s, e]) => e - s >= 1)
    .sort((a, b) => a[0] - b[0]);
  const parts: ReactNode[] = [];
  let cursor = 0;
  sorted.forEach(([start, end], i) => {
    if (start >= text.length || start < cursor) return;
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(
      <span key={i} className="font-semibold text-primary">
        {text.slice(start, Math.min(end + 1, text.length))}
      </span>,
    );
    cursor = Math.min(end + 1, text.length);
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
};

export const SearchItems: FC<{
  onSelect: (item: FuseResult<SearchIndexType>) => void;
}> = ({ onSelect }) => {
  const { t, i18n } = useTranslation();
  const { selected, items, searchTerm } = useContext(SearchContext);

  const typeLabel = (type: ItemType) => {
    switch (type) {
      case "r":
        return t("region");
      case "c":
        return t("section");
      case "m":
        return t("municipality");
      case "s":
        return t("settlement");
      case "a":
        return t("candidate");
    }
  };

  const grouped = items.reduce<Record<ItemType, FuseResult<SearchIndexType>[]>>(
    (acc, r) => {
      (acc[r.item.type] ||= []).push(r);
      return acc;
    },
    {} as Record<ItemType, FuseResult<SearchIndexType>[]>,
  );

  const isBg = i18n.language === "bg";

  return (
    <>
      {TYPE_ORDER.filter((type) => grouped[type]?.length).map((type) => {
        const Icon = type === "a" ? null : TYPE_ICON[type];
        return (
          <CommandGroup key={type} heading={typeLabel(type)}>
            {grouped[type].map((r) => {
              const displayName = isBg
                ? r.item.name
                : r.item.name_en || r.item.name;
              const matchKey = isBg
                ? "name"
                : r.item.name_en
                  ? "name_en"
                  : "name";
              const match = r.matches?.find((m) => m.key === matchKey);
              const sectionNameMatch = r.matches?.find(
                (m) => m.key === "name",
              );
              const sectionSettlementMatch = r.matches?.find(
                (m) => m.key === "name_en",
              );
              const parent =
                r.item.type === "c"
                  ? r.item.name_en
                  : isBg
                    ? r.item.parentName
                    : r.item.parentName_en || r.item.parentName;
              return (
                <CommandItem
                  key={`${r.item.type}-${r.item.key}`}
                  value={searchTerm}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                  }}
                  onMouseUp={() => onSelect(r)}
                  className={cn(
                    "flex w-full text-popover-foreground items-start gap-2.5 cursor-pointer hover:bg-muted py-1.5 px-2 rounded-sm",
                    selected?.refIndex === r.refIndex ? "bg-muted" : "",
                  )}
                >
                  {r.item.type === "a" ? (
                    <Avatar className="h-6 w-6 mt-0.5">
                      {r.item.photoUrl && (
                        <AvatarImage
                          src={r.item.photoUrl}
                          alt={r.item.name}
                          className="object-cover"
                        />
                      )}
                      <AvatarFallback className="text-[9px] font-semibold text-muted-foreground">
                        {initials(r.item.name)}
                      </AvatarFallback>
                    </Avatar>
                  ) : (
                    Icon && (
                      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    )
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">
                      {r.item.type === "c" ? (
                        <>
                          <Highlight
                            text={r.item.name}
                            match={sectionNameMatch}
                          />{" "}
                          <span className="text-muted-foreground">
                            <Highlight
                              text={r.item.name_en || ""}
                              match={sectionSettlementMatch}
                            />
                          </span>
                        </>
                      ) : (
                        <Highlight text={displayName} match={match} />
                      )}
                    </div>
                    {parent && r.item.type !== "c" && (
                      <div className="truncate text-xs text-muted-foreground">
                        {parent}
                      </div>
                    )}
                  </div>
                </CommandItem>
              );
            })}
          </CommandGroup>
        );
      })}
    </>
  );
};
