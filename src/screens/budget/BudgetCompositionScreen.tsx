// The shared body of /budget/revenue and /budget/spending.
//
// Plan: docs/plans/budget-hub-v1.md §7.1 / T6.3-T6.4. One component, two pages:
// they are the same question asked of a different `kind`, and building them
// twice is how the two drift.
//
// THE FOUR-PART SPINE, from Treasury's Fiscal Data (plan §3). Every money page
// in this module answers the same four questions in the same order, so fourteen
// pages read as one module rather than fourteen:
//
//   1. Колко е           — the level
//   2. От какво се състои — the composition one level deeper
//   3. Как се променя     — the trend across fiscal years
//   4. Как сме спрямо ЕС  — the peer band the stat call already carries
//
// Panel 4 is nearly free: migration 156 computes the bands, and before this they
// appeared in exactly one place on the whole site.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { formatEur } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { useSearchParam } from "@/screens/utils/useSearchParam";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";
import { useBudgetSnapshot } from "@/data/budget/useBudgetSnapshot";
import { useBudgetSeries } from "@/data/budget/useBudgetSeries";
import { useBudgetHubStats } from "@/data/budget/useBudgetHubStats";

export interface BudgetCompositionProps {
  /** The КФП section kind this page is about. */
  kind: "revenue" | "expenditure";
  /** The series whose EU peer band belongs beside it — TR for revenue, TE for
   *  expenditure. Named per page rather than derived, because the mapping is a
   *  fact about Eurostat's na_items and not about our `kind`. */
  peerItem: "TR" | "TE";
  titleKey: string;
  descriptionKey: string;
  introKey: string;
  sourceKey: string;
}

export const BudgetCompositionScreen: FC<BudgetCompositionProps> = ({
  kind,
  peerItem,
  titleKey,
  descriptionKey,
  introKey,
  sourceKey,
}) => {
  const { t, i18n } = useTranslation();
  const [fyParam, setFyParam] = useSearchParam("fy", { replace: true });
  const { stats } = useBudgetHubStats();
  const fy =
    fyParam && /^\d{4}$/.test(fyParam)
      ? Number(fyParam)
      : (stats?.fiscalYear ?? null);

  // Always EUR here: this page is about composition, and a share-of-parent is
  // already rendered per line as a bar. A second basis control would put the
  // same number in two units on one screen.
  const { snapshot, isLoading } = useBudgetSnapshot(fy, kind, "eur");
  const { series } = useBudgetSeries(
    kind === "revenue" ? "revenue" : "expenditure",
  );

  // BY SERIES, never by position. `budget_snapshot(fy,'expenditure')` returns
  // TWO sections — II (Разходи) and III (Вноска в бюджета на ЕС) — both with
  // kind = 'expenditure'; `sections[0]` happens to give II only because "II"
  // sorts before "III". `series` is the discriminator the payload carries for
  // exactly this, and §III has zero lines in every year, so the day the order
  // flips this page shows the EU contribution's total over „Няма данни".
  const section =
    snapshot?.sections?.find((sec) => sec.series === kind) ?? null;
  const total = section?.executedEur ?? null;

  // Only the top level: `depth = 0` is the published grouping, and every deeper
  // line is already inside one of them. Summing all lines double-counts by ~2x
  // because the source interleaves subtotals with their own children.
  const topLines = useMemo(
    () => (section?.lines ?? []).filter((l) => l.depth === 0),
    [section],
  );

  /** The full-year figure per fiscal year. КФП is CUMULATIVE, so the year's
   *  value is its LATEST period — never the sum of its periods. */
  const byYear = useMemo(() => {
    const latest = new Map<
      number,
      { period: string; value: number | null; partial: boolean }
    >();
    for (const p of series?.points ?? []) {
      const prev = latest.get(p.fiscalYear);
      if (!prev || p.period > prev.period)
        latest.set(p.fiscalYear, {
          period: p.period,
          value: p.executedEur,
          // A year whose latest cumulative is not December is INCOMPLETE, and
          // has to say so. Rendered as a plain bar beside closed years, FY2026's
          // half-year €12.8bn reads as revenue collapsing by half.
          partial: !p.period.endsWith("-12"),
        });
    }
    return [...latest.entries()].sort((a, b) => a[0] - b[0]);
  }, [series]);

  // The scale is set by COMPLETE years only, so a part-year bar is visibly
  // short rather than rescaling every other bar around it.
  const peak = useMemo(
    () =>
      Math.max(
        ...byYear.filter(([, v]) => !v.partial).map(([, v]) => v.value ?? 0),
        1,
      ),
    [byYear],
  );

  const band = stats?.peerBands?.[peerItem] ?? null;

  const title = t(titleKey);

  return (
    <>
      <Title description={t(descriptionKey)}>{title}</Title>
      <GovernanceBreadcrumb
        sectionKey="budget_link_label"
        sectionTo="/budget"
        currentKey={titleKey}
        className="mt-5"
      />

      {/* data-og keys the og:image capture (scripts/og/capture-screens.ts). It carries `kind`
          because /budget/revenue and /budget/spending are the SAME component — a shared marker
          would give the two pages one share card between them. */}
      <section
        aria-label={title}
        data-og={`budget-${kind}`}
        className="my-4 space-y-6"
      >
        <p className="max-w-3xl text-sm text-muted-foreground">{t(introKey)}</p>

        {stats?.yearsAvailable?.length ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {stats.yearsAvailable.map((y) => (
              <button
                key={y}
                type="button"
                onClick={() => setFyParam(String(y))}
                className={cn(
                  "rounded border px-2 py-0.5 text-xs tabular-nums transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  y === fy
                    ? "border-primary bg-primary/10 text-primary font-semibold"
                    : "border-border hover:border-primary/60",
                )}
              >
                {y}
              </button>
            ))}
          </div>
        ) : null}

        {/* 1. Колко е */}
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-muted-foreground">
            {t("budget_comp_level_h", { fy, defaultValue: "" })}
          </h2>
          <p className="mt-1 text-2xl font-bold tabular-nums">
            {isLoading ? "…" : total == null ? "—" : formatEur(total)}
          </p>
          {snapshot?.period ? (
            <p className="text-xs text-muted-foreground">
              {t("budget_comp_asof", {
                period: snapshot.period,
                defaultValue: "",
              })}
            </p>
          ) : null}
        </div>

        {/* 2. От какво се състои */}
        <div>
          <h2 className="mb-2 text-sm font-semibold">
            {t("budget_comp_breakdown_h")}
          </h2>
          {snapshot?.period && !snapshot.period.endsWith("-12") ? (
            /* A mid-year snapshot is the composition SO FAR, not the year's.
               Revenue mixes differ across a year — measured on FY2026, non-tax
               is 10.4% at mid-year against 12.7% at close — so an unlabelled
               mid-year split is a claim about a year that has not finished. */
            <p className="mb-2 text-xs text-amber-700 dark:text-amber-300">
              {t("budget_comp_partial_mix", {
                period: snapshot.period,
                defaultValue: "",
              })}
            </p>
          ) : null}
          {isLoading ? (
            <div className="h-56 animate-pulse rounded-xl border bg-card" />
          ) : topLines.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("budget_comp_empty")}
            </p>
          ) : (
            <ul className="divide-y rounded-xl border bg-card shadow-sm">
              {topLines.map((l) => {
                const share =
                  total && l.executedEur != null && total !== 0
                    ? (l.executedEur / total) * 100
                    : null;
                return (
                  <li key={l.ord} className="px-4 py-2">
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span>
                        {/* `label_en` is populated, so serving the Bulgarian
                            label on /en is a choice rather than a fallback.
                            `||`, NOT `??`: an unmapped КФП line stores the
                            EMPTY STRING rather than NULL, and `??` sails past
                            it — measured, „Трансфери (нето)" (58% of
                            expenditure) rendered as a blank row on /en for
                            FY2021-2024, with its amount and share beside it. */}
                        {(i18n.language === "bg"
                          ? l.labelBg || l.labelEn
                          : l.labelEn || l.labelBg) || null}
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {l.executedEur == null ? "—" : formatEur(l.executedEur)}
                        {share != null ? (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {share.toFixed(1)}%
                          </span>
                        ) : null}
                      </span>
                    </div>
                    {share != null ? (
                      <div
                        className="mt-1 h-1 rounded bg-primary/20"
                        aria-hidden
                      >
                        <div
                          className="h-1 rounded bg-primary"
                          style={{ width: `${Math.min(100, share)}%` }}
                        />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* 3. Как се променя */}
        {byYear.length > 1 ? (
          <div>
            <h2 className="mb-2 text-sm font-semibold">
              {t("budget_comp_trend_h")}
            </h2>
            <ul className="space-y-1 rounded-xl border bg-card p-4 shadow-sm">
              {byYear.map(([year, v]) => (
                <li key={year} className="flex items-center gap-3 text-sm">
                  <span className="w-12 shrink-0 tabular-nums text-muted-foreground">
                    {year}
                  </span>
                  <span
                    className="h-2 flex-1 rounded bg-primary/15"
                    aria-hidden
                  >
                    <span
                      className={cn(
                        "block h-2 rounded",
                        v.partial ? "bg-primary/40" : "bg-primary",
                      )}
                      style={{
                        width: `${Math.min(100, Math.round(((v.value ?? 0) / peak) * 100))}%`,
                      }}
                    />
                  </span>
                  <span className="w-40 shrink-0 text-right tabular-nums">
                    {v.value == null ? "—" : formatEur(v.value)}
                    {v.partial ? (
                      <span className="ml-1 text-[10px] font-normal text-amber-700 dark:text-amber-300">
                        {t("budget_comp_partial", {
                          period: v.period,
                          defaultValue: "",
                        })}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[11px] text-muted-foreground/80">
              {/* Not decoration: the feed is cumulative, so a reader who sums
                  the bars gets roughly n(n+1)/2 times the truth. */}
              {t("budget_comp_cumulative_note")}
            </p>
          </div>
        ) : null}

        {/* 4. Как сме спрямо ЕС */}
        {band ? (
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <h2 className="text-sm font-semibold">{t("budget_comp_eu_h")}</h2>
            <p className="mt-1 text-sm tabular-nums">
              {t("budget_comp_eu_body", {
                bg: band.bgPctGdp?.toFixed(1),
                eu: band.euAvgPctGdp?.toFixed(1),
                rank: band.rank,
                total: band.total,
                year: band.year,
                defaultValue: "",
              })}
            </p>
            {/* The perimeter, stated. Eurostat's general-government basis is
                NOT the МФ state-budget figure above it, so the chip compares
                Bulgaria to the EU and never to the card beside it. */}
            <p className="mt-1 text-[11px] text-muted-foreground/80">
              {t("budget_comp_eu_basis")}
            </p>
          </div>
        ) : null}

        <p className="text-[11px] text-muted-foreground/80">{t(sourceKey)}</p>
      </section>
    </>
  );
};
