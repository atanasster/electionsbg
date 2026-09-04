import { CommandGroup, CommandItem } from "@/components/ui/command";
import { SearchIndexType } from "@/data/search/useSearchItems";
import { TYPE_ORDER } from "@/data/search/searchConfig";
import { cn, initials } from "@/lib/utils";
import { FuseResult, FuseResultMatch } from "fuse.js";
import { FC, ReactNode, useContext } from "react";
import { useTranslation } from "react-i18next";
import { SearchContext } from "./SearchContext";
import {
  Building2,
  MapPin,
  MapPinned,
  Map,
  Vote,
  Landmark,
  Gavel,
  Users,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { PartyBadge } from "@/screens/components/PartyBadge";
import { roleSubtitle } from "@/screens/components/search/personSearchSource";
import { toRoleSubtitleInput } from "@/data/search/personOffice";
import { usePersonLabels } from "@/lib/personLabels";

type ItemType = SearchIndexType["type"];

// "p" (person) renders an avatar, not an icon.
const TYPE_ICON: Record<Exclude<ItemType, "p">, FC<{ className?: string }>> = {
  s: MapPin,
  m: Building2,
  d: MapPinned,
  r: Map,
  c: Vote,
  b: Landmark,
  v: Gavel,
  o: Users,
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
  // Localizes a `person_role.role` code for the person subtitle below. Memoized on `t`, so
  // it does not churn per keystroke.
  const { roleLabel } = usePersonLabels();

  const typeLabel = (type: ItemType) => {
    switch (type) {
      case "r":
        return t("region");
      case "c":
        return t("section");
      case "m":
        return t("municipality");
      case "d":
        return t("rayon");
      case "s":
        return t("settlement");
      case "o":
        return t("search_group_municipal_officials") || "Municipal officials";
      case "p":
        return t("search_group_persons") || "People";
      case "b":
        return t("budget_search_ministries") || "Ministries";
      case "v":
        return t("votes_search_group") || "Roll-call votes";
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
        const Icon = type === "p" ? null : TYPE_ICON[type];
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
              const sectionNameMatch = r.matches?.find((m) => m.key === "name");
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
                  {r.item.type === "p" ? (
                    r.item.mpId != null ? (
                      <MpAvatar
                        mpId={r.item.mpId}
                        name={r.item.name}
                        className="mt-0.5 h-6 w-6"
                      />
                    ) : (
                      <Avatar className="h-6 w-6 mt-0.5">
                        <AvatarFallback className="text-[9px] font-semibold text-muted-foreground">
                          {initials(r.item.name)}
                        </AvatarFallback>
                      </Avatar>
                    )
                  ) : (
                    Icon && (
                      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    )
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-sm">
                      <span className="truncate">
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
                      </span>
                    </div>
                    {/* Party badge sits under the name, mirroring how the
                        municipal official's location is shown below. */}
                    {r.item.type === "p" && r.item.party && (
                      <div>
                        <PartyBadge
                          label={r.item.party}
                          color={r.item.partyColor}
                          className="px-1.5 text-[10px] font-medium"
                        />
                      </div>
                    )}
                    {/* „Кандидат · София 24 МИР" — the office + place, WITHOUT which two
                        same-named people in one party render as two identical rows and the
                        reader cannot tell a real namesake from a bug.

                        ⚠️ `roleSubtitle` is the home finder's helper, reused rather than
                        reimplemented: the two surfaces must not name different offices for
                        one person. `toRoleSubtitleInput` is the snake_case + language bridge
                        it needs, and it lives in its own module beside its twin so a field
                        cannot be added to the payload map and forgotten here.

                        `title` because the dropdown is a fixed 360px: 248 of 63,844 subtitles
                        clip, the longest at 76 characters („…при Окръжна прокур…"), which
                        removes the seat. No namesake pair currently shares its first 48
                        characters, so nothing is ambiguous today — this is so the corpus
                        cannot grow into it silently. */}
                    {r.item.type === "p" &&
                      (() => {
                        const meta = roleSubtitle(
                          toRoleSubtitleInput(r.item, isBg),
                          isBg,
                          roleLabel,
                        );
                        return meta ? (
                          <div
                            data-testid="person-meta"
                            title={meta}
                            className="truncate text-xs text-muted-foreground"
                          >
                            {meta}
                          </div>
                        ) : null;
                      })()}
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
