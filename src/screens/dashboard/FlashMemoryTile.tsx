import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Cpu } from "lucide-react";
import { NationalPartyResult } from "@/data/dashboard/dashboardTypes";
import { useRegionVotes } from "@/data/regions/useRegionVotes";
import { formatThousands } from "@/data/utils";
import { StatCard } from "./StatCard";

type Props = {
  parties: NationalPartyResult[];
  topN?: number;
};

const fmtSigned = (n: number) => {
  if (n === 0) return "0";
  const sign = n > 0 ? "+" : "−";
  return sign + formatThousands(Math.abs(n));
};

export const FlashMemoryTile: FC<Props> = ({ parties, topN = 6 }) => {
  const { t } = useTranslation();
  const { countryVotes } = useRegionVotes();
  const { results } = countryVotes();

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
        <div className="flex items-center gap-2">
          <Cpu className="h-4 w-4" />
          <span>{t("dashboard_flash_memory_diff")}</span>
        </div>
      }
      hint={t("dashboard_flash_memory_diff_hint")}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_minmax(80px,1fr)_auto] gap-x-3 gap-y-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground items-center mt-1">
        <span>{t("dashboard_party")}</span>
        <span className="text-right">{t("machine_votes")}</span>
        <span className="text-right">{t("dashboard_flash")}</span>
        <span>{t("dashboard_drift")}</span>
        <span className="text-right">{t("change")}</span>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_minmax(80px,1fr)_auto] gap-x-3 gap-y-1.5 items-center text-sm">
        {rows.map((r) => {
          const ratio = maxAbsDiff > 0 ? Math.abs(r.diff) / maxAbsDiff : 0;
          const positive = r.diff > 0;
          return (
            <div className="contents" key={r.partyNum}>
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: r.color }}
                />
                <span className="truncate font-medium">{r.nickName}</span>
              </div>
              <span className="tabular-nums text-xs text-muted-foreground text-right">
                {formatThousands(r.machine)}
              </span>
              <span className="tabular-nums text-xs text-muted-foreground text-right">
                {formatThousands(r.suemg)}
              </span>
              <div className="relative h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className={`absolute top-0 bottom-0 ${
                    positive ? "left-1/2" : "right-1/2"
                  } rounded-full ${
                    positive ? "bg-emerald-500" : "bg-rose-500"
                  }`}
                  style={{ width: `${Math.max(2, ratio * 50)}%` }}
                />
                <div className="absolute top-0 bottom-0 left-1/2 w-px bg-border" />
              </div>
              <span
                className={`tabular-nums text-xs font-semibold text-right ${
                  r.diff === 0
                    ? "text-muted-foreground"
                    : positive
                      ? "text-emerald-600"
                      : "text-rose-600"
                }`}
              >
                {fmtSigned(r.diff)}
              </span>
            </div>
          );
        })}
      </div>
    </StatCard>
  );
};
