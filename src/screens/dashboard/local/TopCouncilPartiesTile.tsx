// Compact council-party leaderboard for one município — the local-elections
// counterpart of the parliamentary PartyResultsTile, but with a seats column
// (mandatesWon) in place of the change delta, since prior-cycle deltas aren't
// carried on the município bundle. Sits beside the council section map; a "see
// full results" toggle reveals the full party-by-party table (with expandable
// elected-councillor lists) owned by the parent.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Trophy } from "lucide-react";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { formatThousands } from "@/data/utils";
import { Hint } from "@/ux/Hint";
import { Link } from "@/ux/Link";
import { StatCard } from "../StatCard";
import type { LocalCouncilParty } from "@/data/local/types";

const NEUTRAL = "#9ca3af";
const TOP_N = 8;

export const TopCouncilPartiesTile: FC<{
  council: LocalCouncilParty[];
  // Full council-results page; the map + tile is the at-a-glance view.
  to: string;
}> = ({ council, to }) => {
  const { t } = useTranslation();
  const { colorFor } = useCanonicalParties();

  const rows = useMemo(() => {
    const sorted = [...council].sort((a, b) => {
      if (b.mandatesWon !== a.mandatesWon) return b.mandatesWon - a.mandatesWon;
      return b.totalVotes - a.totalVotes;
    });
    const maxVotes = Math.max(1, ...sorted.map((p) => p.totalVotes));
    return sorted.slice(0, TOP_N).map((p) => ({
      party: p,
      barPct: (p.totalVotes / maxVotes) * 100,
      color: p.primaryCanonicalId
        ? colorFor(p.primaryCanonicalId) || NEUTRAL
        : NEUTRAL,
    }));
  }, [council, colorFor]);

  if (rows.length === 0) return null;

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full">
          <Hint text={t("local_council_parties_hint")} underline={false}>
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4" />
              <span>{t("local_council_parties_title")}</span>
            </div>
          </Hint>
          <Link
            to={to}
            underline={false}
            className="text-[10px] normal-case text-primary hover:underline"
          >
            {t("local_see_full_results")} →
          </Link>
        </div>
      }
      className="overflow-hidden"
    >
      <div className="flex flex-col gap-2.5 mt-1">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(60px,1.2fr)_auto_auto] gap-x-3 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          <span>{t("dashboard_party")}</span>
          <span className="text-right">{t("votes")}</span>
          <span>{t("dashboard_share")}</span>
          <span className="text-right">{t("local_election_th_pct")}</span>
          <span className="text-right">{t("local_election_th_seats")}</span>
        </div>
        {rows.map(({ party, barPct, color }) => (
          <div
            key={party.localPartyNum}
            className="grid grid-cols-[minmax(0,1fr)_auto_minmax(60px,1.2fr)_auto_auto] gap-x-3 items-center text-sm"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: color }}
              />
              <span
                className="truncate font-medium"
                title={party.localPartyName}
              >
                {party.localPartyName}
              </span>
            </div>
            <span className="tabular-nums text-xs text-muted-foreground text-right">
              {formatThousands(party.totalVotes)}
            </span>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(2, barPct)}%`,
                  backgroundColor: color,
                }}
              />
            </div>
            <span className="tabular-nums text-xs font-semibold text-right">
              {party.pctOfValid.toFixed(2)}%
            </span>
            <span className="tabular-nums text-xs font-semibold text-right w-6">
              {party.mandatesWon}
            </span>
          </div>
        ))}
      </div>
    </StatCard>
  );
};
