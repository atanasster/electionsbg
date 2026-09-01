// The global Bulgaria dashboard — `/`.
//
// A hub-of-hubs and nothing else: a national pulse and eight destinations. It deliberately
// renders no map, no result chart and no duplicate of any destination's dashboard, because
// every one of those is a page a tile already opens.
//
// The finder belongs in the head's `search` slot and is NOT mounted yet — it lands in its
// own phase, where it also breaks this head's height budget on purpose (see
// `HUB_HEAD_BUDGETS` in tests/ui.spec.ts).
//
// ⚠️ COMPOSITION ONLY. Figure formatting lives in `homeFigures.ts`, tile order and
// descriptors in `homeRegistry.ts`, scenes in `homeScenes.tsx`, fetching in
// `useHomeHubStats`. Keeping this file free of all four is what lets the registry stay out
// of the entry chunk (`src/entryGraph.test.ts`).
//
// Plan: docs/plans/home-dashboard-implementation-v1.md §4 and §9.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { HubHead, TileHubGrid, type TileHubSection } from "@/ux/infographic";
import { HOME_FIGURE_IDS } from "@/data/home/homeTypes";
import { useHomeHubStats } from "@/data/home/useHomeHubStats";
import { formatDate } from "@/lib/formatDate";
import { homeKpis, homeTileMetric } from "./home/homeFigures";
import { HOME_BANDS } from "./home/homeRegistry";
import { HOME_SCENES } from "./home/homeScenes";

export const HomeDashboardScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang.startsWith("bg");
  const { stats, settled } = useHomeHubStats();

  const kpis = useMemo(() => homeKpis(stats, t, lang), [stats, t, lang]);

  // ⚠️ Memoized on `stats`, NOT on the `tile` accessor. `useHomeHubStats` returns a fresh
  // closure every render, so a dependency on it changed every time and the memo compared
  // dependencies to buy nothing — dead machinery that reads as an optimisation.
  const sections: TileHubSection[] = useMemo(
    () =>
      HOME_BANDS.map((band) => ({
        heading: t(band.labelKey),
        description: t(band.descKey),
        tiles: band.tiles.map((tl) => {
          const metric = stats?.tiles?.[tl.id];
          const value = homeTileMetric(metric, lang);
          return {
            to: tl.to,
            title: t(tl.titleKey),
            desc: t(tl.descKey),
            accent: tl.accent,
            ...(tl.dropParams ? { dropParams: tl.dropParams } : {}),
            scene: HOME_SCENES[tl.id],
            // No per-tile CTA: the whole card is the link and already has a hover state, so
            // „разгледай →" would be one affordance restated eight times.
            //
            // A tile with no folded figure renders DESCRIPTOR-ONLY. That is a designed
            // state, not a degraded one — three of the eight have no destination-owned
            // figure this generator can reach without inventing a home-only query.
            // ⚠️ THE CAPTION CARRIES THE DAY WHERE THE METRIC HAS ONE. „2026" alone cannot
            // distinguish two parliamentary elections in a single calendar year — which
            // Bulgaria has had more than once recently (three in 2021, two in 2024) — and
            // the generator already folds the exact date into `period`. Publishing it and
            // then dropping it is how a fact quietly stops being checked.
            ...(value
              ? {
                  metric: value,
                  metricCaption: metric?.period
                    ? `${t(metric.basisKey)} · ${formatDate(metric.period, lang)}`
                    : t(metric!.basisKey),
                }
              : {}),
          };
        }),
      })),
    [t, stats, lang],
  );

  return (
    <>
      <HubHead
        eyebrow={bg ? "Наясно" : "Naiasno"}
        title={bg ? "България в данни" : "Bulgaria in data"}
        seoDescription={t("home_hub_seo_description")}
        deck={t("home_hub_deck")}
        kpis={kpis}
        // Reserve the band's REAL height while the artifact is in flight. Without it the
        // slot is 0 cells and then jumps to four — a layout shift on the site's most-visited
        // page, which is the worst place in the repo to spend CLS. The skeleton deliberately
        // carries no `data-kpi-cell`, so the OG capture's wait still resolves only on a
        // loaded cell.
        kpisPending={settled ? undefined : HOME_FIGURE_IDS.length}
        // The note is what keeps four percentages from reading as one scale: they come from
        // four datasets at three frequencies, and one of them is a stock rather than a rate.
        kpiNote={kpis.length ? t("home_hub_kpi_note") : undefined}
        // ⚠️ Only once the request has SETTLED. Shown while the fetch is in flight, this
        // would tell every reader the pulse is unavailable for the first few hundred ms of
        // the site's most-visited page.
        freshness={
          settled && kpis.length === 0
            ? t("home_hub_stats_unavailable")
            : undefined
        }
      />

      <div data-og="home-hub">
        <TileHubGrid sections={sections} className="mt-8" />
      </div>
    </>
  );
};
