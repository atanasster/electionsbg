import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Vote } from "lucide-react";
import { useNationalSummary } from "@/data/dashboard/useNationalSummary";
import { useElectionContext } from "@/data/ElectionContext";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { useProblemSections } from "@/data/reports/useProblemSections";
import { SectionInfo } from "@/data/dataTypes";
import { formatPct, formatThousands, matchPartyNickName } from "@/data/utils";
import { Hint } from "@/ux/Hint";
import { StatCard } from "./StatCard";

const NATIONAL_THRESHOLD_PCT = 4;

type Props = {
  regionCode?: string;
  regionCodes?: string[];
  municipalityCode?: string;
  ekatte?: string;
};

const filterNeighborhoodSections = (
  sections: SectionInfo[],
  filter: Pick<
    Props,
    "regionCode" | "regionCodes" | "municipalityCode" | "ekatte"
  >,
): SectionInfo[] => {
  const { ekatte, municipalityCode, regionCodes, regionCode } = filter;
  if (ekatte) return sections.filter((s) => s.ekatte === ekatte);
  if (municipalityCode)
    return sections.filter((s) => s.obshtina === municipalityCode);
  if (regionCodes?.length)
    return sections.filter((s) => regionCodes.includes(s.oblast));
  if (regionCode) return sections.filter((s) => s.oblast === regionCode);
  return sections;
};

const aggregatePartyVotes = (sections: SectionInfo[]): Map<number, number> => {
  const totals = new Map<number, number>();
  for (const s of sections) {
    for (const v of s.results?.votes ?? []) {
      totals.set(
        v.partyNum,
        (totals.get(v.partyNum) ?? 0) + (v.totalVotes ?? 0),
      );
    }
  }
  return totals;
};

export const ProblemVotesByPartyTile: FC<Props> = ({
  regionCode,
  regionCodes,
  municipalityCode,
  ekatte,
}) => {
  const { t } = useTranslation();
  const { displayNameFor } = useCanonicalParties();
  const { priorElections } = useElectionContext();
  const { data: currentReport } = useProblemSections();
  const { data: priorReport } = useProblemSections(priorElections?.name);
  const { data: currentNational } = useNationalSummary();
  const { parties: currentPartyInfos } = usePartyInfo();
  const { parties: priorPartyInfos } = usePartyInfo(priorElections?.name);

  const rows = useMemo(() => {
    if (!currentReport?.neighborhoods?.length || !currentNational?.parties)
      return [];

    const filterArgs = { regionCode, regionCodes, municipalityCode, ekatte };
    const currentSections = filterNeighborhoodSections(
      currentReport.neighborhoods.flatMap((n) => n.sections),
      filterArgs,
    );
    if (!currentSections.length) return [];

    const priorSections = priorReport?.neighborhoods?.length
      ? filterNeighborhoodSections(
          priorReport.neighborhoods.flatMap((n) => n.sections),
          filterArgs,
        )
      : [];

    const currentAgg = aggregatePartyVotes(currentSections);
    const priorAgg = aggregatePartyVotes(priorSections);

    const totalCurrent = Array.from(currentAgg.values()).reduce(
      (s, n) => s + n,
      0,
    );
    const totalPrior = Array.from(priorAgg.values()).reduce((s, n) => s + n, 0);
    if (!totalCurrent) return [];

    const parliamentParties = currentNational.parties.filter(
      (p) => p.pct >= NATIONAL_THRESHOLD_PCT,
    );

    const built = parliamentParties.map((p) => {
      const currentInfo = currentPartyInfos?.find(
        (pi) => pi.number === p.partyNum,
      );
      const currentVotes = currentAgg.get(p.partyNum) ?? 0;
      const currentShare = totalCurrent
        ? (100 * currentVotes) / totalCurrent
        : 0;

      let priorVotes: number | undefined;
      let priorShare: number | undefined;
      if (
        priorElections?.name &&
        priorPartyInfos &&
        totalPrior &&
        currentInfo
      ) {
        const priorMatches = priorPartyInfos.filter((pi) =>
          matchPartyNickName(currentInfo, pi, true),
        );
        if (priorMatches.length) {
          const summed = priorMatches.reduce(
            (s, pi) => s + (priorAgg.get(pi.number) ?? 0),
            0,
          );
          priorVotes = summed;
          priorShare = (100 * summed) / totalPrior;
        }
      }

      const deltaPP =
        priorShare !== undefined ? currentShare - priorShare : undefined;

      return {
        partyNum: p.partyNum,
        nickName: p.nickName,
        color: p.color,
        currentVotes,
        currentShare,
        priorVotes,
        priorShare,
        deltaPP,
      };
    });

    const filtered = built.filter((r) => r.currentVotes > 0);
    filtered.sort((a, b) => b.currentVotes - a.currentVotes);
    return filtered;
  }, [
    currentReport,
    priorReport,
    currentNational,
    currentPartyInfos,
    priorPartyInfos,
    priorElections,
    regionCode,
    regionCodes,
    municipalityCode,
    ekatte,
  ]);

  if (!rows.length) return null;

  const maxShare = rows[0]?.currentShare ?? 0;
  const hasAnyPrior = rows.some((r) => r.deltaPP !== undefined);

  return (
    <StatCard
      label={
        <div className="flex items-center gap-2">
          <Hint
            text={t("dashboard_problem_votes_by_party_hint")}
            underline={false}
          >
            <div className="flex items-center gap-2">
              <Vote className="h-4 w-4" />
              <span>{t("dashboard_problem_votes_by_party")}</span>
            </div>
          </Hint>
        </div>
      }
    >
      <div className="grid grid-cols-[minmax(0,1.4fr)_auto_minmax(80px,1fr)_auto_auto] gap-x-3 gap-y-1.5 items-center mt-1 text-sm">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("party")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("votes")}
        </span>
        <span />
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("dashboard_share_of_problem_votes")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {hasAnyPrior ? t("dashboard_change_pp") : ""}
        </span>
        {rows.map((r) => {
          const barPct = maxShare ? (r.currentShare / maxShare) * 100 : 0;
          return (
            <div className="contents" key={r.partyNum}>
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: r.color || "#888" }}
                />
                <span className="truncate font-medium">
                  {displayNameFor(r.nickName) ?? r.nickName}
                </span>
              </div>
              <span className="tabular-nums text-xs text-muted-foreground text-right">
                {formatThousands(r.currentVotes)}
              </span>
              <div className="relative h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="absolute top-0 bottom-0 left-0 rounded-full"
                  style={{
                    width: `${Math.max(2, Math.min(100, barPct))}%`,
                    backgroundColor: r.color || "#888",
                  }}
                />
              </div>
              <span className="tabular-nums text-xs font-semibold text-right">
                {formatPct(r.currentShare, 1)}
              </span>
              <span
                className={`tabular-nums text-xs font-medium text-right ${
                  r.deltaPP === undefined
                    ? "text-muted-foreground"
                    : r.deltaPP > 0
                      ? "text-positive"
                      : r.deltaPP < 0
                        ? "text-negative"
                        : "text-muted-foreground"
                }`}
              >
                {r.deltaPP === undefined
                  ? "—"
                  : `${r.deltaPP > 0 ? "+" : r.deltaPP < 0 ? "−" : ""}${formatPct(Math.abs(r.deltaPP), 1)}`}
              </span>
            </div>
          );
        })}
      </div>
    </StatCard>
  );
};
