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

import { FC, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Ban,
  Check,
  ChevronDown,
  Gavel,
  Landmark,
  Link as LinkIcon,
  Minus,
  Repeat,
  Scissors,
  ShieldCheck,
  Sparkles,
  Timer,
  TrendingUp,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Tooltip } from "@/ux/Tooltip";
import { formatEurCompact } from "@/lib/currency";
import { formatShare, criColor } from "@/lib/riskGrade";
import { SignalPill } from "@/screens/components/procurement/SignalPill";
import type { ContractRiskResult } from "@/data/procurement/useContractRiskFlags";
import type { RiskComponentKey } from "@/data/procurement/computeProcurementRisk";

/** The full applicable-check catalogue, ordered heaviest-first so the explained
 *  list reads worst-to-least within each state bucket. Each entry maps a check
 *  to its human label (`_long`), the "why this matters" line (`_hint`), the
 *  reason it can be unavailable (`naReasonKey`), and an optional source ref. */
type CheckMeta = {
  key: RiskComponentKey;
  icon: LucideIcon;
  labelKey: string;
  whyKey: string;
  naReasonKey: string;
  ref?: string;
};

const CHECK_CATALOG: CheckMeta[] = [
  {
    key: "debarred",
    icon: Ban,
    labelKey: "risk_flag_debarred_long",
    whyKey: "risk_flag_debarred_hint",
    naReasonKey: "risk_na_generic",
    ref: "АОП",
  },
  {
    key: "appealUpheld",
    icon: Gavel,
    labelKey: "risk_flag_appeal_upheld_long",
    whyKey: "risk_flag_appeal_upheld_hint",
    naReasonKey: "risk_na_appeal_upheld",
    ref: "КЗК",
  },
  {
    key: "mpConnected",
    icon: LinkIcon,
    labelKey: "risk_flag_mp_connected_long",
    whyKey: "risk_flag_mp_connected_hint",
    naReasonKey: "risk_na_generic",
  },
  {
    key: "weakCompetition",
    icon: Users,
    labelKey: "risk_flag_weak_competition_long",
    whyKey: "risk_flag_weak_competition_hint",
    naReasonKey: "risk_na_weak_competition",
    ref: "Fazekas / GTI",
  },
  {
    key: "pepConnected",
    icon: Landmark,
    labelKey: "risk_flag_pep_connected_long",
    whyKey: "risk_flag_pep_connected_hint",
    naReasonKey: "risk_na_pep_connected",
  },
  {
    key: "awarderConcentration",
    icon: AlertTriangle,
    labelKey: "risk_flag_concentration_long",
    whyKey: "risk_flag_concentration_hint",
    naReasonKey: "risk_na_generic",
    ref: "Fazekas / GTI",
  },
  {
    key: "annexGrowth",
    icon: TrendingUp,
    labelKey: "risk_flag_annex_growth_long",
    whyKey: "risk_flag_annex_growth_hint",
    naReasonKey: "risk_na_annex_growth",
    ref: "ЗОП чл.116 ал.2",
  },
  {
    key: "newFirmWinner",
    icon: Sparkles,
    labelKey: "risk_flag_new_firm_long",
    whyKey: "risk_flag_new_firm_hint",
    naReasonKey: "risk_na_new_firm",
    ref: "K-Index P4",
  },
  {
    key: "splitPurchase",
    icon: Scissors,
    labelKey: "risk_flag_split_long",
    whyKey: "risk_flag_split_hint",
    naReasonKey: "risk_na_generic",
    ref: "ЗОП чл.20 ал.4",
  },
  {
    key: "directAward",
    icon: Gavel,
    labelKey: "risk_flag_direct_award_long",
    whyKey: "risk_flag_direct_award_hint",
    naReasonKey: "risk_na_direct_award",
    ref: "Fazekas / GTI",
  },
  {
    key: "shortTenderPeriod",
    icon: Timer,
    labelKey: "risk_flag_short_period_long",
    whyKey: "risk_flag_short_period_hint",
    naReasonKey: "risk_na_short_period",
    ref: "ЕС 2014/24 чл.27",
  },
  {
    key: "amendment",
    icon: Repeat,
    labelKey: "risk_flag_amendment_long",
    whyKey: "risk_flag_amendment_hint",
    naReasonKey: "risk_na_generic",
    ref: "ЗОП чл.116",
  },
];

type Props = {
  result: ContractRiskResult;
  /** "full" adds the explainable flags-fired meter; used on the detail header. */
  variant?: "chips" | "full";
};

export const RiskBadges: FC<Props> = ({ result, variant = "chips" }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [open, setOpen] = useState(false);
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
          <SignalPill
            tone="orange"
            icon={<AlertTriangle className="h-3 w-3" />}
          >
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

  // The concrete datum shown as a pill next to a fired check (share %, bid
  // count, annex growth, firm age, tender days, split size).
  const bidWord = (n: number) =>
    n === 1
      ? lang === "bg"
        ? "оферта"
        : "bid"
      : lang === "bg"
        ? "оферти"
        : "bids";
  const firedValue = (key: RiskComponentKey): string | null => {
    switch (key) {
      case "awarderConcentration":
        return flags.awarderConcentration
          ? formatShare(flags.awarderConcentration.sharePct, lang)
          : null;
      case "weakCompetition":
        return flags.bidCount != null
          ? `${flags.bidCount} ${bidWord(flags.bidCount)}`
          : null;
      case "annexGrowth":
        return flags.annexGrowthPct != null
          ? `+${formatShare(flags.annexGrowthPct, lang)}`
          : null;
      case "newFirmWinner":
        return flags.newFirmMonths != null
          ? `${flags.newFirmMonths} ${t("risk_flag_new_firm_months") || "mo"}`
          : null;
      case "shortTenderPeriod":
        return flags.tenderPeriodDays != null
          ? `${flags.tenderPeriodDays}${t("risk_flag_short_period_days_abbr") || "d"}`
          : null;
      case "splitPurchase":
        return flags.splitPurchase
          ? `${flags.splitPurchase.contractCount}×`
          : null;
      default:
        return null;
    }
  };

  // Explained, collapsed-by-default check ledger for the detail header. The
  // summary line ("N of M applicable checks") IS the toggle; rows are sorted
  // fired → passed → not-applicable, catalogue order (severity) breaking ties.
  const byKey = new Map(result.components.map((c) => [c.key, c]));
  const stateRank = (key: RiskComponentKey) => {
    const c = byKey.get(key);
    if (!c || !c.available) return 2;
    return c.fired ? 0 : 1;
  };
  const rows = [...CHECK_CATALOG].sort(
    (a, b) => stateRank(a.key) - stateRank(b.key),
  );

  // Nothing evaluable (never happens in practice — 5 checks are always
  // available — but keep a static fallback rather than an empty toggle).
  if (availableCount === 0) {
    return (
      <div className="inline-flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-300">
        <ShieldCheck className="h-4 w-4" />
        <span>{t("risk_cri_clear") || "No flags fired"}</span>
      </div>
    );
  }

  // One cell per applicable check (the "M" denominator), fired-first: red for
  // the authoritative flags (debarred / КЗК-upheld), amber for review signals,
  // emerald for a passed check. Previews the ledger without opening it.
  const isAuthoritative = (key: RiskComponentKey) =>
    key === "debarred" || key === "appealUpheld";
  const cellRank = (c: (typeof result.components)[number]) =>
    c.fired ? (isAuthoritative(c.key) ? 0 : 1) : 2;
  const cells = result.components
    .filter((c) => c.available)
    .sort((a, b) => cellRank(a) - cellRank(b));

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="group flex w-full flex-wrap items-center gap-2 text-left"
      >
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
        {hasFlag ? (
          <>
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
          </>
        ) : (
          <>
            <ShieldCheck
              className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
              aria-hidden
            />
            <span className="text-sm text-emerald-700 dark:text-emerald-300">
              {t("risk_cri_clear") || "No flags fired"}
            </span>
            <span className="text-xs text-muted-foreground">
              {" · "}
              {availableCount} {t("risk_cri_checks") || "applicable checks"}
            </span>
          </>
        )}
        <span className="ml-auto flex items-center gap-[3px]" aria-hidden>
          {cells.map((c, i) => (
            <span
              key={`${c.key}-${i}`}
              className={`h-2 w-3 rounded-[2px] ${
                c.fired
                  ? isAuthoritative(c.key)
                    ? "bg-red-500"
                    : "bg-amber-500"
                  : "bg-emerald-500"
              }`}
            />
          ))}
        </span>
      </button>

      {open ? (
        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <p className="mb-2 text-xs leading-relaxed text-muted-foreground">
            {t("risk_explain_intro") ||
              "Automated risk indicators — descriptive, not a verdict. Each compares this contract against the market norm."}
          </p>
          {rows.map((item) => {
            const comp = byKey.get(item.key);
            const state: "fired" | "pass" | "na" = !comp?.available
              ? "na"
              : comp.fired
                ? "fired"
                : "pass";
            const authoritative =
              item.key === "debarred" || item.key === "appealUpheld";
            const Icon =
              state === "fired" ? item.icon : state === "pass" ? Check : Minus;
            const iconCls =
              state === "fired"
                ? authoritative
                  ? "text-red-600 dark:text-red-400"
                  : "text-amber-600 dark:text-amber-400"
                : state === "pass"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-muted-foreground/60";
            const value = state === "fired" ? firedValue(item.key) : null;
            return (
              <div
                key={item.key}
                className="flex items-start gap-2 border-t border-border/60 py-2 first:border-t-0"
              >
                <Icon
                  className={`mt-0.5 h-4 w-4 shrink-0 ${iconCls}`}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={`text-sm ${state === "na" ? "text-muted-foreground" : "text-foreground"}`}
                    >
                      {t(item.labelKey)}
                    </span>
                    {value ? (
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${
                          authoritative
                            ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
                            : "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                        }`}
                      >
                        {value}
                      </span>
                    ) : null}
                    {state === "na" ? (
                      <span className="rounded-full border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        {t("risk_na") || "not applicable"}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {t(item.whyKey)}
                    {item.ref ? (
                      <span className="text-muted-foreground/70">
                        {" · "}
                        {item.ref}
                      </span>
                    ) : null}
                  </p>
                  {state === "na" ? (
                    <p className="mt-0.5 text-xs text-muted-foreground/70">
                      {t(item.naReasonKey)}
                    </p>
                  ) : null}
                  {item.key === "debarred" &&
                  state === "fired" &&
                  flags.debarred?.detailsUrl ? (
                    <a
                      href={flags.debarred.detailsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-0.5 inline-block text-xs text-primary hover:underline"
                    >
                      {t("risk_flag_debarred_source") || "КЗК decision (PDF)"}
                    </a>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};
