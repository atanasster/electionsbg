import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Cpu } from "lucide-react";
import { NationalPartyResult } from "@/data/dashboard/dashboardTypes";
import { VoteResults } from "@/data/dataTypes";
import { useRegionVotes } from "@/data/regions/useRegionVotes";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { formatThousands } from "@/data/utils";
import { Link } from "@/ux/Link";
import { Hint } from "@/ux/Hint";
import { StatCard } from "./StatCard";

type Props = {
  parties: NationalPartyResult[];
  topN?: number;
  regionCode?: string;
  results?: VoteResults;
  basePath?: string;
};

const fmtSigned = (n: number) => {
  if (n === 0) return "0";
  const sign = n > 0 ? "+" : "−";
  return sign + formatThousands(Math.abs(n));
};

export const FlashMemoryTile: FC<Props> = ({
  parties,
  topN = 6,
  regionCode,
  results: providedResults,
  basePath,
}) => {
  const { t } = useTranslation();
  const { countryVotes, votesByRegion } = useRegionVotes();
  const { displayNameFor } = useCanonicalParties();
  const results: VoteResults = providedResults
    ? providedResults
    : regionCode
      ? (votesByRegion(regionCode)?.results ?? { votes: [] })
      : countryVotes().results;

  const { rows, hasFlash, maxAbsDiff } = useMemo(() => {
    const top = parties.slice(0, topN);
    let any = false;
    let maxAbs = 0;
    const built = top
      .map((p) => {
        const v = results.votes.find((rv) => rv.partyNum === p.partyNum);
        const machine = v?.machineVotes ?? 0;
        const suemg = v?.suemgVotes ?? 0;
        if (machine || suemg) any = true;
        const diff = machine - suemg;
        if (Math.abs(diff) > maxAbs) maxAbs = Math.abs(diff);
        return {
          partyNum: p.partyNum,
          nickName: p.nickName,
          color: p.color || "#888",
          machine,
          suemg,
          diff,
        };
      })
      .filter((r) => r.machine || r.suemg);
    return { rows: built, hasFlash: any, maxAbsDiff: maxAbs };
  }, [parties, topN, results.votes]);

  if (!hasFlash || rows.length === 0) return null;

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full">
          <Hint text={t("dashboard_flash_memory_diff_hint")} underline={false}>
            <div className="flex items-center gap-2">
              <Cpu className="h-4 w-4" />
              <span>{t("dashboard_flash_memory_diff")}</span>
            </div>
          </Hint>
          <Link
            to={
              basePath
                ? `${basePath}/flash-memory`
                : regionCode
                  ? `/municipality/${regionCode}/flash-memory`
                  : "/flash-memory"
            }
            className="text-[10px] normal-case text-primary hover:underline"
            underline={false}
          >
            {t("dashboard_see_details")} →
          </Link>
        </div>
      }
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_minmax(80px,1fr)_auto] gap-x-3 gap-y-1.5 mt-1 items-center">
        <div className="grid grid-cols-subgrid col-span-5 gap-x-3 items-center text-[10px] font-medium uppercase tracking-wide text-muted-foreground px-1">
          <span>{t("dashboard_party")}</span>
          <span className="justify-self-end">{t("machine_votes")}</span>
          <span className="justify-self-end">{t("dashboard_flash")}</span>
          <span>{t("dashboard_drift")}</span>
          <span className="justify-self-end">{t("change")}</span>
        </div>
        {rows.map((r) => {
          const ratio = maxAbsDiff > 0 ? Math.abs(r.diff) / maxAbsDiff : 0;
          const positive = r.diff > 0;
          return (
            <Link
              key={r.partyNum}
              to={`/party/${r.nickName}`}
              underline={false}
              className="grid grid-cols-subgrid col-span-5 gap-x-3 items-center text-sm hover:bg-muted/40 rounded-md px-1 py-1 -mx-1 transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: r.color }}
                />
                <span className="truncate font-medium">
                  {displayNameFor(r.nickName) ?? r.nickName}
                </span>
              </div>
              <span className="tabular-nums text-xs text-muted-foreground justify-self-end">
                {formatThousands(r.machine)}
              </span>
              <span className="tabular-nums text-xs text-muted-foreground justify-self-end">
                {formatThousands(r.suemg)}
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
                className={`tabular-nums text-xs font-semibold justify-self-end ${
                  r.diff === 0
                    ? "text-muted-foreground"
                    : positive
                      ? "text-positive"
                      : "text-negative"
                }`}
              >
                {fmtSigned(r.diff)}
              </span>
            </Link>
          );
        })}
      </div>
    </StatCard>
  );
};
