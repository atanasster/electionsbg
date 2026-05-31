// Winner-party badge shared by the extraordinary-elections feed (/local/chmi)
// and the country-dashboard "extraordinary elections" tile, so both render the
// winner identically.
//
// When the winner maps to a canonical party that also ran in the selected
// election, show a solid colour chip with the party's short display name
// (linking to its party page). Otherwise fall back to a colour dot + the raw
// CIK coalition name — which can be long and all-caps straight from the source.

import { FC } from "react";
import { Link } from "@/ux/Link";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { useElectionContext } from "@/data/ElectionContext";
import { partyHref } from "@/lib/utils";
import { cn } from "@/lib/utils";

export const ChmiPartyBadge: FC<{
  primaryCanonicalId: string | null;
  localPartyName: string;
  className?: string;
}> = ({ primaryCanonicalId, localPartyName, className }) => {
  const { byId, displayNameForId } = useCanonicalParties();
  const { selected } = useElectionContext();

  const canonicalParty = primaryCanonicalId
    ? byId.get(primaryCanonicalId)
    : undefined;
  const partyForSelected = canonicalParty?.history.find(
    (h) => h.election === selected,
  );
  const chipLabel = primaryCanonicalId
    ? displayNameForId(primaryCanonicalId)
    : undefined;

  if (canonicalParty && partyForSelected && chipLabel) {
    return (
      <Link
        to={partyHref(partyForSelected.nickName)}
        underline={false}
        className={cn(
          "inline-flex items-center whitespace-nowrap rounded px-2 py-0.5 text-xs font-semibold",
          className,
        )}
        style={{
          backgroundColor: canonicalParty.color,
          color: "rgba(255,255,255,0.95)",
        }}
      >
        {chipLabel}
      </Link>
    );
  }

  return (
    <span
      className={cn("flex items-start gap-1.5", className)}
      title={localPartyName}
    >
      {canonicalParty ? (
        <span
          aria-hidden
          className="inline-block size-2 rounded-full ring-1 ring-border shrink-0 mt-1.5"
          style={{ backgroundColor: canonicalParty.color }}
        />
      ) : null}
      <span className="break-words">{localPartyName}</span>
    </span>
  );
};
