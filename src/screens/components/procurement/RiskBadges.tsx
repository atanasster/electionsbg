// Inline red-flag chips for a single procurement contract row. Each chip is one
// check in computeProcurementRisk() and carries a tooltip with the supporting
// detail (which MP, what concentration share, bid count, debarment dates).
//
// Two layouts:
//   - variant="chips" (default): compact strip for a table cell — short
//     localised abbreviations, falls back to a dash when no flag fires.
//   - variant="full": an explainable Corruption Risk Index meter ("N of M risk
//     checks failed" + a colour bar) above the chips, for the contract detail
//     header. When nothing fired it reads as "no red flags · N checks passed"
//     rather than a bare dash.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Ban,
  Gavel,
  Landmark,
  Link as LinkIcon,
  Repeat,
  Scissors,
  ShieldCheck,
  Sparkles,
  Timer,
  TrendingUp,
  Users,
} from "lucide-react";
import { Tooltip } from "@/ux/Tooltip";
import { formatEurCompact } from "@/lib/currency";
import { formatShare, criColor } from "@/lib/riskGrade";
import { SignalPill } from "@/screens/components/procurement/SignalPill";
import type { ContractRiskResult } from "@/data/procurement/useContractRiskFlags";

type Props = {
  result: ContractRiskResult;
  /** "full" adds the explainable flags-fired meter; used on the detail header. */
  variant?: "chips" | "full";
};

export const RiskBadges: FC<Props> = ({ result, variant = "chips" }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { flags, cri, firedCount, availableCount, hasFlag } = result;

  if (!hasFlag && variant !== "full") {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  const chips = (
    <div className="flex flex-wrap items-center gap-1">
      {flags.debarred ? (
        <Tooltip
          content={
            <div className="space-y-1">
              <div className="font-medium">
                {t("risk_flag_debarred_long") ||
                  "On АОП debarred-suppliers register"}
              </div>
              <div className="text-xs text-muted-foreground">
                {flags.debarred.name}
              </div>
              <div className="text-xs">
                {t("risk_flag_debarred_until") || "Debarred until"}:{" "}
                <span className="tabular-nums">
                  {flags.debarred.debarredUntil || "—"}
                </span>
              </div>
              {flags.debarred.detailsUrl ? (
                <a
                  href={flags.debarred.detailsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-primary hover:underline"
                >
                  {t("risk_flag_debarred_source") || "КЗК decision (PDF)"}
                </a>
              ) : null}
            </div>
          }
        >
          <SignalPill tone="red" icon={<Ban className="h-3 w-3" />}>
            {t("risk_flag_debarred") || "Debarred"}
          </SignalPill>
        </Tooltip>
      ) : null}

      {flags.mpConnected ? (
        <Tooltip
          content={
            <div className="space-y-1">
              <div className="font-medium">
                {t("risk_flag_mp_connected_long") ||
                  "Contractor is connected to an MP"}
              </div>
              <div className="text-xs text-muted-foreground">
                {t("risk_flag_mp_connected_hint") ||
                  "An MP appears as a declared officer or owner of this company."}
              </div>
            </div>
          }
        >
          <SignalPill tone="amber" icon={<LinkIcon className="h-3 w-3" />}>
            {t("risk_flag_mp_connected") || "MP-tied"}
          </SignalPill>
        </Tooltip>
      ) : null}

      {flags.pepConnected ? (
        <Tooltip
          content={
            <div className="space-y-1">
              <div className="font-medium">
                {t("risk_flag_pep_connected_long") ||
                  "Contractor tied to a public official"}
              </div>
              <div className="text-xs text-muted-foreground">
                {t("risk_flag_pep_connected_hint") ||
                  "A mayor, councillor, minister, governor or agency head appears as a declared officer or owner."}
              </div>
            </div>
          }
        >
          <SignalPill tone="teal" icon={<Landmark className="h-3 w-3" />}>
            {t("risk_flag_pep_connected") || "Official-tied"}
          </SignalPill>
        </Tooltip>
      ) : null}

      {flags.weakCompetition ? (
        <Tooltip
          content={
            <div className="space-y-1">
              <div className="font-medium">
                {t("risk_flag_weak_competition_long") || "Weak competition"}
              </div>
              <div className="text-xs text-muted-foreground">
                {t("risk_flag_weak_competition_hint") ||
                  "A single bidder, or materially fewer bidders than the sector norm — awards land closer to the buyer's estimate (Fazekas/GTI)."}
              </div>
            </div>
          }
        >
          <SignalPill tone="rose" icon={<Users className="h-3 w-3" />}>
            {flags.bidCount != null
              ? `${flags.bidCount} ${
                  flags.bidCount === 1
                    ? lang === "bg"
                      ? "оферта"
                      : "bid"
                    : lang === "bg"
                      ? "оферти"
                      : "bids"
                }`
              : t("risk_flag_weak_competition") || "Weak competition"}
          </SignalPill>
        </Tooltip>
      ) : null}

      {flags.directAward ? (
        <Tooltip
          content={
            <div className="space-y-1">
              <div className="font-medium">
                {t("risk_flag_direct_award_long") || "Direct / no-notice award"}
              </div>
              <div className="text-xs text-muted-foreground">
                {t("risk_flag_direct_award_hint") ||
                  "Awarded without any call for competition (negotiated / single-source) — the awards that land at the estimate."}
              </div>
            </div>
          }
        >
          <SignalPill tone="violet" icon={<Gavel className="h-3 w-3" />}>
            {t("risk_flag_direct_award") || "Direct award"}
          </SignalPill>
        </Tooltip>
      ) : null}

      {flags.appealUpheld ? (
        <Tooltip
          content={
            <div className="space-y-1">
              <div className="font-medium">
                {t("risk_flag_appeal_upheld_long") ||
                  "КЗК upheld an appeal against this procedure"}
              </div>
              <div className="text-xs text-muted-foreground">
                {t("risk_flag_appeal_upheld_hint") ||
                  "The Competition Protection Commission annulled the buyer's award decision — an official finding it was improper (not just a heuristic flag)."}
              </div>
            </div>
          }
        >
          <SignalPill tone="red" icon={<Gavel className="h-3 w-3" />}>
            {t("risk_flag_appeal_upheld") || "Appeal upheld"}
          </SignalPill>
        </Tooltip>
      ) : null}

      {flags.shortTenderPeriod ? (
        <Tooltip
          content={
            <div className="space-y-1">
              <div className="font-medium">
                {t("risk_flag_short_period_long") || "Short tender window"}
              </div>
              <div className="text-xs text-muted-foreground">
                {flags.tenderPeriodDays != null
                  ? `${flags.tenderPeriodDays} ${t("risk_flag_short_period_days") || "days"} — `
                  : ""}
                {t("risk_flag_short_period_hint") ||
                  "Below the 14-day EU reference open-procedure window."}
              </div>
            </div>
          }
        >
          <SignalPill tone="yellow" icon={<Timer className="h-3 w-3" />}>
            {flags.tenderPeriodDays != null
              ? `${flags.tenderPeriodDays}${t("risk_flag_short_period_days_abbr") || "d"}`
              : t("risk_flag_short_period") || "Rushed"}
          </SignalPill>
        </Tooltip>
      ) : null}

      {flags.awarderConcentration ? (
        <Tooltip
          content={
            <div className="space-y-1">
              <div className="font-medium">
                {t("risk_flag_concentration_long") ||
                  "Awarder concentrated on this contractor"}
              </div>
              <div className="text-xs tabular-nums">
                {formatShare(flags.awarderConcentration.sharePct, lang)}{" "}
                {t("risk_flag_concentration_of") || "of buyer's lifetime spend"}
              </div>
              <div className="text-xs text-muted-foreground">
                {flags.awarderConcentration.contractCount}{" "}
                {t("risk_flag_concentration_contracts") || "contracts"}
              </div>
            </div>
          }
        >
          <SignalPill tone="orange" icon={<AlertTriangle className="h-3 w-3" />}>
            {formatShare(flags.awarderConcentration.sharePct, lang)}
          </SignalPill>
        </Tooltip>
      ) : null}

      {flags.isAmendment ? (
        <Tooltip
          content={
            <div className="space-y-1">
              <div className="font-medium">
                {t("risk_flag_amendment_long") || "Post-award amendment"}
              </div>
              <div className="text-xs text-muted-foreground">
                {t("risk_flag_amendment_hint") ||
                  "This row revises an earlier contract — common vehicle for value inflation outside the original procedure."}
              </div>
            </div>
          }
        >
          <SignalPill tone="slate" icon={<Repeat className="h-3 w-3" />}>
            {t("risk_flag_amendment") || "Amend"}
          </SignalPill>
        </Tooltip>
      ) : null}

      {flags.annexGrowth ? (
        <Tooltip
          content={
            <div className="space-y-1">
              <div className="font-medium">
                {t("risk_flag_annex_growth_long") ||
                  "Value grew to the annex cap"}
              </div>
              <div className="text-xs text-muted-foreground">
                {t("risk_flag_annex_growth_hint") ||
                  "Signed value grew by ≥50% via annexes — at or over the ЗОП чл.116 ал.2 cumulative cap. A permitted inflation indexation carries its own cap, so this is a signal for review, not a proven breach."}
              </div>
              {flags.annexGrowthPct != null ? (
                <div className="text-xs tabular-nums">
                  {t("risk_flag_annex_growth_delta") || "Growth"}: +
                  {formatShare(flags.annexGrowthPct, lang)}
                </div>
              ) : null}
            </div>
          }
        >
          <SignalPill tone="red" icon={<TrendingUp className="h-3 w-3" />}>
            +{formatShare(flags.annexGrowthPct ?? 0, lang)}
          </SignalPill>
        </Tooltip>
      ) : null}

      {flags.newFirmWinner ? (
        <Tooltip
          content={
            <div className="space-y-1">
              <div className="font-medium">
                {t("risk_flag_new_firm_long") ||
                  "Contractor formed just before winning"}
              </div>
              <div className="text-xs text-muted-foreground">
                {t("risk_flag_new_firm_hint") ||
                  "The company was incorporated less than a year before this award — a newly-formed firm winning public money."}
              </div>
              {flags.newFirmMonths != null ? (
                <div className="text-xs tabular-nums">
                  {t("risk_flag_new_firm_age") || "Age at award"}:{" "}
                  {flags.newFirmMonths} {t("risk_flag_new_firm_months") || "mo"}
                </div>
              ) : null}
            </div>
          }
        >
          <SignalPill tone="fuchsia" icon={<Sparkles className="h-3 w-3" />}>
            {t("risk_flag_new_firm") || "New firm"}
          </SignalPill>
        </Tooltip>
      ) : null}

      {flags.splitPurchase ? (
        <Tooltip
          content={
            <div className="space-y-1">
              <div className="font-medium">
                {t("risk_flag_split_long") ||
                  "Pattern consistent with split purchasing"}
              </div>
              <div className="text-xs text-muted-foreground">
                {t("risk_flag_split_hint") ||
                  "Several direct awards to this supplier in the same CPV class and year, each under the direct-award ceiling but together over it. чл. 20 ал. 4 permits separate recurring needs — this is a signal for review, not a proven breach."}
              </div>
              <div className="text-xs tabular-nums">
                {flags.splitPurchase.contractCount}{" "}
                {t("risk_flag_split_contracts") || "direct awards"} ·{" "}
                {formatEurCompact(flags.splitPurchase.totalEur, lang)} ·{" "}
                {t("risk_flag_split_ceiling") || "ceiling"}{" "}
                {formatEurCompact(flags.splitPurchase.ceilingEur, lang)}
              </div>
            </div>
          }
        >
          <SignalPill tone="amber" icon={<Scissors className="h-3 w-3" />}>
            {t("risk_flag_split") || "Split?"}
          </SignalPill>
        </Tooltip>
      ) : null}
    </div>
  );

  if (variant !== "full") return chips;

  // Explainable CRI meter for the detail header.
  if (!hasFlag) {
    return (
      <div className="inline-flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-300">
        <ShieldCheck className="h-4 w-4" />
        <span>
          {t("risk_cri_clear") || "No flags fired"}
          {availableCount > 0 ? (
            <span className="text-muted-foreground">
              {" · "}
              {availableCount}{" "}
              {t("risk_cri_checks_passed") || "automated checks, none fired"}
            </span>
          ) : null}
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("risk_cri_label") || "Flags fired"}
        </span>
        <span
          className="text-base font-bold tabular-nums"
          style={{ color: criColor(cri) }}
        >
          {firedCount} {t("risk_cri_of") || "of"} {availableCount}
        </span>
        <span className="text-xs text-muted-foreground">
          {t("risk_cri_checks") || "applicable checks"}
        </span>
      </div>
      <div className="h-1.5 w-full max-w-[240px] overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full"
          style={{ width: `${cri}%`, backgroundColor: criColor(cri) }}
        />
      </div>
      {chips}
    </div>
  );
};
