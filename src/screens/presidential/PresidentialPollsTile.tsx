// The presidential twin of `src/screens/dashboard/PollsTile.tsx` — Tier 4
// T4.4 (docs/plans/polls-agency-watchers-v1.md §7). Mounted as its own
// `DashboardSection` on `/presidential/:cycle`, right after the round
// panel (a CYCLE-level fact, not a per-round one — decision 10's
// "that cycle's agencies by R1 MAE" framing).
//
// ⚠ NEVER AN EMPTY BAND. A cycle with no scored poll yet (no agency has
// been accepted AND stamped to this cycle — decision 11's `cycle: null`
// window, or simply nobody has published one) renders an honest "not
// verified yet" state, never nothing at all — the section always mounts
// once this cycle's summary itself is real (the caller's own guard).
//
// ⚠ NO PARTY COLOUR CHIP, unlike `PollsTile`'s `biggestMiss` cell —
// `PresidentialCandidateResultError.key` is a `CandidateKey` (a person,
// or the literal "други"/"none"), never a party, so `useCanonicalParties`
// does not apply here. `PresidentialPersonName` is reused instead — the
// SAME component the outcome canvas and ranking table already use, so a
// candidate is never a link in one place and bare text in another about
// the same person on the same page.

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
