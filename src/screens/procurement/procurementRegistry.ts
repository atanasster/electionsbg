// The /procurement hub registry — the single source of truth for the tiles the module fronts
// and the bands they sit in. Mirrors fundsRegistry.ts / parliamentRegistry.ts /
// governanceRegistry.ts: pure data, the scene is referenced by `id` (PROCUREMENT_SCENES[id]),
// so this module carries no JSX.
//
// THREE BANDS, 4 / 4 / 3, replacing one band of ELEVEN tiles headed „Разгледай" — an
// instruction, which tells a reader only that the things below can be looked at. Each band
// now answers a question and carries the line under it that makes the hub a table of contents
// (dashboard-hub skill §3.2).
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// MEMBERSHIP IS STRUCTURAL, and that is the whole reason this file exists rather than a
// regex over the screen. The first cut of the gate scanned ProcurementScreen.tsx source and
// silently mis-parsed: it read the two other bands' i18n keys as tile ids, counted quoted
// strings instead of tiles (so a band of three read as two), could not see `projectsTile` at
// all, and broke on a code comment — which §3.2 actively encourages. With the bands declared
// here and `PROCUREMENT_TILES` derived from them, an orphaned or duplicated tile is not
// merely detected, it is UNREPRESENTABLE.
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// ⚠ `metric` names the headline number the tile overlays, resolved from the same hub_stats
// blob the KPI band reads — and it may NOT be a figure that band already carries. The band
// publishes total / contracts / contractors / appeals above the fold with a declared basis,
// so those four tiles are deliberately descriptor-only: rendering the identical string twice
// on one page reads as two different facts (§3.1 rule 5, which this hub broke on the day the
// rule was written). Add a metric only after checking it against the screen's `kpis` array —
// `hubHead.gates.test.ts` enforces the disjointness.

import { TILE_ACCENTS } from "@/ux/infographic";

export interface ProcurementTile {
  /** Scene key (PROCUREMENT_SCENES) and the tile's stable identity. */
  id: string;
  /** Localized title. `titleKey` for the ten registry tiles; the project-file on-ramp is
   *  bilingual-inline, so it carries `title` instead. Exactly one of the two is set. */
  titleKey?: string;
  descKey?: string;
  title?: { bg: string; en: string };
  desc?: { bg: string; en: string };
  /** Absolute destination. All static — no seeded tiles on this hub (§4). */
  to: string;
  /** A TILE_ACCENTS token. Unique across the whole PAGE, which here includes the
   *  FeaturedStrip below the grid: `clay` and `teal` collided across the two registries
   *  because neither one's gate could see the other. */
  accent: string;
  /** The hub_stats field this tile overlays, when it has one. */
  metric?: string;
  /** HOW that figure is scoped — the caption under it says so, and getting this wrong is the
   *  §0 defect (a number that is arithmetically right and false as a sentence).
   *
   *    "scope"  moves with `?pscope`; the caption names the active window
   *    "local"  the reader's own browser state, not the corpus at all
   *
   *  ⚠ NOT EVERY FIELD IN A SCOPE-KEYED BLOB IS SCOPED, which is why this is declared rather
   *  than assumed. `hub_stats.ngos` sits beside eight fields that all vary and is 331 in all
   *  THIRTY scopes, because `procurement_hub_counts` computes it with no date predicate — so
   *  captioning it „този парламент" would publish a whole-register count as this parliament's.
   *  `procurementHubBands.test.ts` re-derives every "scope" claim from the blob, so a field
   *  that stops varying fails the gate rather than quietly captioning a window it ignores. */
  metricBasis?: "scope" | "local";
}

export interface ProcurementBand {
  labelKey: string;
  /** One line under the heading saying what is in the band. A heading names where you are;
   *  this says what you will find. */
  descKey: string;
  tiles: ProcurementTile[];
}

export const PROCUREMENT_BANDS: ProcurementBand[] = [
  {
    // 4 / 4 / 3. The grid is four columns at `xl`, so what matters is that no band leaves a
    // single tile alone on a second row: 4 and 3 both fit one row, 5 would not. (At `lg` it
    // is three columns and a four-tile band renders 3+1 — accepted by convention across
    // every hub on the site, and stated so the next reader does not read the gate as
    // comprehensive.)
    labelKey: "procurement_band_money",
    descKey: "procurement_band_money_desc",
    tiles: [
      {
        id: "analysis",
        titleKey: "procurement_overview_nav",
        descKey: "procurement_hub_analysis_desc",
        to: "/procurement/overview",
        accent: TILE_ACCENTS.brass,
      },
      {
        id: "contracts",
        titleKey: "procurement_index_contracts",
        descKey: "procurement_hub_contracts_desc",
        to: "/procurement/contracts",
        // magenta, not clay: the „Пътища" FeaturedStrip tile below this grid is `clay` too,
        // and the two come from different registries so no per-registry gate sees it.
        accent: TILE_ACCENTS.magenta,
      },
      {
        id: "contractors",
        titleKey: "procurement_index_contractors",
        descKey: "procurement_hub_contractors_desc",
        to: "/procurement/contractors",
        accent: TILE_ACCENTS.steel,
      },
      {
        id: "place",
        titleKey: "procurement_by_settlement_nav",
        descKey: "procurement_hub_place_desc",
        to: "/procurement/by-settlement",
        // fern, not teal: the „Води" FeaturedStrip tile below is `teal`.
        accent: TILE_ACCENTS.fern,
        metric: "places",
        metricBasis: "scope",
      },
    ],
  },
  {
    labelKey: "procurement_band_process",
    descKey: "procurement_band_process_desc",
    tiles: [
      {
        id: "tenders",
        titleKey: "procurement_tenders_nav",
        descKey: "procurement_hub_tenders_desc",
        to: "/procurement/tenders",
        accent: TILE_ACCENTS.azure,
        metric: "tenders",
        metricBasis: "scope",
      },
      {
        id: "appeals",
        titleKey: "procurement_appeals_nav",
        descKey: "procurement_hub_appeals_desc",
        to: "/procurement/appeals",
        accent: TILE_ACCENTS.plum,
      },
      {
        id: "risk",
        titleKey: "flags_nav",
        descKey: "procurement_hub_risk_desc",
        to: "/procurement/flags",
        accent: TILE_ACCENTS.rose,
        metric: "flags",
        metricBasis: "scope",
      },
      {
        // ⚠ NO FIGURE, deliberately. `hub_stats.ngos` is 331 — `count(DISTINCT eik) FROM
        // ngo_funding`, i.e. organisations that received money — while /procurement/ngos
        // OPENS on `entity_class IN (…) AND has_signal`, which is 3,984 (measured
        // 2026-08-24). Quoting 331 over a page listing 3,984 is §0's "destination counts a
        // different set", and the rule there is to lead with the DESTINATION's basis or show
        // no figure. There is no destination-basis field in the blob, so: no figure.
        //
        // It is ALSO the one field in that scope-keyed blob that ignores the scope —
        // procurement_hub_counts computes it with no date predicate, so it is 331 in all
        // thirty scopes while the other eight vary. Both reasons must be fixed before a
        // number goes back on this tile.
        id: "ngos",
        titleKey: "procurement_ngos_nav",
        descKey: "procurement_hub_ngos_desc",
        to: "/procurement/ngos",
        accent: TILE_ACCENTS.green,
      },
    ],
  },
  {
    labelKey: "procurement_band_links",
    descKey: "procurement_band_links_desc",
    tiles: [
      {
        id: "connected",
        titleKey: "procurement_index_connected",
        descKey: "procurement_hub_connected_desc",
        to: "/procurement/mps",
        accent: TILE_ACCENTS.amber,
        metric: "connected",
        metricBasis: "scope",
      },
      {
        // The project-file builder on-ramp. Bilingual-inline rather than keyed: it is the one
        // tile with no sub-page nav label to reuse.
        id: "projects",
        title: { bg: "Проектни досиета", en: "Project files" },
        desc: {
          bg: "Проследи един проект през поръчките",
          en: "Track one project across procurement",
        },
        to: "/procurement/project",
        accent: TILE_ACCENTS.indigo,
      },
      {
        // Last: it is the reader's OWN list, and the one tile whose figure is local rather
        // than corpus-wide.
        id: "watch",
        titleKey: "watchlist_nav",
        descKey: "procurement_hub_watch_desc",
        to: "/procurement/watchlist",
        accent: TILE_ACCENTS.gold,
        metric: "watch",
        metricBasis: "local",
      },
    ],
  },
];

/** Every tile, derived from the bands — so a tile in no band, or in two, cannot exist. */
export const PROCUREMENT_TILES: ProcurementTile[] = PROCUREMENT_BANDS.flatMap(
  (b) => b.tiles,
);

/** A tile `metric` id → the `hub_stats` field it reads. ONE table: both the band gate and
 *  `hubHead.gates.test.ts`'s band↔tile disjointness clause need it, and the second had its own
 *  copy while the first used an identity ternary that silently skipped every id needing a
 *  mapping — `total` → `totalEur` being the only one that does.
 *
 *  An empty string means "not a hub_stats field at all": `watch` is the reader's own
 *  localStorage list. */
export const METRIC_FIELD: Record<string, string> = {
  total: "totalEur",
  contracts: "contracts",
  contractors: "contractors",
  connected: "connected",
  tenders: "tenders",
  appeals: "appeals",
  ngos: "ngos",
  places: "places",
  flags: "flags",
  watch: "",
};
