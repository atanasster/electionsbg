import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { NationalPartyResult } from "@/data/dashboard/dashboardTypes";
import { useRegionVotes } from "@/data/regions/useRegionVotes";
import { formatThousands, pctChange } from "@/data/utils";
import { Link } from "@/ux/Link";
import { Hint } from "@/ux/Hint";
import { StatCard } from "./StatCard";

type Props = {
  parties: NationalPartyResult[];
  regionCode?: string;
};

const fmtSigned = (n: number) => {
  if (n === 0) return "–";
  const sign = n > 0 ? "+" : "−";
  return sign + formatThousands(Math.abs(n));
};

export const RecountTile: FC<Props> = ({ parties, regionCode }) => {
  const { t } = useTranslation();
  const { countryVotes, votesByRegion } = useRegionVotes();
  const country = countryVotes();
  const region = regionCode ? votesByRegion(regionCode) : undefined;
  const results = regionCode ? (region?.results ?? { votes: [] }) : country.results;
  const original = regionCode
    ? (region?.original ?? { votes: [], addedVotes: 0, addedPaperVotes: 0, addedMachineVotes: 0, removedVotes: 0, removedPaperVotes: 0, removedMachineVotes: 0 })
    : country.original;

  const { rows, hasRecount, maxAbsChange } = useMemo(() => {
    const top = parties.filter((p) => p.passedThreshold);
    let any = false;
    let maxAbs = 0;
    const built = top
      .map((p) => {
        const v = results.votes.find((rv) => rv.partyNum === p.partyNum);
        const o = original.votes.find((ov) => ov.partyNum === p.partyNum);
        const totalVotes = v?.totalVotes ?? 0;
        const paperChange = o ? o.addedPaperVotes + o.removedPaperVotes : 0;
        const machineChange = o
          ? o.addedMachineVotes + o.removedMachineVotes
          : 0;
        const totalChange = o ? o.addedVotes + o.removedVotes : 0;
        if (paperChange || machineChange || totalChange) any = true;
        if (Math.abs(totalChange) > maxAbs) maxAbs = Math.abs(totalChange);
        const pct = pctChange(totalVotes, totalVotes - totalChange) ?? 0;
        return {
          partyNum: p.partyNum,
          nickName: p.nickName,
          color: p.color || "#888",
          paperChange,
          machineChange,
          totalChange,
          pct,
        };
      })
      .filter((r) => r.paperChange || r.machineChange || r.totalChange);
    return { rows: built, hasRecount: any, maxAbsChange: maxAbs };
  }, [parties, results.votes, original.votes]);

  if (!hasRecount || rows.length === 0) return null;

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full">
          <Hint text={t("dashboard_recount_hint")} underline={false}>
            <div className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4" />
              <span>{t("voting_recount")}</span>
            </div>
          </Hint>
          <Link
            to={regionCode ? `/municipality/${regionCode}/recount` : "/recount"}
            className="text-[10px] normal-case text-primary hover:underline"
            underline={false}
          >
            {t("dashboard_see_details")} →
          </Link>
        </div>
      }
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_minmax(80px,1fr)_auto_auto] gap-x-3 gap-y-1.5 items-center mt-1 text-sm">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("dashboard_party")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("paper_votes")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("machine_votes")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("change")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("total_votes")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          %
        </span>
        {rows.map((r) => {
          const ratio =
            maxAbsChange > 0 ? Math.abs(r.totalChange) / maxAbsChange : 0;
          const positive = r.totalChange > 0;
          return (
            <div className="contents" key={r.partyNum}>
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: r.color }}
                />
                <span className="truncate font-medium">{r.nickName}</span>
              </div>
              <span
                className={`tabular-nums text-xs font-semibold text-right ${
                  r.paperChange === 0
                    ? "text-muted-foreground"
                    : r.paperChange > 0
                      ? "text-positive"
                      : "text-negative"
                }`}
              >
                {fmtSigned(r.paperChange)}
              </span>
              <span
                className={`tabular-nums text-xs font-semibold text-right ${
                  r.machineChange === 0
                    ? "text-muted-foreground"
                    : r.machineChange > 0
                      ? "text-positive"
                      : "text-negative"
                }`}
              >
                {fmtSigned(r.machineChange)}
              </span>
              <div className="relative h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className={`absolute top-0 bottom-0 ${
                    positive ? "left-1/2" : "right-1/2"
                  } rounded-full ${positive ? "bg-positive" : "bg-negative"}`}
                  style={{ width: `${Math.max(2, ratio * 50)}%` }}
                />
                <div className="absolute top-0 bottom-0 left-1/2 w-px bg-border" />
              </div>
              <span
                className={`tabular-nums text-xs font-semibold text-right ${
                  r.totalChange === 0
                    ? "text-muted-foreground"
                    : positive
                      ? "text-positive"
                      : "text-negative"
                }`}
              >
                {fmtSigned(r.totalChange)}
              </span>
              <span
                className={`tabular-nums text-xs font-semibold text-right ${
                  r.pct === 0
                    ? "text-muted-foreground"
                    : r.pct > 0
                      ? "text-positive"
                      : "text-negative"
                }`}
              >
                {r.pct === 0
                  ? "–"
                  : `${r.pct > 0 ? "+" : ""}${r.pct.toFixed(2)}%`}
              </span>
            </div>
          );
        })}
      </div>
    </StatCard>
  );
};
