// Legacy compact view of the analyzer's complete round-one projection.
// The election page now uses PresidentialHistory for question-level history,
// partial comparisons, diagnostics and independent round selection.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { usePresidentialCycleAccuracy } from "@/data/presidential/usePresidentialPolls";
import { Hint } from "@/ux/Hint";
import {
  agencyMaeBarStyle,
  missColorClass,
  missSign,
} from "@/screens/dashboard/agencyMaeBar";
import { PresidentialPersonName } from "./PresidentialPersonName";

const UnscoredMessage: FC = () => {
  const { t } = useTranslation();
  return (
    <p className="text-sm text-muted-foreground">
      {t("presidential_polls_unscored")}
    </p>
  );
};

export const PresidentialPollsTile: FC<{ cycle: string }> = ({ cycle }) => {
  const { t } = useTranslation();
  const state = usePresidentialCycleAccuracy(cycle);

  if (state.status === "loading") return null;
  if (state.status === "error")
    return (
      <div role="alert">
        {t("pp_history_load_error")}{" "}
        <button className="underline" onClick={state.retry}>
          {t("pp_history_retry")}
        </button>
      </div>
    );

  const agencies =
    state.status === "ready"
      ? [...state.cycle.agencies].sort((a, b) => a.mae - b.mae)
      : [];
  if (agencies.length === 0) return <UnscoredMessage />;
  const maxMae = Math.max(0.01, ...agencies.map((a) => a.mae));

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(160px,4fr)_auto_auto_minmax(0,1.2fr)] gap-x-3 gap-y-1.5 items-center text-sm">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {t("polls_agency")}
      </span>
      <span />
      <Hint text={t("presidential_polls_mae_hint")} underline={false}>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          MAE
        </span>
      </Hint>
      <Hint text={t("dashboard_polls_days_before_hint")} underline={false}>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("polls_days_before")}
        </span>
      </Hint>
      <Hint text={t("presidential_polls_biggest_miss_hint")} underline={false}>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("polls_biggest_miss")}
        </span>
      </Hint>
      {agencies.map((a) => {
        const { widthPct, hue } = agencyMaeBarStyle(a.mae, maxMae);
        const sign = missSign(a.biggestMiss.error);
        const missColor = missColorClass(a.biggestMiss.error);
        const missRow = a.errors.find((e) => e.key === a.biggestMiss.key);
        return (
          <div className="contents" key={a.agencyId}>
            <span className="font-medium truncate">{a.agencyId}</span>
            <div className="relative h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="absolute top-0 bottom-0 left-0 rounded-full"
                style={{
                  width: `${widthPct}%`,
                  backgroundColor: `hsl(${hue} 70% 45%)`,
                }}
              />
            </div>
            <span className="tabular-nums text-xs font-semibold text-right">
              {a.mae.toFixed(2)}
            </span>
            <span className="tabular-nums text-xs text-muted-foreground text-right">
              {a.daysBefore}d
            </span>
            <span className="text-xs truncate flex items-center gap-1.5 min-w-0">
              {missRow &&
              a.biggestMiss.key !== "други" &&
              a.biggestMiss.key !== "none" ? (
                <PresidentialPersonName name={missRow.name_bg} />
              ) : (
                <span className="font-medium truncate">
                  {missRow?.name_bg ?? a.biggestMiss.key}
                </span>
              )}
              <span
                className={`tabular-nums font-semibold shrink-0 ${missColor}`}
              >
                {sign}
                {a.biggestMiss.error.toFixed(1)}pp
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
};
