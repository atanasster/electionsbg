// Coloured party-group chip. Resolves a short parliament-group label
// (e.g. "ПГ на ГЕРБ-СДС") to its display label + colour via
// `useParliamentGroups`. Renders as a Link to the CIK party page when the
// group maps to a canonical CIK party, otherwise plain text.

import { FC } from "react";
import { Link } from "@/ux/Link";
import { useParliamentGroups } from "@/data/parliament/useParliamentGroups";

export const PartyTag: FC<{ partyShort?: string | null }> = ({
  partyShort,
}) => {
  const { colorForPartyShort, labelForPartyShort, nickNameForPartyShort } =
    useParliamentGroups();
  if (!partyShort) return null;
  const color = colorForPartyShort(partyShort);
  const label = labelForPartyShort(partyShort) || partyShort;
  const nickName = nickNameForPartyShort(partyShort);
  const tag = (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap"
      style={
        color
          ? { backgroundColor: color, color: "rgba(255,255,255,0.95)" }
          : {
              backgroundColor: "transparent",
              color: "var(--muted-foreground)",
              border: "1px solid hsl(var(--border))",
            }
      }
    >
      {label}
    </span>
  );
  if (!nickName) return tag;
  return (
    <Link to={`/party/${nickName}`} underline={false}>
      {tag}
    </Link>
  );
};
