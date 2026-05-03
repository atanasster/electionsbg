import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { MapPin } from "lucide-react";
import { formatPct, formatThousands } from "@/data/utils";
import { useSettlementsByMunicipality } from "@/data/settlements/useSettlementsByMunicipality";
import { useSettlementsInfo } from "@/data/settlements/useSettlements";
import { NationalPartyResult } from "@/data/dashboard/dashboardTypes";
import { Link } from "@/ux/Link";
import { Hint } from "@/ux/Hint";
import { StatCard } from "./StatCard";

const TOP_N = 10;

type Props = {
  parties: NationalPartyResult[];
  municipalityCode: string;
};

export const TopSettlementsTile: FC<Props> = ({
  parties,
  municipalityCode,
}) => {
  const { t, i18n } = useTranslation();
  const data = useSettlementsByMunicipality(municipalityCode);
  const { findSettlement } = useSettlementsInfo();

  const partyColorMap = useMemo(
    () => new Map(parties.map((p) => [p.partyNum, p.color ?? "#888"])),
    [parties],
  );

  const totalCount = data?.length ?? 0;

  const rows = useMemo(() => {
    if (!data?.length) return [];
    const total = data.reduce(
      (s, m) => s + (m.results.protocol?.totalActualVoters ?? 0),
      0,
    );
    if (!total) return [];

    const enriched = data
      .map((s) => {
        const turnout = s.results.protocol?.totalActualVoters ?? 0;
        const validVotes = s.results.votes.reduce(
          (sum, v) => sum + v.totalVotes,
          0,
        );
        const machineVotes = s.results.votes.reduce(
          (sum, v) => sum + (v.machineVotes ?? 0),
          0,
        );
        let topPartyNum = 0;
        let topPartyVotes = 0;
        for (const v of s.results.votes) {
          if (v.totalVotes > topPartyVotes) {
            topPartyVotes = v.totalVotes;
            topPartyNum = v.partyNum;
          }
        }
        const info = findSettlement(s.ekatte);
        const name =
          (i18n.language === "bg"
            ? info?.long_name || info?.name
            : info?.long_name_en || info?.name_en) || s.ekatte;
        return {
          key: s.ekatte,
          name,
          totalVotes: turnout,
          machineVotes,
          machinePct: validVotes ? (machineVotes / validVotes) * 100 : 0,
          topPartyNum,
          pct: (turnout / total) * 100,
        };
      })
      .sort((a, b) => b.totalVotes - a.totalVotes)
      .slice(0, TOP_N);

    const maxVotes = enriched[0]?.totalVotes ?? 1;

    return enriched.map((r) => ({
      ...r,
      barPct: (r.totalVotes / maxVotes) * 100,
      topPartyColor: partyColorMap.get(r.topPartyNum) ?? "#888",
    }));
  }, [data, findSettlement, i18n.language, partyColorMap]);

  if (rows.length === 0) return null;

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full">
          <Hint text={t("dashboard_top_settlements_hint")} underline={false}>
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              <span>{t("dashboard_top_settlements")}</span>
            </div>
          </Hint>
          {totalCount > TOP_N ? (
            <Link
              to={`/settlement/${municipalityCode}/settlements`}
              className="text-[10px] normal-case text-primary hover:underline"
              underline={false}
            >
              {t("dashboard_see_details")} →
            </Link>
          ) : null}
        </div>
      }
      className="overflow-hidden"
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_minmax(80px,1.5fr)_auto] gap-x-3 gap-y-1.5 items-center mt-1 text-sm">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("settlement")}
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
              to={`/sections/${key}`}
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
