import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Vote } from "lucide-react";
import { Link } from "react-router-dom";
import { StatCard } from "@/screens/dashboard/StatCard";
import { Hint } from "@/ux/Hint";
import { formatPct, formatThousands } from "@/data/utils";
import type { LocalSectionShard } from "@/data/local/types";

const TOP_N = 15;

// Largest polling stations of a local município by actual voters — the
// local-elections counterpart of TopSectionsTile. Address (backfilled) is shown
// where present, else the settlement; the bar + winner dot use the leading
// council party. Self-hides for município with fewer than two sections.
export const LocalTopSectionsTile: FC<{
  shard: LocalSectionShard;
  cycle: string;
  obshtinaCode: string;
  // When set and the município has more sections than the tile shows, render a
  // "see details →" link to the full searchable per-station table page.
  seeAllHref?: string;
}> = ({ shard, cycle, obshtinaCode, seeAllHref }) => {
  const { t } = useTranslation();

  const partyById = useMemo(() => {
    const m = new Map<number, { name: string; color: string }>();
    for (const p of shard.parties)
      m.set(p.localPartyNum, { name: p.localPartyName, color: p.color });
    return m;
  }, [shard]);

  const rows = useMemo(() => {
    const sorted = [...shard.sections].sort(
      (a, b) => b.totalActualVoters - a.totalActualVoters,
    );
    const top = sorted.slice(0, TOP_N);
    const maxVoters = top[0]?.totalActualVoters ?? 1;
    return top.map((s) => {
      const lead = s.partyVotes[0];
      const winner = lead ? partyById.get(lead.localPartyNum) : undefined;
      const turnout =
        s.numRegisteredVoters > 0
          ? (100 * s.totalActualVoters) / s.numRegisteredVoters
          : 0;
      return {
        sectionCode: s.sectionCode,
        place: s.address || s.settlement,
        totalActualVoters: s.totalActualVoters,
        registeredVoters: s.numRegisteredVoters,
        turnout,
        winner,
        barPct: maxVoters > 0 ? (s.totalActualVoters / maxVoters) * 100 : 0,
      };
    });
  }, [shard, partyById]);

  if (shard.sections.length < 2 || rows.length === 0) return null;

  const showAllInTile = shard.sections.length <= TOP_N;

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full">
          <Hint
            text={t(
              showAllInTile
                ? "dashboard_settlement_sections_hint"
                : "local_top_sections_hint",
            )}
            underline={false}
          >
            <div className="flex items-center gap-2">
              <Vote className="h-4 w-4" />
              <span>
                {t(
                  showAllInTile
                    ? "dashboard_settlement_sections"
                    : "dashboard_settlement_top_sections",
                )}
              </span>
            </div>
          </Hint>
          {!showAllInTile && seeAllHref ? (
            <Link
              to={seeAllHref}
              className="text-[10px] normal-case text-primary hover:underline"
            >
              {t("dashboard_see_details")} →
            </Link>
          ) : null}
        </div>
      }
      className="overflow-hidden"
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_minmax(60px,1fr)_auto_auto] gap-x-3 gap-y-1.5 items-center mt-1 text-sm">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("section")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("address")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("voters")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("dashboard_share")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("voter_turnout")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("local_sections_th_leader")}
        </span>
        {rows.map((r) => (
          <Link
            key={r.sectionCode}
            to={`/local/${cycle}/${obshtinaCode}/section/${r.sectionCode}`}
            className="contents"
          >
            <span className="tabular-nums text-xs font-mono text-muted-foreground">
              {r.sectionCode}
            </span>
            <span className="truncate text-xs" title={r.place}>
              {r.place || "—"}
            </span>
            <span className="tabular-nums text-xs font-medium text-right">
              {formatThousands(r.totalActualVoters)}
            </span>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(2, r.barPct)}%`,
                  backgroundColor: r.winner?.color || "#888",
                }}
              />
            </div>
            <span className="tabular-nums text-xs text-muted-foreground text-right">
              {r.registeredVoters > 0 ? formatPct(r.turnout, 1) : "—"}
            </span>
            <span className="flex items-center gap-1.5 min-w-0">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: r.winner?.color || "#888" }}
              />
              <span className="truncate text-xs" title={r.winner?.name}>
                {r.winner?.name ?? "—"}
              </span>
            </span>
          </Link>
        ))}
      </div>
    </StatCard>
  );
};
