// Compact mayoral-candidate leaderboard for one município — the local-elections
// counterpart of the parliamentary PartyResultsTile (top parties). Sits beside
// the polling-section map at the top of the município page; a "see full results"
// toggle in the header reveals the authoritative full candidate table below
// (owned by the parent, which holds the expand state).

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Trophy } from "lucide-react";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { formatThousands } from "@/data/utils";
import { Hint } from "@/ux/Hint";
import { Link } from "@/ux/Link";
import { StatCard } from "../StatCard";
import type { LocalMayorResult } from "@/data/local/types";

const NEUTRAL = "#9ca3af";
const TOP_N = 6;

export const TopMayorsTile: FC<{
  candidates: LocalMayorResult[];
  // Resolved winner name (round-2 winner in a runoff). CIK marks both finalists
  // elected in round 1, so prefer this over each row's own isElected flag.
  electedName?: string | null;
  // Full mayoral-results page; the map + tile is the at-a-glance view.
  to: string;
}> = ({ candidates, electedName, to }) => {
  const { t } = useTranslation();
  const { colorFor } = useCanonicalParties();

  const rows = useMemo(() => {
    const sorted = [...candidates].sort((a, b) => b.votes - a.votes);
    const maxVotes = Math.max(1, ...sorted.map((c) => c.votes));
    return sorted.slice(0, TOP_N).map((c) => ({
      candidate: c,
      barPct: (c.votes / maxVotes) * 100,
      color: c.primaryCanonicalId
        ? colorFor(c.primaryCanonicalId) || NEUTRAL
        : NEUTRAL,
      isWinner: electedName ? c.candidateName === electedName : c.isElected,
    }));
  }, [candidates, colorFor, electedName]);

  if (rows.length === 0) return null;

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full">
          <Hint text={t("local_mayor_candidates_hint")} underline={false}>
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4" />
              <span>{t("local_mayor_candidates_title")}</span>
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
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(60px,1.2fr)_auto] gap-x-3 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          <span>{t("local_election_th_candidate")}</span>
          <span className="text-right">{t("votes")}</span>
          <span>{t("dashboard_share")}</span>
          <span className="text-right">{t("local_election_th_pct")}</span>
        </div>
        {rows.map(({ candidate, barPct, color, isWinner }) => (
          <div
            key={`${candidate.localPartyNum}-${candidate.candidateName}`}
            className="grid grid-cols-[minmax(0,1fr)_auto_minmax(60px,1.2fr)_auto] gap-x-3 items-center text-sm"
          >
            <div className="flex items-center gap-2 min-w-0">
              <MpAvatar
                name={candidate.candidateName}
                mpId={candidate.mpId}
                showPartyRing={false}
              />
              <span
                className="truncate font-medium"
                title={candidate.candidateName}
              >
                {candidate.candidateName}
              </span>
              {isWinner ? (
                <span className="inline-flex shrink-0 items-center rounded-md border border-primary/40 bg-primary/10 px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide text-primary">
                  {t("local_election_winner_badge")}
                </span>
              ) : null}
            </div>
            <span className="tabular-nums text-xs text-muted-foreground text-right">
              {formatThousands(candidate.votes)}
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
              {candidate.pctOfValid.toFixed(2)}%
            </span>
          </div>
        ))}
      </div>
    </StatCard>
  );
};
