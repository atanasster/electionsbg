import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { MapPin } from "lucide-react";
import { formatPct, formatThousands } from "@/data/utils";
import {
  useRegionVotes,
  regionVotesQueryKey,
  regionVotesQueryFn,
} from "@/data/regions/useRegionVotes";
import { useRegions } from "@/data/regions/useRegions";
import { SOFIA_REGIONS } from "@/data/dataTypes";
import { NationalPartyResult } from "@/data/dashboard/dashboardTypes";
import { useElectionContext } from "@/data/ElectionContext";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@/ux/Link";
import { Hint } from "@/ux/Hint";
import { StatCard } from "./StatCard";

const TOP_N = 10;
const SOFIA_KEY = "S23";

const DeltaBadge: FC<{ delta: number }> = ({ delta }) => {
  const sign = delta > 0 ? "+" : "";
  const color =
    delta > 0
      ? "text-positive"
      : delta < 0
        ? "text-negative"
        : "text-muted-foreground";
  return (
    <span className={`tabular-nums text-xs font-medium ${color}`}>
      {sign}
      {formatPct(delta, 2)}
    </span>
  );
};

type Props = {
  parties: NationalPartyResult[];
};

export const TopRegionsTile: FC<Props> = ({ parties }) => {
  const { t, i18n } = useTranslation();
  const { countryRegions } = useRegionVotes();
  const { findRegion } = useRegions();
  const { priorElections } = useElectionContext();

  const partyColorMap = useMemo(
    () => new Map(parties.map((p) => [p.partyNum, p.color ?? "#888"])),
    [parties],
  );
  const partyNameMap = useMemo(
    () => new Map(parties.map((p) => [p.partyNum, p.nickName])),
    [parties],
  );

  const { data: priorVotes } = useQuery({
    queryKey: regionVotesQueryKey(priorElections?.name ?? ""),
    queryFn: regionVotesQueryFn,
    enabled: !!priorElections?.name,
    staleTime: Infinity,
  });

  const rows = useMemo(() => {
    const regions = countryRegions();
    if (!regions) return [];

    // Aggregate current votes per merged region key
    type RegionAgg = {
      totalVotes: number;
      machineVotes: number;
      partyVotes: Map<number, number>;
    };
    const aggMap = new Map<string, RegionAgg>();

    for (const r of regions) {
      const key = SOFIA_REGIONS.includes(r.key) ? SOFIA_KEY : r.key;
      const agg = aggMap.get(key) ?? {
        totalVotes: 0,
        machineVotes: 0,
        partyVotes: new Map<number, number>(),
      };
      for (const v of r.results.votes) {
        agg.totalVotes += v.totalVotes;
        agg.machineVotes += v.machineVotes ?? 0;
        agg.partyVotes.set(
          v.partyNum,
          (agg.partyVotes.get(v.partyNum) ?? 0) + v.totalVotes,
        );
      }
      aggMap.set(key, agg);
    }

    const countryTotal = Array.from(aggMap.values()).reduce(
      (s, r) => s + r.totalVotes,
      0,
    );
    if (countryTotal === 0) return [];

    // Aggregate prior election votes per region
    const priorMap = new Map<string, number>();
    let priorCountryTotal = 0;
    if (priorVotes) {
      for (const r of priorVotes.filter((v) => v.key !== "32")) {
        const key = SOFIA_REGIONS.includes(r.key) ? SOFIA_KEY : r.key;
        const total = r.results.votes.reduce((s, v) => s + v.totalVotes, 0);
        priorMap.set(key, (priorMap.get(key) ?? 0) + total);
        priorCountryTotal += total;
      }
    }

    const sorted = Array.from(aggMap.entries())
      .sort(([, a], [, b]) => b.totalVotes - a.totalVotes)
      .slice(0, TOP_N);
    const maxVotes = sorted[0]?.[1].totalVotes ?? 1;

    return sorted.map(([key, agg]) => {
      const info = findRegion(key);
      const name =
        key === SOFIA_KEY
          ? t("sofia_city")
          : i18n.language === "bg"
            ? info?.name
            : info?.name_en;

      // Top party by aggregated votes
      let topPartyNum = 0;
      let topPartyVotes = 0;
      for (const [partyNum, votes] of agg.partyVotes) {
        if (votes > topPartyVotes) {
          topPartyVotes = votes;
          topPartyNum = partyNum;
        }
      }
      const topPartyColor = partyColorMap.get(topPartyNum) ?? "#888";
      const topPartyName = partyNameMap.get(topPartyNum);

      const currentPct = (agg.totalVotes / countryTotal) * 100;
      const priorTotal = priorMap.get(key);
      const priorPct =
        priorTotal && priorCountryTotal > 0
          ? (priorTotal / priorCountryTotal) * 100
          : undefined;
      const deltaPct =
        priorPct !== undefined ? currentPct - priorPct : undefined;

      const machinePct =
        agg.totalVotes > 0 ? (agg.machineVotes / agg.totalVotes) * 100 : 0;

      return {
        key,
        name: name ?? key,
        totalVotes: agg.totalVotes,
        pct: currentPct,
        barPct: (agg.totalVotes / maxVotes) * 100,
        machinePct,
        deltaPct,
        topPartyColor,
        topPartyName,
      };
    });
  }, [
    countryRegions,
    findRegion,
    i18n.language,
    t,
    partyColorMap,
    partyNameMap,
    priorVotes,
  ]);

  if (rows.length === 0) return null;

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full">
          <Hint text={t("dashboard_top_regions_hint")} underline={false}>
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              <span>{t("top_regions")}</span>
            </div>
          </Hint>
          <Link
            to="/regions"
            className="text-[10px] normal-case text-primary hover:underline"
            underline={false}
          >
            {t("dashboard_see_details")} →
          </Link>
        </div>
      }
      className="overflow-hidden"
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto_minmax(80px,1.5fr)_auto_auto] gap-x-3 gap-y-1.5 items-center mt-1 text-sm">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("region")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("dashboard_winner")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("votes")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("dashboard_machine_pct")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("dashboard_share")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("dashboard_now")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("dashboard_change")}
        </span>
        {rows.map(
          ({
            key,
            name,
            totalVotes,
            pct,
            barPct,
            machinePct,
            deltaPct,
            topPartyColor,
            topPartyName,
          }) => (
            <Link
              key={key}
              to={key === SOFIA_KEY ? "/sofia" : `/municipality/${key}`}
              underline={false}
              className="contents"
            >
              <span className="truncate font-medium">{name}</span>
              <span className="flex items-center gap-1.5 min-w-0 text-xs">
                {topPartyName ? (
                  <>
                    <span
                      className="inline-block h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: topPartyColor }}
                    />
                    <span className="truncate">{topPartyName}</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </span>
              <span className="tabular-nums text-xs text-muted-foreground text-right">
                {formatThousands(totalVotes)}
              </span>
              <span className="tabular-nums text-xs text-muted-foreground text-right">
                {formatPct(machinePct, 0)}
              </span>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(2, barPct)}%`,
                    backgroundColor: topPartyColor,
                  }}
                />
              </div>
              <span className="tabular-nums text-xs font-semibold text-right">
                {formatPct(pct, 1)}
              </span>
              <span className="justify-self-end">
                {deltaPct !== undefined ? (
                  <DeltaBadge delta={deltaPct} />
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </span>
            </Link>
          ),
        )}
      </div>
    </StatCard>
  );
};
