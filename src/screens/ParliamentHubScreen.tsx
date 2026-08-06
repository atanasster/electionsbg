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
import { useSimilarityHeadline } from "@/data/parliament/votes/useSimilarityHeadline";
import { usePartyCorrelation } from "@/data/parliament/votes/usePartyCorrelation";
import {
  PARLIAMENT_BANDS,
  PARLIAMENT_TILES,
  resolveDestination,
  type ParliamentSeed,
} from "./parliament/parliamentRegistry";
import { PARLIAMENT_SCENES } from "./parliament/parliamentScenes";
import { ParliamentSessionStrip } from "./parliament/ParliamentSessionStrip";
import { mostDivergentPairSlug } from "./parliament/seeds";

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
  const { t } = useTranslation();
  const { headline } = useSimilarityHeadline();
  const { slice } = usePartyCorrelation();

  const pageTitle = t("nsh_hub_title") || "National Assembly";
  const cta = t("gov_hub_view") || "разгледай";

  const seeds: Partial<Record<ParliamentSeed, string | undefined>> = useMemo(
    () => ({
      similarity:
        headline?.seedId != null ? String(headline.seedId) : undefined,
      pair: mostDivergentPairSlug(slice?.parties, slice?.matrix),
    }),
    [headline, slice],
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
            },
          ];
        }),
      })).filter((section) => section.tiles.length > 0),
    [t, cta, seeds],
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
