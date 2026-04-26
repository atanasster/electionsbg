import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { NationalPartyResult } from "@/data/dashboard/dashboardTypes";
import { useProblemSections } from "@/data/reports/useProblemSections";
import { formatPct, formatThousands } from "@/data/utils";
import { Link } from "@/ux/Link";
import { Hint } from "@/ux/Hint";
import { StatCard } from "./StatCard";

type Props = {
  parties: NationalPartyResult[];
};

export const ProblemSectionsTile: FC<Props> = ({ parties }) => {
  const { t, i18n } = useTranslation();
  const isBg = i18n.language === "bg";
  const { data } = useProblemSections();

  const rows = useMemo(() => {
    if (!data?.neighborhoods?.length) return [];
    const partyMap = new Map(parties.map((p) => [p.partyNum, p]));
    return data.neighborhoods
      .map((n) => {
        let registered = 0;
        let voters = 0;
        const partyTotals = new Map<number, number>();
        for (const s of n.sections) {
          registered += s.results?.protocol?.numRegisteredVoters ?? 0;
          voters += s.results?.protocol?.totalActualVoters ?? 0;
          for (const v of s.results?.votes ?? []) {
            partyTotals.set(
              v.partyNum,
              (partyTotals.get(v.partyNum) ?? 0) + (v.totalVotes ?? 0),
            );
          }
        }
        let topPartyNum = -1;
        let topVotes = 0;
        let totalVotes = 0;
        for (const [pn, vv] of partyTotals.entries()) {
          totalVotes += vv;
          if (vv > topVotes) {
            topVotes = vv;
            topPartyNum = pn;
          }
        }
        const topParty = partyMap.get(topPartyNum);
        return {
          id: n.id,
          name: isBg ? n.name_bg : n.name_en,
          city: isBg ? n.city_bg : n.city_en,
          sectionCount: n.sections.length,
          registered,
          voters,
          turnout: registered ? (100 * voters) / registered : 0,
          topParty,
          topPartyVotes: topVotes,
          topPartyPct: totalVotes ? (100 * topVotes) / totalVotes : 0,
        };
      })
      .sort((a, b) => b.sectionCount - a.sectionCount);
  }, [data, parties, isBg]);

  if (!rows.length) return null;

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full">
          <Hint text={t("dashboard_problem_sections_hint")} underline={false}>
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4" />
              <span>{t("problem_sections")}</span>
            </div>
          </Hint>
          <Link
            to="/reports/section/problem_sections"
            className="text-[10px] normal-case text-primary hover:underline"
            underline={false}
          >
            {t("dashboard_see_details")} →
          </Link>
        </div>
      }
    >
      <div className="grid grid-cols-[minmax(0,1.6fr)_auto_auto_auto_auto_minmax(80px,1fr)_auto_auto] gap-x-3 gap-y-1.5 items-center mt-1 text-sm">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("dashboard_neighborhood")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("dashboard_sections")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("voters")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("dashboard_turnout")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("dashboard_top_party")}
        </span>
        <span />
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("votes")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("dashboard_share")}
        </span>
        {rows.map((r) => {
          const empty = r.sectionCount === 0;
          return (
            <div className={`contents ${empty ? "opacity-50" : ""}`} key={r.id}>
              <div className="flex items-center gap-2 min-w-0">
                <Link
                  to={`/reports/section/problem_sections/${r.id}`}
                  className="truncate font-medium text-primary"
                >
                  {r.name}
                </Link>
                <span className="text-xs text-muted-foreground truncate">
                  · {r.city}
                </span>
              </div>
              <span className="tabular-nums text-xs font-semibold text-right">
                {empty ? "0" : formatThousands(r.sectionCount)}
              </span>
              <span className="tabular-nums text-xs text-muted-foreground text-right">
                {empty ? "–" : formatThousands(r.voters)}
              </span>
              <span className="tabular-nums text-xs text-muted-foreground text-right">
                {empty ? "–" : formatPct(r.turnout, 1)}
              </span>
              <div className="flex items-center gap-2 min-w-0">
                {r.topParty ? (
                  <>
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: r.topParty.color || "#888" }}
                    />
                    <span className="truncate font-medium">
                      {r.topParty.nickName}
                    </span>
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </div>
              {r.topParty ? (
                <div className="relative h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="absolute top-0 bottom-0 left-0 rounded-full"
                    style={{
                      width: `${Math.max(2, Math.min(100, r.topPartyPct))}%`,
                      backgroundColor: r.topParty.color || "#888",
                    }}
                  />
                </div>
              ) : (
                <span />
              )}
              <span className="tabular-nums text-xs text-muted-foreground text-right">
                {r.topParty ? formatThousands(r.topPartyVotes) : "–"}
              </span>
              <span className="tabular-nums text-xs font-semibold text-right">
                {r.topParty ? formatPct(r.topPartyPct, 1) : "–"}
              </span>
            </div>
          );
        })}
      </div>
    </StatCard>
  );
};
