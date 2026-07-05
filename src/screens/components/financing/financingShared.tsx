import { FC } from "react";
import { PartyInfo } from "@/data/dataTypes";
import { Link } from "@/ux/Link";
import { partyHref } from "@/lib/utils";
import { SOURCE_COLOR, SOURCE_KEYS, SourceKey } from "./financingConstants";

// Compact party chip: colour dot + acronym, links to the party page.
export const PartyChip: FC<{ party?: PartyInfo; className?: string }> = ({
  party,
  className,
}) => {
  if (!party) return null;
  const chip = (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium ${className ?? ""}`}
    >
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: party.color || "#888" }}
      />
      {party.nickName}
    </span>
  );
  return (
    <Link
      to={partyHref(party.nickName)}
      underline={false}
      className="hover:underline"
    >
      {chip}
    </Link>
  );
};

// Shared legend for the four income sources.
export const SourceLegend: FC<{ labels: Record<SourceKey, string> }> = ({
  labels,
}) => (
  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
    {SOURCE_KEYS.map((k) => (
      <span key={k} className="inline-flex items-center gap-1.5">
        <span
          className="h-2.5 w-2.5 rounded-sm"
          style={{ backgroundColor: SOURCE_COLOR[k] }}
        />
        {labels[k]}
      </span>
    ))}
  </div>
);
