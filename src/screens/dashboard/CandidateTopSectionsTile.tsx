import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Vote } from "lucide-react";
import { CandidateDashboardSummary } from "@/data/dashboard/candidateDashboardTypes";
import { formatPct, formatThousands } from "@/data/utils";
import { Link } from "@/ux/Link";
import { Hint } from "@/ux/Hint";
import { StatCard } from "./StatCard";

const TOP_N = 15;

type Props = { data: CandidateDashboardSummary };

export const CandidateTopSectionsTile: FC<Props> = ({ data }) => {
  const { t } = useTranslation();

  const rows = useMemo(() => {
    if (!data.topSections?.length) return [];
    const sorted = [...data.topSections]
      .sort((a, b) => b.totalVotes - a.totalVotes)
      .slice(0, TOP_N);
    const maxVotes = sorted[0]?.totalVotes ?? 1;
    const color = data.partyColor ?? "#888";
    return sorted.map((r) => {
      const pctOfPartyPrefs =
        r.partyVotes && r.partyVotes > 0
          ? (100 * r.totalVotes) / r.partyVotes
          : undefined;
      const pctOfSection =
        r.allVotes && r.allVotes > 0
          ? (100 * r.totalVotes) / r.allVotes
          : undefined;
      const deltaVotes =
        r.lyTotalVotes !== undefined
          ? r.totalVotes - r.lyTotalVotes
          : undefined;
      return {
        key: r.section ?? "",
        section: r.section ?? "",
        totalVotes: r.totalVotes,
        pctOfPartyPrefs,
        pctOfSection,
        deltaVotes,
        barPct: (r.totalVotes / maxVotes) * 100,
        color,
      };
    });
  }, [data]);

  if (rows.length === 0) return null;
  const candidateName = encodeURIComponent(data.name);

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full">
          <Hint
            text={t("dashboard_candidate_top_sections_hint")}
            underline={false}
          >
            <div className="flex items-center gap-2">
              <Vote className="h-4 w-4" />
              <span>{t("dashboard_candidate_top_sections")}</span>
            </div>
          </Hint>
          <Link
            to={`/candidate/${candidateName}/sections`}
            className="text-[10px] normal-case text-primary hover:underline"
            underline={false}
          >
            {t("dashboard_see_details")} →
          </Link>
        </div>
      }
      className="overflow-hidden"
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(80px,1.5fr)_auto_auto_auto] gap-x-3 gap-y-1.5 items-center mt-1 text-sm">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("section")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("preferences")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("dashboard_share")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("dashboard_pct_of_party")}
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
            to={`/section/${r.section}`}
            underline={false}
            className="contents"
          >
            <span className="truncate font-medium tabular-nums">
              {r.section}
            </span>
            <span className="tabular-nums text-xs text-muted-foreground text-right">
              {formatThousands(r.totalVotes)}
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
              {r.pctOfPartyPrefs !== undefined
                ? formatPct(r.pctOfPartyPrefs, 2)
                : "—"}
            </span>
            <span className="tabular-nums text-xs text-muted-foreground text-right">
              {r.pctOfSection !== undefined
                ? formatPct(r.pctOfSection, 2)
                : "—"}
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
