import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Home } from "lucide-react";
import { PartyDashboardSummary } from "@/data/dashboard/partyDashboardTypes";
import { usePartyBySettlement } from "@/data/parties/usePartyByLocation";
import { useSettlementsInfo } from "@/data/settlements/useSettlements";
import { formatPct, formatThousands } from "@/data/utils";
import { Link } from "@/ux/Link";
import { Hint } from "@/ux/Hint";
import { StatCard } from "./StatCard";

const TOP_N = 15;

type Props = { data: PartyDashboardSummary };

export const PartyTopSettlementsTile: FC<Props> = ({ data }) => {
  const { t, i18n } = useTranslation();
  const { rows: settlementRows } = usePartyBySettlement(data.partyNum);
  const { findSettlement } = useSettlementsInfo();

  const rows = useMemo(() => {
    if (!settlementRows?.length) return [];
    const sorted = [...settlementRows]
      .sort((a, b) => b.totalVotes - a.totalVotes)
      .slice(0, TOP_N);
    const maxVotes = sorted[0]?.totalVotes ?? 1;
    const color = data.color ?? "#888";
    return sorted.map((r) => {
      const info = findSettlement(r.ekatte);
      const name =
        i18n.language === "bg"
          ? info?.long_name || info?.name || r.ekatte
          : info?.long_name_en || info?.name_en || r.ekatte;
      const pctOfSettlement = r.allVotes
        ? (100 * r.totalVotes) / r.allVotes
        : 0;
      const prior = r.prevYearVotesConsolidated ?? r.prevYearVotes;
      const deltaVotes = prior !== undefined ? r.totalVotes - prior : undefined;
      return {
        key: r.ekatte ?? "",
        name,
        position: r.position,
        totalVotes: r.totalVotes,
        pctOfSettlement,
        deltaVotes,
        barPct: (r.totalVotes / maxVotes) * 100,
        color,
      };
    });
  }, [settlementRows, findSettlement, i18n.language, data.color]);

  if (rows.length === 0) return null;
  const totalCount = settlementRows?.length ?? 0;

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full">
          <Hint
            text={t("dashboard_party_top_settlements_hint")}
            underline={false}
          >
            <div className="flex items-center gap-2">
              <Home className="h-4 w-4" />
              <span>{t("dashboard_party_top_settlements")}</span>
            </div>
          </Hint>
          {totalCount > TOP_N ? (
            <Link
              to={`/party/${data.nickName}/settlements`}
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
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_minmax(80px,1.5fr)_auto_auto] gap-x-3 gap-y-1.5 items-center mt-1 text-sm">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("settlement")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("votes")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("position")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("dashboard_share")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("dashboard_pct_local")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("dashboard_change_votes")}
        </span>
        {rows.map((r) => (
          <Link
            key={r.key}
            to={`/settlement/${r.key}`}
            underline={false}
            className="contents"
          >
            <span className="truncate font-medium">{r.name}</span>
            <span className="tabular-nums text-xs text-muted-foreground text-right">
              {formatThousands(r.totalVotes)}
            </span>
            <span className="tabular-nums text-xs text-muted-foreground text-right">
              #{r.position}
            </span>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(2, r.barPct)}%`,
                  backgroundColor: r.color,
                }}
              />
            </div>
            <span className="tabular-nums text-xs font-semibold text-right">
              {formatPct(r.pctOfSettlement, 2)}
            </span>
            <span
              className={`tabular-nums text-xs font-medium text-right ${
                r.deltaVotes === undefined
                  ? "text-muted-foreground"
                  : r.deltaVotes > 0
                    ? "text-positive"
                    : r.deltaVotes < 0
                      ? "text-negative"
                      : "text-muted-foreground"
              }`}
            >
              {r.deltaVotes === undefined
                ? "—"
                : r.deltaVotes === 0
                  ? "0"
                  : `${r.deltaVotes > 0 ? "+" : "−"}${formatThousands(Math.abs(r.deltaVotes))}`}
            </span>
          </Link>
        ))}
      </div>
    </StatCard>
  );
};
