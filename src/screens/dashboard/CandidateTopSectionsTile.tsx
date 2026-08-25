import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Vote } from "lucide-react";
import { CandidateDashboardSummary } from "@/data/dashboard/candidateDashboardTypes";
import { formatPct, formatThousands } from "@/data/utils";
import { Link } from "@/ux/Link";
import { Hint } from "@/ux/Hint";
import { StatCard } from "./StatCard";

// The on-page summary card shows a HANDFUL of rows and links to the full
// /candidate/:slug/sections table for the rest — a broadly-run candidate can carry dozens
// of sections, and this card should stay spacious rather than becoming a dense spreadsheet;
// CandidateSectionsScreen is where the complete, uncapped list lives.
const TOP_N = 5;

type Props = {
  data: CandidateDashboardSummary;
  linkSlug?: string;
  // ?elections=<cycle> on the "see all" link so the drill-down is scoped to the selected cycle.
  election?: string;
};

export const CandidateTopSectionsTile: FC<Props> = ({
  data,
  linkSlug,
  election,
}) => {
  const { t } = useTranslation();

  const rows = useMemo(() => {
    if (!data.topSections?.length) return [];
    const sorted = [...data.topSections]
      .sort((a, b) => b.totalVotes - a.totalVotes)
      .slice(0, TOP_N);
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
      };
    });
  }, [data]);

  if (rows.length === 0) return null;
  const candidateSlug = linkSlug ?? encodeURIComponent(data.name);

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
            to={
              election
                ? {
                    pathname: `/candidate/${candidateSlug}/sections`,
                    search: { elections: election },
                  }
                : `/candidate/${candidateSlug}/sections`
            }
            className="text-[10px] normal-case text-primary hover:underline"
            underline={false}
          >
            {t("dashboard_see_details")} →
          </Link>
        </div>
      }
      className="overflow-hidden"
    >
      {/* The 72px floor on the first track (instead of a bare `1fr`, whose implicit
          min-width is the content's own natural size) is what lets the first column's
          `truncate` span actually clip rather than forcing the track wider than the row
          has room for. Don't simplify this to a bare `1fr`. */}
      <div className="grid grid-cols-[minmax(72px,1fr)_auto_auto_auto_auto] gap-x-1.5 sm:gap-x-3 gap-y-2.5 items-center mt-2 text-sm">
        <span className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("section")}
        </span>
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("dashboard_col_preferences_short")}
        </span>
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("dashboard_pct_of_party")}
        </span>
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("dashboard_pct_local")}
        </span>
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("dashboard_change_votes")}
        </span>
        {rows.map((r) => (
          <Link
            key={r.key}
            to={
              election
                ? {
                    pathname: `/section/${r.section}`,
                    search: { elections: election },
                  }
                : `/section/${r.section}`
            }
            underline={false}
            className="contents"
          >
            {/* text-xs below sm so the 9-digit section id fits the column whole. Every id in
                this list shares its leading digits (same oblast, same município), so a
                truncated one is not merely abbreviated — every row reads "212000…". */}
            <span className="truncate font-medium tabular-nums text-xs sm:text-sm">
              {r.section}
            </span>
            <span className="tabular-nums text-sm text-muted-foreground text-right">
              {formatThousands(r.totalVotes)}
            </span>
            <span className="tabular-nums text-sm font-semibold text-right">
              {r.pctOfPartyPrefs !== undefined
                ? formatPct(r.pctOfPartyPrefs, 2)
                : "—"}
            </span>
            <span className="tabular-nums text-sm text-muted-foreground text-right">
              {r.pctOfSection !== undefined
                ? formatPct(r.pctOfSection, 2)
                : "—"}
            </span>
            <span
              className={`tabular-nums text-sm font-medium text-right ${
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
