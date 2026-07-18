// "Сигнали за риск при процедурата" — the ex-ante procedure-grain risk panel on
// the tender detail page. Companion to the contract-stage RiskBadges meter, but
// keyed off the TENDER (the procedure), so it makes a statement about the buyer's
// conduct rather than about any winner. Same non-verdict framing: a fired-of-
// applicable ratio + chips, never a bare 0..100. Scored by computeTenderRisk()
// on thresholds calibrated in scripts/procurement/tender_base_rates.sql.

import { FC, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Gavel,
  Timer,
  CalendarClock,
  TrendingUp,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { criColor } from "@/lib/riskGrade";
import { type SignalTone } from "@/screens/components/procurement/SignalPill";
import {
  SignalPillStrip,
  type SignalPillItem,
} from "@/screens/components/procurement/SignalPillStrip";
import {
  computeTenderRisk,
  type TenderRiskKey,
  type TenderRiskInput,
  type TenderRiskResult,
} from "@/data/procurement/computeTenderRisk";
import type { Tender } from "@/lib/tenderTypes";
import type { TenderAward } from "@/data/procurement/useTender";

type FlagMeta = {
  icon: ReactNode;
  tone: SignalTone;
  short: [string, string]; // [key, fallback]
  long: [string, string];
  hint: [string, string];
};

const FLAG_META: Record<TenderRiskKey, FlagMeta> = {
  nonOpenProcedure: {
    icon: <Gavel className="h-3 w-3" />,
    tone: "red",
    short: ["risk_flag_non_open", "Non-open"],
    long: ["risk_flag_non_open_long", "Non-open procedure"],
    hint: [
      "risk_flag_non_open_hint",
      "A procedure with no open call for bids — direct negotiation or an invitation to specific firms.",
    ],
  },
  rushedDeadline: {
    icon: <Timer className="h-3 w-3" />,
    tone: "amber",
    short: ["risk_flag_rushed_deadline", "Rushed window"],
    long: ["risk_flag_rushed_deadline_long", "Rushed submission window"],
    hint: [
      "risk_flag_rushed_deadline_hint",
      "The submission window is below the norm for a competitive procedure.",
    ],
  },
  shortDecisionPeriod: {
    icon: <CalendarClock className="h-3 w-3" />,
    tone: "amber",
    short: ["risk_flag_short_decision", "Fast decision"],
    long: ["risk_flag_short_decision_long", "Rushed award decision"],
    hint: [
      "risk_flag_short_decision_hint",
      "The contract was signed only days after the submission deadline.",
    ],
  },
  awardOverEstimate: {
    icon: <TrendingUp className="h-3 w-3" />,
    tone: "red",
    short: ["risk_flag_award_over_estimate", "Over estimate"],
    long: ["risk_flag_award_over_estimate_long", "Awards exceed the estimate"],
    hint: [
      "risk_flag_award_over_estimate_hint",
      "The awarded contracts sum to more than the procedure's forecast value — the estimate was overshot.",
    ],
  },
};

export const TenderRiskPanel: FC<{ tender: Tender; awards: TenderAward[] }> = ({
  tender,
  awards,
}) => {
  const { t } = useTranslation();
  const r = computeTenderRisk(tender, awards);

  // Nothing was evaluable (no procedure type, no window, not awarded) → say
  // nothing rather than render an empty shell.
  if (r.availableCount === 0) return null;

  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm space-y-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <ShieldAlert className="h-4 w-4 text-rose-600" />
        {t("tender_risk_title") || "Procedure risk flags"}
      </h2>

      {!r.hasFlag ? (
        <div className="inline-flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-300">
          <ShieldCheck className="h-4 w-4" />
          <span>
            {t("risk_cri_clear") || "No flags fired"}
            <span className="text-muted-foreground">
              {" · "}
              {r.availableCount}{" "}
              {t("risk_cri_checks_passed") || "automated checks, none fired"}
            </span>
          </span>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("risk_cri_label") || "Flags fired"}
            </span>
            <span
              className="text-base font-bold tabular-nums"
              style={{ color: criColor(r.cri) }}
            >
              {r.firedCount} {t("risk_cri_of") || "of"} {r.availableCount}
            </span>
            <span className="text-xs text-muted-foreground">
              {t("risk_cri_checks") || "applicable checks"}
            </span>
          </div>
          <div className="h-1.5 w-full max-w-[240px] overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full"
              style={{ width: `${r.cri}%`, backgroundColor: criColor(r.cri) }}
            />
          </div>
          <FlagChips result={r} />
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        {t("tender_risk_note") ||
          "Signals about the procedure, calibrated on the Bulgarian corpus — an indicator for review, not proof of wrongdoing."}
      </p>
    </section>
  );
};

// The fired-flag chip strip, shared by the detail panel and the browser column.
const FlagChips: FC<{ result: TenderRiskResult }> = ({ result }) => {
  const { t } = useTranslation();
  const fired = result.components.filter((c) => c.fired);

  // Per-flag supporting detail line (the calibrated number behind the chip).
  const detailFor = (key: TenderRiskKey): ReactNode => {
    if (key === "rushedDeadline" && result.submissionDays != null)
      return `${t("risk_cri_days_label") || "Window"}: ${result.submissionDays} ${t("risk_flag_short_period_days_abbr") || "d"}`;
    if (key === "shortDecisionPeriod" && result.decisionDays != null)
      return `${t("risk_cri_decision_label") || "Decision"}: ${result.decisionDays} ${t("risk_flag_short_period_days_abbr") || "d"}`;
    if (key === "awardOverEstimate" && result.overrunPct != null)
      return `${t("risk_flag_annex_growth_delta") || "Growth"}: +${Math.round(result.overrunPct * 100)}%`;
    return null;
  };

  const items: SignalPillItem[] = fired.map((c) => {
    const m = FLAG_META[c.key];
    const detail = detailFor(c.key);
    return {
      key: c.key,
      tone: m.tone,
      icon: m.icon,
      label: t(m.short[0]) || m.short[1],
      tooltip: (
        <div className="space-y-1">
          <div className="font-medium">{t(m.long[0]) || m.long[1]}</div>
          <div className="text-xs text-muted-foreground">
            {t(m.hint[0]) || m.hint[1]}
          </div>
          {detail ? <div className="text-xs tabular-nums">{detail}</div> : null}
        </div>
      ),
    };
  });
  // emptyDash=false: callers (TenderRiskChips) already render the dash upstream,
  // and the detail panel wants nothing when no flag fired.
  return <SignalPillStrip items={items} emptyDash={false} />;
};

// Compact chips-only variant for a table cell (e.g. the /procurement/tenders
// browser). No meter/panel chrome; a dash when nothing fired. Awards are absent
// in the browser, so the decision-period check is simply unavailable there.
export const TenderRiskChips: FC<{
  tender: TenderRiskInput;
  awards?: TenderAward[];
}> = ({ tender, awards = [] }) => {
  const r = computeTenderRisk(tender, awards);
  if (!r.hasFlag)
    return <span className="text-xs text-muted-foreground">—</span>;
  return <FlagChips result={r} />;
};
