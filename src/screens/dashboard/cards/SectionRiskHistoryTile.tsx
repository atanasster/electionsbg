import { FC } from "react";
import { useTranslation } from "react-i18next";
import { History } from "lucide-react";
import { useRiskHistory } from "@/data/riskScore/useRiskHistory";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { useElectionContext } from "@/data/ElectionContext";
import { localDate, formatPct } from "@/data/utils";
import type { RiskBand } from "@/data/riskScore/useRiskScore";
import { Hint } from "@/ux/Hint";
import { RiskBandBadge } from "@/screens/components/riskScore/RiskBandBadge";
import { cn } from "@/lib/utils";
import { StatCard } from "../StatCard";

// Section "rap sheet" — every election this polling section took part in,
// side by side: winner, winner-share, turnout and the risk SCREENING
// band. A view over published data (see useRiskHistory /
// scripts/reports/risk_history.ts); it makes no fraud claim.

const HEADER_CLASS =
  "text-[10px] font-medium uppercase tracking-wide text-muted-foreground";
const ELEVATED_BANDS = new Set<RiskBand>(["elevated", "high", "critical"]);

export const SectionRiskHistoryTile: FC<{ sectionCode: string }> = ({
  sectionCode,
}) => {
  const { t } = useTranslation();
  const { selected } = useElectionContext();
  const { history } = useRiskHistory(sectionCode);
  // Resolve the winning party to a language-aware display name + canonical
  // colour, so this tile stays consistent with the rest of the page in
  // English instead of falling back to the CEC Cyrillic nickname.
  const { displayNameFor, colorFor } = useCanonicalParties();

  // A single-election section has no trend to show; the pipeline already
  // drops those, this is a defensive guard for the loading/404 case.
  if (!history || history.length < 2) return null;

  const screened = history.filter(
    (e) => e.band && ELEVATED_BANDS.has(e.band),
  ).length;

  return (
    <StatCard
      label={
        <Hint text={t("risk_history_hint")} underline={false}>
          <div className="flex items-center gap-2">
            <History className="h-4 w-4" />
            <span>{t("risk_history_title")}</span>
          </div>
        </Hint>
      }
    >
      <p className="text-sm text-muted-foreground leading-relaxed mt-1">
        {screened > 0
          ? t("risk_history_headline", {
              count: screened,
              total: history.length,
            })
          : t("risk_history_headline_none", { total: history.length })}
      </p>

      {/* The winner-share column is dropped below `sm` so the winner name
        keeps a readable width — turnout and band stay, the core signals. */}
      <div className="mt-2 grid grid-cols-[auto_minmax(0,1fr)_auto_auto] sm:grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] gap-y-1 items-center text-sm">
        <span className={cn(HEADER_CLASS, "px-2")}>
          {t("risk_history_col_election")}
        </span>
        <span className={cn(HEADER_CLASS, "px-2")}>{t("winner")}</span>
        <span className={cn(HEADER_CLASS, "hidden sm:block px-2 text-right")}>
          {t("risk_history_col_share")}
        </span>
        <span className={cn(HEADER_CLASS, "px-2 text-right")}>
          {t("risk_history_col_turnout")}
        </span>
        <span className={cn(HEADER_CLASS, "px-2 text-right")}>
          {t("risk_col_band")}
        </span>
        {history.map((e) => {
          const isSelected = e.election === selected;
          const name = e.winnerNickName
            ? (displayNameFor(e.winnerNickName) ?? e.winnerNickName)
            : undefined;
          const color =
            (e.winnerNickName && colorFor(e.winnerNickName)) ||
            e.winnerColor ||
            "#888";
          // Row highlight applied per-cell because the grid rows use
          // `display: contents` — there is no row element to style.
          const cell = (extra?: string) =>
            cn("py-1.5", isSelected && "bg-muted", extra);
          return (
            <div className="contents" key={e.election}>
              <span
                className={cell(
                  cn(
                    "rounded-l-md px-2 text-xs tabular-nums whitespace-nowrap",
                    isSelected ? "font-bold" : "text-muted-foreground",
                  ),
                )}
              >
                {localDate(e.election)}
              </span>
              <div className={cell("flex items-center gap-2 min-w-0 px-2")}>
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: color }}
                />
                <span className="truncate text-xs font-medium" title={name}>
                  {name ?? "—"}
                </span>
              </div>
              <span
                className={cell(
                  "hidden sm:block px-2 text-xs tabular-nums text-right",
                )}
              >
                {e.winnerSharePct != null
                  ? formatPct(e.winnerSharePct, 1)
                  : "—"}
              </span>
              <span className={cell("px-2 text-xs tabular-nums text-right")}>
                {formatPct(e.turnoutPct, 1)}
              </span>
              <span className={cell("rounded-r-md px-2 text-right")}>
                {e.band ? (
                  <RiskBandBadge band={e.band} score={e.score} size="sm" />
                ) : (
                  <span className="text-[10px] text-muted-foreground">
                    {t("risk_history_no_signals")}
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </StatCard>
  );
};
