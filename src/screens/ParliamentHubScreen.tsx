// /parliament — the Народно събрание module front page.
//
// Replaces 49 lines of hardcoded JSX that mounted seven preview mini-tiles, each fetching a
// full derived artifact to render three rows: ~1.65 MB of JSON to draw a tile grid. Those
// tiles are dropped here; H1 replaces their numbers with one small hub_stats blob.
//
// Structure is the plan's §4.1: a session-strip hero over the tile bands. Bands 0–2 (wire,
// lead, news rail) arrive in H2 — they are deliberately last, being the only bands with no
// measured demand behind them.
//
// Data from parliamentRegistry; layout from the reusable infographic tile-hub kit. The two
// seeded band-4 tiles resolve from small precomputed shards (4.3 KB + 17 KB), never from
// the 11.7 MB aggregate they summarise, and OMIT themselves when their seed is missing.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { TileHubGrid, TileHubSection } from "@/ux/infographic";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";
import { useParliamentHubStats } from "@/data/parliament/useParliamentHubStats";
import {
  PARLIAMENT_BANDS,
  PARLIAMENT_TILES,
  resolveDestination,
  type ParliamentSeed,
} from "./parliament/parliamentRegistry";
import { PARLIAMENT_SCENES } from "./parliament/parliamentScenes";
import { ParliamentSessionStrip } from "./parliament/ParliamentSessionStrip";

// Dev-time guard for the stringly-typed tile.id ↔ PARLIAMENT_SCENES contract. A tile whose
// id has no scene does NOT degrade to an empty vignette — InfographicTile renders <Scene />
// unguarded, so `undefined` as a component type throws "Element type is invalid" and
// white-screens the route. The real gate is parliamentHubRegistry.test.ts at commit time.
if (import.meta.env.DEV) {
  const missing = PARLIAMENT_TILES.map((tile) => tile.id).filter(
    (id) => !PARLIAMENT_SCENES[id],
  );
  if (missing.length) {
    console.error(
      `[parliament hub] tile id(s) with no PARLIAMENT_SCENES scene: ${missing.join(", ")}`,
    );
  }
}

export const ParliamentHubScreen: FC = () => {
  const { t, i18n } = useTranslation();
  // ONE blob for the whole page. The seven mini-tiles this replaced fetched a full derived
  // artifact each — 1.65 MB between them — to render three rows apiece.
  const { stats } = useParliamentHubStats();

  const nf = useMemo(
    () => new Intl.NumberFormat(i18n.language === "bg" ? "bg-BG" : "en-GB"),
    [i18n.language],
  );
  const pct = useMemo(
    () =>
      new Intl.NumberFormat(i18n.language === "bg" ? "bg-BG" : "en-GB", {
        style: "percent",
        maximumFractionDigits: 0,
      }),
    [i18n.language],
  );
  const dec2 = useMemo(
    () =>
      new Intl.NumberFormat(i18n.language === "bg" ? "bg-BG" : "en-GB", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    [i18n.language],
  );

  // Every figure carries the basis it was computed on, because there is more than one
  // defensible answer to most of them and the tile has to say which it used. Attendance is
  // WEIGHTED (Σpresent / Σitems); "гласувания" is the post-dedupe item count; "депутати"
  // leads with the DESTINATION's number, since /persons?role=mp is not NS-scoped and
  // cannot be — leading with the chamber's 240 and landing on 2,120 rows is the same
  // "show one window, count another" failure the plan spent three audits removing.
  const metrics = useMemo<
    Record<string, { metric: string; caption: string }>
  >(() => {
    const out: Record<string, { metric: string; caption: string }> = {};
    if (!stats) return out;
    const tiles = stats.tiles;
    Object.assign(out, {
      votes: {
        metric: nf.format(tiles.sessions),
        caption: t("nsh_metric_sessions") || "sittings",
      },
      embedding: {
        metric: nf.format(tiles.membersProjected),
        caption: t("nsh_metric_projected") || "MPs projected",
      },
      cohesion: {
        metric: dec2.format(tiles.cohesionMean),
        caption: t("nsh_metric_cohesion") || "mean cohesion",
      },
      // NO metric on Депутати, deliberately. /persons?role=mp is not NS-scoped and cannot
      // be — person_role rows for `mp` carry ref = mpId with no term column — so the
      // destination shows every member since the 44th, a number this corpus cannot
      // produce. Printing the chamber's roll beside a link to 2,120 rows is the
      // "show one window, count another" failure; an absent figure is honest.
      attendance: {
        metric: pct.format(tiles.attendanceWeighted),
        caption: t("nsh_metric_attendance") || "attendance (weighted)",
      },
    });
    return out;
  }, [stats, nf, pct, dec2, t]);

  const pageTitle = t("nsh_hub_title") || "National Assembly";
  const cta = t("gov_hub_view") || "разгледай";

  const seeds: Partial<Record<ParliamentSeed, string | undefined>> = useMemo(
    () => stats?.seeds ?? {},
    [stats],
  );

  const sections: TileHubSection[] = useMemo(
    () =>
      PARLIAMENT_BANDS.map((band) => ({
        heading: t(band.labelKey),
        tiles: band.tiles.flatMap((tile) => {
          const to = resolveDestination(tile, seeds);
          // An unresolved seed omits the tile. Rendering it with the raw `:mpId` pattern
          // would give a link that 404s in the SPA and, worse, would satisfy any gate that
          // only checks the destination is absolute.
          if (!to) return [];
          return [
            {
              to,
              title: t(tile.titleKey),
              desc: t(tile.descKey),
              accent: tile.accent,
              scene: PARLIAMENT_SCENES[tile.id],
              cta,
              ...(metrics[tile.id] ?? {}),
              ...(metrics[tile.id]
                ? { metricCaption: metrics[tile.id].caption }
                : {}),
            },
          ];
        }),
      })).filter((section) => section.tiles.length > 0),
    [t, cta, seeds, metrics],
  );

  return (
    <>
      <Title description={t("nsh_hub_description") || pageTitle}>
        {pageTitle}
      </Title>
      <GovernanceBreadcrumb
        sectionKey="gov_hub_parliament_title"
        sectionTo="/parliament"
        className="mt-5"
      />

      {/* THE THREE COVERAGE STATES (§2.3). `undefined` is not "still loading" — four of the
          thirteen elections in the picker map to a parliament that published no roll-call
          votes, and ?elections= is preserved across navigation, so arriving here from a
          2009 page is an ordinary path. `partial` is the dangerous one: it renders exactly
          like a complete term unless the page says otherwise. */}
      {stats?.coverage === "partial" ? (
        <p className="mt-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {t("nsh_coverage_partial", {
            from: stats.coveredFrom,
            to: stats.coveredTo,
          })}
        </p>
      ) : null}

      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        {t("nsh_hub_intro") ||
          "Roll-call voting in the Bulgarian National Assembly — every sitting, every item, and how each MP voted."}
      </p>

      {/* data-og is the OG capture's anchor (scripts/og/capture-screens.ts). The previous
          capture selected a party-correlation heatmap cell inside a tile this rebuild
          removes, so it would have waited 60 s and failed silently. */}
      <div data-og="parliament-hub">
        <div className="mt-4">
          <ParliamentSessionStrip />
        </div>
        <TileHubGrid sections={sections} className="mt-6 sm:mt-8" />
      </div>

      <p className="mt-8 text-xs text-muted-foreground">
        {t("nsh_hub_data_note") ||
          "Source: parliament.bg stenograms. Per-MP, per-item votes are extracted from the official roll-call CSV attached to each plenary day."}
      </p>
    </>
  );
};
