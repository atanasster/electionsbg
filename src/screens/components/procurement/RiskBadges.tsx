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
  ShieldCheck,
  Timer,
  Users,
} from "lucide-react";
import { Tooltip } from "@/ux/Tooltip";
import { formatShare } from "@/lib/riskGrade";
import type { ContractRiskResult } from "@/data/procurement/useContractRiskFlags";

type Props = {
  result: ContractRiskResult;
  /** When true, render the severity score alongside the chips (tables). */
  showScore?: boolean;
  /** "full" adds the explainable CRI meter; used on the detail header. */
  variant?: "chips" | "full";
};

const chipBase =
  "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide";

// CRI band colour — green (low) → amber (mid) → red (high). Inline style so the
// width-bound meter bar can use the same scale the badge ring implies.
const criColor = (cri: number): string =>
  cri >= 67 ? "#dc2626" : cri >= 34 ? "#d97706" : "#16a34a";

export const RiskBadges: FC<Props> = ({
  result,
  showScore,
  variant = "chips",
}) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { flags, score, cri, firedCount, availableCount, hasFlag } = result;

  if (!hasFlag && variant !== "full") {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  const chips = (
    <div className="flex flex-wrap items-center gap-1">
      {showScore ? (
        <span className="text-xs font-semibold tabular-nums text-muted-foreground">
          {score}
        </span>
      ) : null}

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
          <span
            className={`${chipBase} border-red-300 bg-red-100 text-red-900 dark:border-red-900 dark:bg-red-900/40 dark:text-red-100`}
          >
            <Ban className="h-3 w-3" />
            {t("risk_flag_debarred") || "Debarred"}
          </span>
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
          <span
            className={`${chipBase} border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-900 dark:bg-amber-900/40 dark:text-amber-100`}
          >
            <LinkIcon className="h-3 w-3" />
            {t("risk_flag_mp_connected") || "MP-tied"}
          </span>
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
          <span
            className={`${chipBase} border-teal-300 bg-teal-100 text-teal-900 dark:border-teal-900 dark:bg-teal-900/40 dark:text-teal-100`}
          >
            <Landmark className="h-3 w-3" />
            {t("risk_flag_pep_connected") || "Official-tied"}
          </span>
        </Tooltip>
      ) : null}

      {flags.singleBidder ? (
        <Tooltip
          content={
            <div className="space-y-1">
              <div className="font-medium">
                {t("risk_flag_single_bidder_long") ||
                  "Single bidder in a competitive market"}
              </div>
              <div className="text-xs text-muted-foreground">
                {t("risk_flag_single_bidder_hint") ||
                  "Only one operator bid — the headline procurement-corruption red flag (Fazekas/GTI)."}
              </div>
            </div>
          }
        >
          <span
            className={`${chipBase} border-rose-300 bg-rose-100 text-rose-900 dark:border-rose-900 dark:bg-rose-900/40 dark:text-rose-100`}
          >
            <Users className="h-3 w-3" />
            {t("risk_flag_single_bidder") || "1 bid"}
          </span>
        </Tooltip>
      ) : null}

      {flags.nonOpenProcedure ? (
        <Tooltip
          content={
            <div className="space-y-1">
              <div className="font-medium">
                {t("risk_flag_non_open_long") || "Non-open procedure"}
              </div>
              <div className="text-xs text-muted-foreground">
                {t("risk_flag_non_open_hint") ||
                  "Awarded without an open competition (e.g. negotiated / single-source)."}
              </div>
            </div>
          }
        >
          <span
            className={`${chipBase} border-violet-300 bg-violet-100 text-violet-900 dark:border-violet-900 dark:bg-violet-900/40 dark:text-violet-100`}
          >
            <Gavel className="h-3 w-3" />
            {t("risk_flag_non_open") || "Negotiated"}
          </span>
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
          <span
            className={`${chipBase} border-red-300 bg-red-100 text-red-900 dark:border-red-900 dark:bg-red-900/40 dark:text-red-100`}
          >
            <Gavel className="h-3 w-3" />
            {t("risk_flag_appeal_upheld") || "Appeal upheld"}
          </span>
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
          <span
            className={`${chipBase} border-yellow-300 bg-yellow-100 text-yellow-900 dark:border-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-100`}
          >
            <Timer className="h-3 w-3" />
            {flags.tenderPeriodDays != null
              ? `${flags.tenderPeriodDays}${t("risk_flag_short_period_days_abbr") || "d"}`
              : t("risk_flag_short_period") || "Rushed"}
          </span>
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
          <span
            className={`${chipBase} border-orange-300 bg-orange-100 text-orange-900 dark:border-orange-900 dark:bg-orange-900/40 dark:text-orange-100`}
          >
            <AlertTriangle className="h-3 w-3" />
            {formatShare(flags.awarderConcentration.sharePct, lang)}
          </span>
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
          <span
            className={`${chipBase} border-slate-300 bg-slate-100 text-slate-900 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100`}
          >
            <Repeat className="h-3 w-3" />
            {t("risk_flag_amendment") || "Amend"}
          </span>
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
          {t("risk_cri_clear") || "No red flags"}
          {availableCount > 0 ? (
            <span className="text-muted-foreground">
              {" · "}
              {availableCount} {t("risk_cri_checks_passed") || "checks passed"}
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
          {t("risk_cri_label") || "Risk index"}
        </span>
        <span
          className="text-base font-bold tabular-nums"
          style={{ color: criColor(cri) }}
        >
          {cri}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {firedCount}/{availableCount} {t("risk_cri_checks") || "risk checks"}
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
