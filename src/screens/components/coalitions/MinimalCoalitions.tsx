import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { PartyInfo } from "@/data/dataTypes";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import {
  findMinimalCoalitions,
  MAJORITY_SEATS,
  SeatRow,
} from "@/screens/utils/seatAllocation";

type Props = {
  rows: SeatRow[];
  findParty: (n: number) => PartyInfo | undefined;
  maxResults?: number;
  maxSize?: number;
};

export const MinimalCoalitions: FC<Props> = ({
  rows,
  findParty,
  maxResults,
  maxSize = 4,
}) => {
  const { t } = useTranslation();
  const { displayNameFor } = useCanonicalParties();
  const coalitions = useMemo(
    () => findMinimalCoalitions(rows, MAJORITY_SEATS, maxSize),
    [rows, maxSize],
  );
  const visible = maxResults ? coalitions.slice(0, maxResults) : coalitions;
  if (visible.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("no_majority_possible")}
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {visible.map((c, idx) => {
        const margin = c.seats - MAJORITY_SEATS;
        return (
          <li
            key={idx}
            className="flex flex-wrap items-center gap-2 p-2 border rounded"
          >
            {c.partyNums.map((pn, i) => {
              const party = findParty(pn);
              const row = rows.find((r) => r.partyNum === pn);
              return (
                <span key={pn} className="flex items-center gap-1">
                  {i > 0 && <span className="text-muted-foreground">+</span>}
                  <span
                    className="inline-block w-3 h-3 rounded-sm"
                    style={{ backgroundColor: party?.color || "#888" }}
                  />
                  <span className="font-medium">
                    {(() => {
                      const nick = party?.nickName ?? row?.nickName;
                      if (!nick) return null;
                      return displayNameFor(nick) ?? nick;
                    })()}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    ({row?.seats})
                  </span>
                </span>
              );
            })}
            <span className="ml-auto tabular-nums font-semibold">
              = {c.seats}
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {margin >= 0 ? `+${margin}` : margin}
            </span>
          </li>
        );
      })}
    </ul>
  );
};
