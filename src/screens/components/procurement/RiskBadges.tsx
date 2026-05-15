// Inline red-flag chips for a single procurement contract row. Each chip
// represents one signal in computeRiskFlags() and carries a tooltip with the
// supporting detail (which MP, what concentration share, debarment dates).
//
// The chip strip is meant to live in a compact table cell — labels are short
// localised abbreviations and the cell falls back to a dash when no flag
// fires.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Ban, Link as LinkIcon, Repeat } from "lucide-react";
import { Tooltip } from "@/ux/Tooltip";
import type { ContractRiskResult } from "@/data/procurement/useContractRiskFlags";

type Props = {
  result: ContractRiskResult;
  /** When true, render the score number alongside the chips. Used in tables;
   *  detail-page header uses the chips without the bare score. */
  showScore?: boolean;
};

const chipBase =
  "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide";

const formatPct = (frac: number, lang: string): string =>
  new Intl.NumberFormat(lang === "bg" ? "bg-BG" : "en-GB", {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(frac);

export const RiskBadges: FC<Props> = ({ result, showScore }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { flags, score, hasFlag } = result;

  if (!hasFlag) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  return (
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

      {flags.awarderConcentration ? (
        <Tooltip
          content={
            <div className="space-y-1">
              <div className="font-medium">
                {t("risk_flag_concentration_long") ||
                  "Awarder concentrated on this contractor"}
              </div>
              <div className="text-xs tabular-nums">
                {formatPct(flags.awarderConcentration.sharePct, lang)}{" "}
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
            {formatPct(flags.awarderConcentration.sharePct, lang)}
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
};
