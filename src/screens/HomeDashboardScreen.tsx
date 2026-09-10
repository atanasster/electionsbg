// The global Bulgaria dashboard — `/`.
//
// A hub-of-hubs and nothing else: a national pulse, one moving map and eight destinations. It
// renders no result chart and no duplicate of any destination's dashboard, because every one
// of those is a page a tile already opens.
//
// ⚠️ THE MAP IS A DEPENDENCY-FREE CANVAS SCENE, NOT A MAP LIBRARY, and the distinction is the
// whole reason it may be here. `tests/perf.spec.ts` pins `/` in `MAP_FREE_HUBS` — no
// `vendor-geo`, `vendor-leaflet` or `vendor-charts` in the home chunk — and the flyover
// satisfies it because its geometry was projected at generation time and the client draws
// plain 2D canvas behind a `lazy()` boundary. The band replaced this file's earlier „renders
// no map" sentence; the gate that sentence described is unchanged and still green.
// See docs/plans/home-flyover-v1.md §8.4.
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

import { FC, useMemo, useState } from "react";
import { isBg } from "@/i18n";
import { useTranslation } from "react-i18next";
import { HubHead, TileHubGrid, type TileHubSection } from "@/ux/infographic";
import { HubSearch } from "@/ux/search/HubSearch";
import { useSettlementsInfo } from "@/data/settlements/useSettlements";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { useRegions } from "@/data/regions/useRegions";
import { buildPlaceItems } from "@/data/search/placeSearchItems";
import { HOME_FIGURE_IDS } from "@/data/home/homeTypes";
import { useHomeHubStats } from "@/data/home/useHomeHubStats";
import { formatDate } from "@/lib/formatDate";
import { homeKpis, homeTileMetric } from "./home/homeFigures";
import { homeSearchSources } from "./home/homeSearch";
import { usePersonLabels } from "@/lib/personLabels";
import { HomeChangeFeed } from "./home/HomeChangeFeed";
import { HOME_BANDS } from "./home/homeRegistry";
import { HOME_SCENES } from "./home/homeScenes";
import { HomeFlyoverSlot } from "./home/flyover/HomeFlyoverSlot";
import { ChatInvitation } from "./home/ChatInvitation";
import { CHAT_LAUNCH_REVIEWABLE } from "@/lib/chatLaunch";

export const HomeDashboardScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  const { stats, settled } = useHomeHubStats();

  // ⚠️ ARMED ON INTENT, and the flag is what defers the catalog. `useSettlementsInfo` +
  // `useMunicipalities` are ~980 KB together; passing `armed` as their `enabled` keeps the
  // entry page's first paint free of them, and `HubSearch` flips it on focus or the first
  // keystroke. Without this the finder would be a tax on every visitor who never searches —
  // which on `/` is most of them.
  const [armed, setArmed] = useState(false);
  const { settlements, findSettlement } = useSettlementsInfo(armed);
  const { municipalities } = useMunicipalities(armed);
  const { regions } = useRegions();
  const placeItems = useMemo(
    () =>
      settlements && municipalities
        ? buildPlaceItems(settlements, municipalities, regions)
        : null,
    [settlements, municipalities, regions],
  );
  // The diaspora lookup the place index needs. `oblast === "32"` is МИР 32, the abroad
  // district, whose 88 rows are countries rather than settlements.
  const oblastOf = useMemo(
    () => (key: string) => findSettlement?.(key)?.oblast,
    [findSettlement],
  );
  // `roleLabel` turns the public-people rows from „Политик · Столична община" — true of
  // Sofia's mayor and of 46,158 other people — into „Кмет · Столична община", which is what
  // tells two namesakes apart. `usePersonLabels` memoizes on `t`, so this does not churn.
  const { roleLabel } = usePersonLabels();
  const searchSources = useMemo(
    () => homeSearchSources(bg, placeItems, oblastOf, armed, roleLabel),
    [bg, placeItems, oblastOf, armed, roleLabel],
  );

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
        search={
          <>
            <HubSearch
              sources={searchSources}
              idPrefix="home-search"
              onArm={() => setArmed(true)}
              title={{ bg: "Търсене", en: "Search" }}
              // ⚠️ „процедура", NOT „поръчка", and „продукт" is back. „Обществени поръчки" is
              // the umbrella the whole ЗОП corpus sits under — homeSearch names its two halves
              // „Договори по ЗОП" and „Процедури по ЗОП" for exactly that reason — so inviting a
              // reader to type looking for a „поръчка" offers them no group by that name. And
              // products was dropped from this line in the same pass that promoted the group up
              // the box for visibility.
              placeholder={{
                bg: "място, човек, фирма, продукт, договор или процедура…",
                en: "a place, a person, a company, a product, a contract or a procedure…",
              }}
              // Says what the box covers, in the order the groups appear. Deliberately names
              // the CORPORA rather than the ten group headings: a reader who has not opened
              // the box needs to know whether their subject is in it at all.
              hint={{
                bg: "Места; публични лица и лица от Търговския регистър; продукти; възложители и фирми; договори и процедури по ЗОП; проекти по еврофондове и Interreg.",
                en: "Places; public figures and people in company records; products; buyers and companies; procurement contracts and procedures; EU and Interreg projects.",
              }}
            />
          </>
        }
        searchPreview={
          CHAT_LAUNCH_REVIEWABLE ? (
            <ChatInvitation lang={bg ? "bg" : "en"} />
          ) : (
            <HomeFlyoverSlot />
          )
        }
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

      {/* Below the grid, deliberately. The eight destinations are the page's durable job;
          the feed is what is new, and a feed above them would make the home page a news
          site whose front page changes meaning with the day. */}
      <HomeChangeFeed />
    </>
  );
};
