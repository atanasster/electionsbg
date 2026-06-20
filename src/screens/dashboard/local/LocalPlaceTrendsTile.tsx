// Per-place cross-cycle trend tiles for the settlement and район dashboards:
//   - council party share across cycles (reuses LocalCrossCycleChart), and
//   - the majoritarian mayoral winner per cycle (a compact strip), since a
//     mayor race resolves to one winner, not a share trend.
//
// All inputs come from the precomputed place-trends artifact
// (useLocalPlaceTrendsFile → PlaceTrend). Each piece self-hides when it lacks
// two cycles of signal, so callers can mount it unconditionally.

import { FC, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Crown } from "lucide-react";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { UNRESOLVED_PARTY_COLOR } from "@/data/local/cycleDate";
import {
  placeCouncilToCrossCycle,
  usePlaceCouncilResolver,
} from "@/data/local/useLocalPlaceTrends";
import type {
  PlaceMayorWinner,
  PlaceTrend,
  PlaceTrendFile,
} from "@/data/local/placeTrendsTypes";
import { formatThousands } from "@/data/utils";
import { titleCaseName } from "@/lib/utils";
import { LocalCrossCycleChart } from "./LocalCrossCycleChart";
import { StatCard } from "../StatCard";

// Compact "who won the mayoral race here, each cycle" strip. Newest first, to
// match the LocalMayorTimelineTile ordering. Self-hides under two cycles.
const MayorWinnerStrip: FC<{
  winners?: PlaceMayorWinner[];
  title: ReactNode;
  hint?: string;
  className?: string;
}> = ({ winners, title, hint, className }) => {
  const { t } = useTranslation();
  const { colorFor } = useCanonicalParties();
  if (!winners || winners.length < 2) return null;
  const rows = [...winners].reverse();
  return (
    <StatCard
      className={className}
      label={
        <div className="flex items-center gap-2">
          <Crown className="h-4 w-4" />
          <span>{title}</span>
        </div>
      }
      hint={hint}
    >
      <ul className="mt-1 flex flex-col divide-y">
        {rows.map((w) => {
          const color = w.canonicalId
            ? (colorFor(w.canonicalId) ?? UNRESOLVED_PARTY_COLOR)
            : UNRESOLVED_PARTY_COLOR;
          return (
            <li
              key={w.cycle}
              className="flex items-center gap-2.5 py-2 min-w-0"
            >
              <span className="text-[11px] tabular-nums text-muted-foreground w-9 shrink-0">
                {w.year}
              </span>
              <MpAvatar name={w.candidateName} showPartyRing={false} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">
                  {w.candidateName
                    ? titleCaseName(w.candidateName)
                    : w.localPartyName}
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground min-w-0">
                  <span
                    aria-hidden
                    className="inline-block size-2 rounded-full shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <span className="truncate" title={w.localPartyName}>
                    {w.localPartyName}
                  </span>
                </div>
              </div>
              <span className="text-right tabular-nums shrink-0">
                <span className="text-sm font-medium">{w.pct.toFixed(1)}%</span>
                <span className="block text-[11px] text-muted-foreground">
                  {t("local_election_ballot_votes", {
                    votes: formatThousands(w.votes),
                  })}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </StatCard>
  );
};

type Props = {
  trend?: PlaceTrend;
  cyclesAsc: PlaceTrendFile["cyclesAsc"];
  councilTitle: ReactNode;
  councilHint?: string;
  mayorTitle: ReactNode;
  mayorHint?: string;
  rayonMayorTitle?: ReactNode;
  rayonMayorHint?: string;
  className?: string;
};

export const LocalPlaceTrendsTile: FC<Props> = ({
  trend,
  cyclesAsc,
  councilTitle,
  councilHint,
  mayorTitle,
  mayorHint,
  rayonMayorTitle,
  rayonMayorHint,
  className,
}) => {
  const resolve = usePlaceCouncilResolver();
  const council = placeCouncilToCrossCycle(trend, cyclesAsc, resolve, 6);
  return (
    <div className={className}>
      <LocalCrossCycleChart
        data={council}
        title={councilTitle}
        hint={councilHint}
      />
      <MayorWinnerStrip
        winners={trend?.mayor}
        title={mayorTitle}
        hint={mayorHint}
        className={council ? "mt-4" : undefined}
      />
      {rayonMayorTitle ? (
        <MayorWinnerStrip
          winners={trend?.rayonMayor}
          title={rayonMayorTitle}
          hint={rayonMayorHint}
          className="mt-4"
        />
      ) : null}
    </div>
  );
};
