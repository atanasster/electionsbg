// Критерий за възлагане — the ЗОП чл. 70 award-criterion mix over the tender
// corpus, per year and by contract type.
//
// WHAT THIS MEASURES, and the misreading it must not invite: award_method is the
// rule for EVALUATING BIDS at award time. It is not payment-for-outcome, and
// „оптимално съотношение качество/цена" (MEAT) is not an outcomes-based
// contract. Copy therefore says „критерий за оценка на офертите" throughout.
// See docs/plans/procurement-outcomes-v1.md §0a.
//
// The field is ЦАИС-era: it does not exist before 2020, so the series is floored
// there BY THE SERVER (migration 164) rather than by this component — a
// 2018-2026 line would draw a data-availability cliff as a policy change.
// Residual "not stated" rows inside 2020+ stay visible as their own grey band;
// they are never dropped or redistributed.
//
// Bars are CSS flex, not a charting library: the split is a part-to-whole of
// five buckets, so it needs no axis, and it sidesteps the measured-width latch
// that bites charts inside a grid item.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Gavel } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import {
  useAwardCriteria,
  AWARD_CRITERION_BUCKETS,
  type AwardCriteriaRow,
  type AwardCriterionBucket,
} from "@/data/procurement/useAwardCriteria";

/** Draw order = legend order. `unknown` sits last so the stated criteria read
 *  as one contiguous block and the not-stated tail is visually separable. */
const BUCKET_CLASS: Record<AwardCriterionBucket, string> = {
  meat: "bg-emerald-500 dark:bg-emerald-600",
  lcc: "bg-teal-500 dark:bg-teal-600",
  combined: "bg-indigo-400 dark:bg-indigo-500",
  price: "bg-amber-500 dark:bg-amber-600",
  other: "bg-red-500 dark:bg-red-600",
  unknown: "bg-muted-foreground/25",
};
// Draw order = legend order, and it comes from the shared list so the tile can
// never draw a different set than the server emits.
const BUCKETS = AWARD_CRITERION_BUCKETS.map((key) => ({
  key,
  cls: BUCKET_CLASS[key],
}));

type BucketKey = AwardCriterionBucket;

const StackedBar: FC<{
  row: AwardCriteriaRow;
  label: string;
  /** What the emerald percentage on the right actually is. */
  shareLabel: string;
  labels: Record<BucketKey, string>;
  locale: string;
}> = ({ row, label, shareLabel, labels, locale }) => {
  const total = row.total || 0;
  if (total <= 0) return null;
  const pct = (n: number) =>
    ((n / total) * 100).toLocaleString(locale, { maximumFractionDigits: 1 }) +
    "%";
  return (
    <div className="py-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium tabular-nums">{label}</span>
        <span
          className="text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-400"
          // The figure is otherwise identified only by its colour matching one of
          // six legend swatches — unusable without colour vision or with a screen
          // reader, and the segment `title`s are not keyboard-reachable either.
          aria-label={`${label} — ${shareLabel}: ${pct(row.meat)}`}
        >
          {pct(row.meat)}
        </span>
      </div>
      <div
        className="mt-1 flex h-2.5 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={BUCKETS.filter(({ key }) => (row[key] ?? 0) > 0)
          .map(({ key }) => `${labels[key]} ${pct(row[key] ?? 0)}`)
          .join(", ")}
      >
        {BUCKETS.map(({ key, cls }) => {
          const v = row[key] ?? 0;
          if (v <= 0) return null;
          return (
            <div
              key={key}
              className={cls}
              style={{ width: `${(v / total) * 100}%` }}
              title={`${labels[key]}: ${v.toLocaleString(locale)} (${pct(v)})`}
            />
          );
        })}
      </div>
    </div>
  );
};

export const AwardCriteriaTile: FC = () => {
  const { t, i18n } = useTranslation();
  const { data, isLoading, isError } = useAwardCriteria();
  // Three distinct states that all used to collapse into `!data`:
  //   isLoading  — first fetch in flight
  //   isError    — the call failed (a transient 500)
  //   data null  — the route degraded a missing migration 164
  // All three render nothing, which is right for a secondary tile on a shared
  // dashboard, but they are worth separating so the next reader does not assume
  // a blank tile means "the migration is missing".
  if (isLoading || isError || !data) return null;
  const years = data.byYear ?? [];
  const types = data.byType ?? [];
  // An out-of-range scope (?pscope=y:2018, before the field exists) yields no
  // years. Naming the gap beats vanishing — the repo's convention on /subsidies.
  const locale = i18n.language === "bg" ? "bg-BG" : "en-GB";
  const numFmt = new Intl.NumberFormat(locale);
  if (years.length === 0)
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Gavel className="h-4 w-4 text-muted-foreground" />
            {t("award_crit_title") || "Award criterion (ЗОП art. 70)"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 md:p-4 pt-0">
          <p className="text-xs text-muted-foreground">
            {(
              t("award_crit_no_years") ||
              "No procedure in this period records an award criterion — the field only exists from {{year}}."
            ).replace("{{year}}", data.firstYear)}
          </p>
        </CardContent>
      </Card>
    );
  const shareLabel = t("award_crit_meat") || "Best quality/price ratio";
  const labels: Record<BucketKey, string> = {
    meat: t("award_crit_meat") || "Best quality/price ratio",
    lcc: t("award_crit_lcc") || "Life-cycle cost",
    combined: t("award_crit_combined") || "Two criteria named",
    price: t("award_crit_price") || "Lowest price",
    other: t("award_crit_other") || "Unrecognised",
    unknown: t("award_crit_unknown") || "Not stated",
  };
  const typeLabel = (ct?: string) =>
    ct === "works"
      ? t("award_crit_type_works") || "Works"
      : ct === "services"
        ? t("award_crit_type_services") || "Services"
        : ct === "goods"
          ? t("award_crit_type_goods") || "Goods"
          : t("award_crit_type_other") || "Unspecified";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Gavel className="h-4 w-4 text-muted-foreground" />
          {t("award_crit_title") || "Award criterion (ЗОП art. 70)"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 pt-0">
        <p className="text-[11px] text-muted-foreground">
          {t("award_crit_lede") ||
            "How bids are scored when the contract is awarded — not how delivery is paid for."}
        </p>

        <p className="mt-1 text-[11px] text-muted-foreground">
          {(
            t("award_crit_share_note") ||
            "The figure beside each bar is the share of «{{c}}»."
          ).replace("{{c}}", shareLabel)}
        </p>

        <div className="mt-2 divide-y divide-border/40">
          {years.map((r) => (
            <StackedBar
              key={r.year}
              row={r}
              label={r.year ?? ""}
              shareLabel={shareLabel}
              labels={labels}
              locale={locale}
            />
          ))}
        </div>

        {types.length > 0 && (
          <>
            <p className="mt-3 text-xs font-medium">
              {t("award_crit_by_type") || "By contract type"}
            </p>
            <div className="mt-1 divide-y divide-border/40">
              {types.map((r) => (
                <StackedBar
                  key={r.contractType}
                  row={r}
                  label={typeLabel(r.contractType)}
                  shareLabel={shareLabel}
                  labels={labels}
                  locale={locale}
                />
              ))}
            </div>
          </>
        )}

        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {BUCKETS.filter(({ key }) => key !== "other").map(({ key, cls }) => (
            <span key={key} className="inline-flex items-center gap-1">
              <span className={`inline-block h-2 w-2 rounded-sm ${cls}`} />
              {labels[key]}
            </span>
          ))}
        </div>

        {/* The pre-2020 clause is dropped when the window contains no such
            tenders — every recent parliament scope returns 0, where the sentence
            „— 0 earlier procedures carry none" reads as boilerplate. */}
        <p className="mt-2 text-[11px] text-muted-foreground/80">
          {(data.coverage.preCriterionTenders ?? 0) > 0
            ? (
                t("award_crit_note") ||
                "The criterion is only recorded from {{year}} onwards; {{n}} earlier tenders carry none. Procedures with no call for bids ({{nc}}) are excluded — they have no competitive evaluation."
              )
                .replace("{{year}}", data.firstYear)
                .replace(
                  "{{n}}",
                  numFmt.format(data.coverage.preCriterionTenders ?? 0),
                )
                .replace("{{nc}}", numFmt.format(data.coverage.noCall ?? 0))
            : (
                t("award_crit_note_short") ||
                "Procedures with no call for bids ({{nc}}) are excluded — they have no competitive evaluation."
              ).replace("{{nc}}", numFmt.format(data.coverage.noCall ?? 0))}
        </p>
      </CardContent>
    </Card>
  );
};
