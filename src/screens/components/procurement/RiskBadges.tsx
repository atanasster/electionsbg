// Inline red-flag chips for a single procurement contract row. Each chip is one
// check in computeProcurementRisk() and carries a tooltip with the supporting
// detail (which MP, what concentration share, bid count, debarment dates).
//
// Two layouts:
//   - variant="chips" (default): compact strip for a table cell — short
//     localised abbreviations, falls back to a dash when no flag fires.
//   - variant="full": the contract detail header — the A–F grade, the "N of M
//     applicable checks" meter, and the ALWAYS-OPEN ledger explaining every
//     check (fired → passed → not applicable). When nothing fired it reads as
//     "no red flags · N checks passed" rather than a bare dash.

import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Ban,
  Check,
  Gavel,
  Globe,
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
import { useContractRiskDetail } from "@/data/procurement/useContractRiskDetail";
import { formatEurCompact } from "@/lib/currency";
import {
  formatShare,
  criColor,
  GRADE_TONE,
  type RiskGradeLetter,
} from "@/lib/riskGrade";
import { SignalPill } from "@/screens/components/procurement/SignalPill";
import type { ContractRiskResult } from "@/data/procurement/useContractRiskFlags";
import type {
  RiskComponentKey,
  NgoForeignFundedEntry,
} from "@/data/procurement/computeProcurementRisk";
import { Link } from "react-router-dom";
import type { TFunction } from "i18next";

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

const CHECK_CATALOG = [
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
] satisfies readonly CheckMeta[];

/** COMPILE-TIME COMPLETENESS. `satisfies` above preserves each entry's literal
 *  `key`, so this resolves to `never` only when the catalogue covers every
 *  RiskComponentKey. Add a 13th component to the scorer without adding it here
 *  and the build fails with the missing key named in the type error — instead of
 *  the check silently vanishing from the explained ledger, which is the one
 *  surface whose entire job is to say what was and was not checked. */
type MissingFromCatalog = Exclude<
  RiskComponentKey,
  (typeof CHECK_CATALOG)[number]["key"]
>;
const _catalogIsComplete: MissingFromCatalog extends never
  ? true
  : ["CHECK_CATALOG is missing", MissingFromCatalog] = true;
void _catalogIsComplete;

type Props = {
  /** `null` means UNSCORED — the contract has no row in contract_risk_cache, so
   *  nothing is known about it. Rendered as an explicit unknown state, never as
   *  the "—" a genuinely clean contract gets. */
  result: ContractRiskResult | null;
  /** Contract key. When given, the per-flag DETAIL (which MP, what concentration
   *  share, the debarment dates) is fetched — on first hover for `chips`, on
   *  mount for `full`, whose ledger renders it rather than hiding it in a
   *  tooltip. The masks that drive the chips cannot carry it. Omit where the caller already
   *  has fully-populated flags (the old client scorer) or where there is no
   *  single contract to attribute the detail to. */
  contractKey?: string | null;
  /** "full" is the contract detail header: the A–F grade badge, the flags-fired
   *  meter and the always-open check ledger. It fetches the per-flag detail on
   *  mount rather than on dwell (see `contractKey`). */
  variant?: "chips" | "full";
  /** The server's A–F contract grade (`risk_grade`, migration 112) — the SAME
   *  letter the riskiest-contracts board and the `?grade=` browser filter use.
   *  Passed in rather than derived: the masks carry the fired COUNT the grade is
   *  banded on, but re-banding it here would be a second implementation of
   *  `contract_risk_grade_letter()` that could drift from the column the filter
   *  queries. `full` variant only; omit (or null on an unscored row) to hide. */
  grade?: string | null;
  /** Suppress the weak-competition (bid-count) chip — used where the bid count
   *  has its own dedicated table column, so the signals cell isn't redundant. */
  hideWeakCompetition?: boolean;
};

/** Shared body for the foreign-funded-NGO NEUTRAL disclosure (tooltip + the
 *  full-ledger block). Names the NGO (link), its headline funder + total, and —
 *  for the 'connected' kind — the shared board member. Framed as lawful
 *  disclosure, never a "foreign-agent" flag. */
const NgoForeignFundedBody: FC<{
  entry: NgoForeignFundedEntry;
  t: TFunction;
  lang: string;
}> = ({ entry, t, lang }) => (
  <div className="space-y-1">
    <div className="font-medium">
      {entry.kind === "connected"
        ? t("risk_disc_ngo_foreign_connected_long") ||
          "Contractor is tied to a foreign-funded NGO"
        : t("risk_disc_ngo_foreign_long") ||
          "Contractor is an NGO with foreign funding"}
    </div>
    {entry.kind === "connected" && entry.person ? (
      <div className="text-xs text-muted-foreground">
        {entry.person}
        {" · "}
        {t("risk_disc_ngo_foreign_board_of") || "on the board of"}{" "}
        <Link
          to={`/company/${entry.ngoEik}`}
          className="text-primary hover:underline"
        >
          {entry.ngoName}
        </Link>
      </div>
    ) : (
      <div className="text-xs text-muted-foreground">
        <Link
          to={`/company/${entry.ngoEik}`}
          className="text-primary hover:underline"
        >
          {entry.ngoName}
        </Link>
      </div>
    )}
    <div className="text-xs tabular-nums">
      {entry.funder ??
        (t("risk_disc_ngo_foreign_funder_generic") || "Foreign funding")}
      {entry.eur != null ? (
        <>
          {" · "}
          {formatEurCompact(entry.eur, lang)}
        </>
      ) : null}
    </div>
    <div className="text-[11px] leading-relaxed text-muted-foreground/80">
      {t("risk_disc_ngo_foreign_note") ||
        "Lawful disclosure, not a risk flag — foreign funding is not evidence of wrongdoing."}
    </div>
  </div>
);

export const RiskBadges: FC<Props> = ({
  result,
  contractKey,
  variant = "chips",
  grade,
  hideWeakCompetition = false,
}) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  // Detail is fetched on FIRST INTERACTION with this row's chips, not on render:
  // a 100-row table would otherwise issue 100 requests to populate tooltips
  // nobody opened. One hover fetches the whole row's detail, so every chip in it
  // is populated together, and React Query caches it for the session.
  //
  // The `full` variant is the exception and fetches ON MOUNT: its ledger is open
  // from the first paint, so the concentration share, firm age, split size and
  // КЗК link are ON SCREEN rather than inside a tooltip nobody has asked for
  // yet — deferring them to a hover would render those rows visibly incomplete
  // and then pop the numbers in. The cost that motivated the dwell does not
  // apply: `full` renders once per contract page, never in a list.
  const [wantDetail, setWantDetail] = useState(variant === "full");
  // `&& !!result` because this hook sits ABOVE the unscored early return below:
  // an unscored contract renders the `?` mark and none of the detail, so eagerly
  // fetching it there is a request whose response nothing can display.
  const { data: detail } = useContractRiskDetail(
    contractKey,
    wantDetail && !!result,
  );

  // Armed on DWELL, not on transit. onMouseEnter fires for every row a pointer
  // crosses, and /api/db is rate-limited to 120 req/IP/min shared with the
  // table's own queries — so sweeping the Signals column of a 100-row table
  // could 429 the page that is still loading. A short delay means only a row the
  // pointer actually rests on fetches. Cleared on leave, so a crossed row never
  // fires at all.
  const dwell = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelArm = useCallback(() => {
    if (dwell.current) clearTimeout(dwell.current);
    dwell.current = null;
  }, []);
  const armDetail = useCallback(() => {
    if (wantDetail || dwell.current) return;
    dwell.current = setTimeout(() => setWantDetail(true), 180);
  }, [wantDetail]);
  // Touch and keyboard have no dwell — commit immediately. A tap or a focus IS
  // the intent; waiting would just make the tooltip open empty.
  const armNow = useCallback(() => {
    cancelArm();
    setWantDetail(true);
  }, [cancelArm]);
  useEffect(() => cancelArm, [cancelArm]);

  // Layer the fetched detail over the decoded flags. Only ever FILLS IN what the
  // masks could not carry — it never changes which checks fired, so the chip set,
  // firedCount and the CRI are identical before and after the hover resolves.
  // Server detail loses to a caller that already supplied its own (the client
  // scorer still feeds the tender-side screens).
  //
  // Hoisted ABOVE the unscored early-return: a hook after a conditional return is
  // called in a different order once `result` flips to null, which React forbids
  // and which a table row CAN do (a contracts reload nulls the masks mid-session).
  const flags = useMemo(() => {
    const f = result?.flags ?? null;
    if (!f) return null;
    if (!detail) return f;
    return {
      ...f,
      debarred: f.debarred ?? detail.debarred ?? null,
      awarderConcentration:
        f.awarderConcentration ?? detail.concentration ?? null,
      splitPurchase: f.splitPurchase ?? detail.splitPurchase ?? null,
      newFirmMonths: f.newFirmMonths ?? detail.founded?.newFirmMonths ?? null,
    };
  }, [result, detail]);

  // UNSCORED — no contract_risk_cache row, so every check is unknown rather than
  // passed. This must NOT collapse to the "—" a clean contract shows: that
  // conflation is the bug this whole change removes, and it is reachable in the
  // window between a contracts reload and the risk rebuild
  // (rebuild_contracts_list emits NULL risk columns while the cache is absent).
  if (!result || !flags) {
    const label = t("risk_unscored") || "Not scored";
    const hint =
      t("risk_unscored_hint") ||
      "This contract has not been through the risk checks yet — that is not the same as being clean.";
    return (
      <Tooltip
        content={
          <div className="max-w-[260px] space-y-1">
            <div className="font-medium">{label}</div>
            <div className="text-xs text-muted-foreground">{hint}</div>
          </div>
        }
      >
        {/* Focusable + labelled: the mark is the only carrier of this state, so a
            keyboard or screen-reader user must be able to reach it — same
            treatment as the signal marks in ContractNormalcyPanel. */}
        <span
          tabIndex={0}
          role="note"
          aria-label={`${label}. ${hint}`}
          title={label}
          className="cursor-help text-xs text-muted-foreground"
        >
          ?
        </span>
      </Tooltip>
    );
  }

  const { cri, firedCount, availableCount, hasFlag } = result ?? {};

  // A check can be FIRED while its detail is absent. The server masks
  // (src/lib/contractRiskMask.ts) carry every check's fired bit, but the
  // debarment dates / concentration share / split group only arrive with the
  // per-contract detail fetch — and those three flags are object-valued, so
  // keying their chips off `flags.*` made them VANISH rather than render
  // detail-less. Measured: 5,628 contracts (3.8% of all flagged rows) fire only
  // those three, and would have shown an empty cell while `hasFlag` was true.
  // Key the chip off the fired bit; key the tooltip's contents off the detail.
  const firedOf = (key: RiskComponentKey): boolean =>
    result.components.some((c) => c.key === key && c.fired);

  // When the ONLY fired flag is weak competition and it's suppressed here (its
  // count has a dedicated column), there is nothing left to render — fall back to
  // the "—" placeholder instead of an empty cell.
  const onlyWeakHidden =
    hideWeakCompetition && flags.weakCompetition && firedCount === 1;
  // The foreign-funded-NGO disclosure deliberately does NOT bump `firedCount`
  // (hasFlag), so it would be swallowed by this early return — keep it alive in
  // the compact `chips`/row contexts too, not just the detail `full` variant.
  if (
    (!hasFlag || onlyWeakHidden) &&
    !flags.ngoForeignFunded &&
    variant !== "full"
  ) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  const chips = (
    // Arming on the CONTAINER, not per chip: one hover anywhere in the row fetches
    // the whole row's detail, so moving between chips does not re-trigger and the
    // handlers stay off the Tooltip triggers themselves. onFocus covers keyboard.
    <div
      className="flex flex-wrap items-center gap-1"
      onMouseEnter={armDetail}
      onMouseLeave={cancelArm}
      onFocus={armNow}
      onPointerDown={armNow}
    >
      {firedOf("debarred") ? (
        <Tooltip
          content={
            <div className="space-y-1">
              <div className="font-medium">
                {t("risk_flag_debarred_long") ||
                  "On АОП debarred-suppliers register"}
              </div>
              {flags.debarred ? (
                <>
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
                </>
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
              {/* WHICH MP — the flag alone says a connection exists but not to
                  whom, and that is the first thing a reader asks. Arrives with
                  the on-hover detail fetch; absent until it resolves. */}
              {detail?.mpConnected?.length ? (
                <div className="text-xs">
                  {detail.mpConnected.map((m) => m.mpName).join(" · ")}
                </div>
              ) : null}
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

      {flags.weakCompetition && !hideWeakCompetition ? (
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

      {firedOf("awarderConcentration") ? (
        <Tooltip
          content={
            <div className="space-y-1">
              <div className="font-medium">
                {t("risk_flag_concentration_long") ||
                  "Awarder concentrated on this contractor"}
              </div>
              {flags.awarderConcentration ? (
                <>
                  <div className="text-xs tabular-nums">
                    {formatShare(flags.awarderConcentration.sharePct, lang)}{" "}
                    {t("risk_flag_concentration_of") ||
                      "of buyer's lifetime spend"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {flags.awarderConcentration.contractCount}{" "}
                    {t("risk_flag_concentration_contracts") || "contracts"}
                  </div>
                </>
              ) : null}
            </div>
          }
        >
          <SignalPill
            tone="orange"
            icon={<AlertTriangle className="h-3 w-3" />}
          >
            {/* The share IS the label when known; without the detail slice the
                chip still has to appear, so fall back to naming the check. */}
            {flags.awarderConcentration
              ? formatShare(flags.awarderConcentration.sharePct, lang)
              : t("risk_flag_concentration") || "Концентрация"}
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

      {firedOf("splitPurchase") ? (
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
              {flags.splitPurchase ? (
                <div className="text-xs tabular-nums">
                  {flags.splitPurchase.contractCount}{" "}
                  {t("risk_flag_split_contracts") || "direct awards"} ·{" "}
                  {formatEurCompact(flags.splitPurchase.totalEur, lang)} ·{" "}
                  {t("risk_flag_split_ceiling") || "ceiling"}{" "}
                  {formatEurCompact(flags.splitPurchase.ceilingEur, lang)}
                </div>
              ) : null}
            </div>
          }
        >
          <SignalPill tone="amber" icon={<Scissors className="h-3 w-3" />}>
            {t("risk_flag_split") || "Split?"}
          </SignalPill>
        </Tooltip>
      ) : null}

      {flags.ngoForeignFunded ? (
        <Tooltip
          content={
            <NgoForeignFundedBody
              entry={flags.ngoForeignFunded}
              t={t}
              lang={lang}
            />
          }
        >
          <SignalPill tone="slate" icon={<Globe className="h-3 w-3" />}>
            {flags.ngoForeignFunded.kind === "connected"
              ? t("risk_disc_ngo_foreign_connected") ||
                "NGO-linked (foreign-funded)"
              : t("risk_disc_ngo_foreign") || "Foreign-funded NGO"}
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

  // Explained check ledger for the detail header — always rendered, never gated
  // behind a toggle. Rows are sorted fired → passed → not-applicable, catalogue
  // order (severity) breaking ties.
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
  // emerald for a passed check. A meter for the count beside it — it used to
  // preview a collapsed ledger, and now just makes the denominator scannable at
  // a glance; the ledger below is the authoritative reading, and it shares this
  // ordering so the two read as one strip.
  const isAuthoritative = (key: RiskComponentKey) =>
    key === "debarred" || key === "appealUpheld";
  const cellRank = (c: (typeof result.components)[number]) =>
    c.fired ? (isAuthoritative(c.key) ? 0 : 1) : 2;
  const cells = result.components
    .filter((c) => c.available)
    .sort((a, b) => cellRank(a) - cellRank(b));

  // Validate rather than cast: `grade` is a free text column server-side, and an
  // unrecognised letter would index GRADE_TONE to undefined and throw on .chip.
  // hasOwnProperty, not `in` — `in` walks the prototype chain, so "constructor"
  // and "toString" would pass the guard and render as the badge.
  const gradeLetter: RiskGradeLetter | null =
    grade && Object.prototype.hasOwnProperty.call(GRADE_TONE, grade)
      ? (grade as RiskGradeLetter)
      : null;
  // Names the band so the letter is self-explanatory next to the count it is
  // banded on ("F — 5 or more of the applicable checks fired").
  const gradeHint = gradeLetter
    ? t("risk_cri_grade_hint", {
        grade: gradeLetter,
        fired: firedCount,
        available: availableCount,
        defaultValue:
          "Risk grade {{grade}} — {{fired}} of {{available}} applicable checks fired. The grade bands the number of fired checks: A none, B 1, C 2, D 3, E 4, F 5 or more.",
      })
    : "";

  return (
    // The ledger is NOT collapsible. It was a closed-by-default disclosure, which
    // put the one thing the page exists to explain — WHICH checks fired and why —
    // behind a click, under a header that only said "6 of 10". The checks are the
    // content here, so they are always rendered; nothing above the fold is worth
    // the fold.
    <div className="space-y-2">
      <div className="flex w-full flex-wrap items-center gap-2">
        {/* The A–F grade, same letter and palette as the riskiest-contracts
            board that links here and the `?grade=` filter on the browsers — the
            detail page was the one surface that dropped it, so a contract listed
            as F showed only "6 of 10" once opened. A plain labelled span rather
            than a <Tooltip>: the letter is fully restated by the ledger below
            it, so it needs no second interactive surface.

            `role` is load-bearing, not decoration. A <span> with no role maps to
            ARIA `generic`, which is name-PROHIBITED — browsers drop the
            aria-label, and `title` is mouse-only, so without it the band
            explanation reaches nobody on keyboard, touch or a screen reader and
            the letter is a bare coloured mark. Same treatment as the unscored
            `?` above. */}
        {gradeLetter ? (
          <span
            role="note"
            tabIndex={0}
            title={gradeHint}
            aria-label={gradeHint}
            className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-sm font-bold ${GRADE_TONE[gradeLetter].chip}`}
          >
            {gradeLetter}
          </span>
        ) : null}
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
      </div>

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
        {flags.ngoForeignFunded ? (
          <div className="flex items-start gap-2 border-t border-border/60 py-2">
            <Globe
              className="mt-0.5 h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400"
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-sm text-foreground">
                  {flags.ngoForeignFunded.kind === "connected"
                    ? t("risk_disc_ngo_foreign_connected_long") ||
                      "Contractor is tied to a foreign-funded NGO"
                    : t("risk_disc_ngo_foreign_long") ||
                      "Contractor is an NGO with foreign funding"}
                </span>
                <span className="rounded-full border border-slate-300 px-1.5 py-0.5 text-[11px] text-slate-600 dark:border-slate-700 dark:text-slate-300">
                  {t("risk_disc_label") || "disclosure"}
                </span>
              </div>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {flags.ngoForeignFunded.kind === "connected" &&
                flags.ngoForeignFunded.person ? (
                  <>
                    {flags.ngoForeignFunded.person}
                    {" · "}
                    {t("risk_disc_ngo_foreign_board_of") ||
                      "on the board of"}{" "}
                  </>
                ) : null}
                <Link
                  to={`/company/${flags.ngoForeignFunded.ngoEik}`}
                  className="text-primary hover:underline"
                >
                  {flags.ngoForeignFunded.ngoName}
                </Link>
                {" · "}
                {flags.ngoForeignFunded.funder ??
                  (t("risk_disc_ngo_foreign_funder_generic") ||
                    "Foreign funding")}
                {flags.ngoForeignFunded.eur != null ? (
                  <>
                    {" · "}
                    {formatEurCompact(flags.ngoForeignFunded.eur, lang)}
                  </>
                ) : null}
              </p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground/70">
                {t("risk_disc_ngo_foreign_note") ||
                  "Lawful disclosure, not a risk flag — foreign funding is not evidence of wrongdoing."}
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};
