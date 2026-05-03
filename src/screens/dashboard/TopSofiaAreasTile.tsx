import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { MapPin } from "lucide-react";
import { formatPct, formatThousands } from "@/data/utils";
import { useRegionVotes } from "@/data/regions/useRegionVotes";
import { useRegions } from "@/data/regions/useRegions";
import { NationalPartyResult } from "@/data/dashboard/dashboardTypes";
import { Link } from "@/ux/Link";
import { Hint } from "@/ux/Hint";
import { StatCard } from "./StatCard";

type Props = {
  parties: NationalPartyResult[];
};

export const TopSofiaAreasTile: FC<Props> = ({ parties }) => {
  const { t, i18n } = useTranslation();
  const { sofiaRegions } = useRegionVotes();
  const { findRegion } = useRegions();

  const partyColorMap = useMemo(
    () => new Map(parties.map((p) => [p.partyNum, p.color ?? "#888"])),
    [parties],
  );

  const rows = useMemo(() => {
    const regions = sofiaRegions();
    if (!regions?.length) return [];

    const total = regions.reduce(
      (s, r) => s + (r.results.protocol?.totalActualVoters ?? 0),
      0,
    );
    if (!total) return [];

    const enriched = regions
      .map((r) => {
        const turnout = r.results.protocol?.totalActualVoters ?? 0;
        const validVotes = r.results.votes.reduce(
          (s, v) => s + v.totalVotes,
          0,
        );
        const machineVotes = r.results.votes.reduce(
          (s, v) => s + (v.machineVotes ?? 0),
          0,
        );
        let topPartyNum = 0;
        let topPartyVotes = 0;
        for (const v of r.results.votes) {
          if (v.totalVotes > topPartyVotes) {
            topPartyVotes = v.totalVotes;
            topPartyNum = v.partyNum;
          }
        }
        const info = findRegion(r.key);
        const name =
          (i18n.language === "bg"
            ? info?.long_name || info?.name
            : info?.long_name_en || info?.name_en) || r.key;
        return {
          key: r.key,
          name,
          totalVotes: turnout,
          machineVotes,
          machinePct: validVotes ? (machineVotes / validVotes) * 100 : 0,
          topPartyNum,
          pct: (turnout / total) * 100,
        };
      })
      .sort((a, b) => b.totalVotes - a.totalVotes);

    const maxVotes = enriched[0]?.totalVotes ?? 1;

    return enriched.map((r) => ({
      ...r,
      barPct: (r.totalVotes / maxVotes) * 100,
      topPartyColor: partyColorMap.get(r.topPartyNum) ?? "#888",
    }));
  }, [sofiaRegions, findRegion, i18n.language, partyColorMap]);

  if (rows.length === 0) return null;

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full">
          <Hint text={t("dashboard_top_sofia_areas_hint")} underline={false}>
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              <span>{t("dashboard_top_sofia_areas")}</span>
            </div>
          </Hint>
        </div>
      }
      className="overflow-hidden"
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_minmax(80px,1.5fr)_auto] gap-x-3 gap-y-1.5 items-center mt-1 text-sm">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("region")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("voters")}
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
        {rows.map(
          ({
            key,
            name,
            totalVotes,
            pct,
            barPct,
            machinePct,
            topPartyColor,
          }) => (
            <Link
              key={key}
              to={`/municipality/${key}`}
              underline={false}
              className="contents"
            >
              <span className="truncate font-medium">{name}</span>
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
            </Link>
          ),
        )}
      </div>
    </StatCard>
  );
};
