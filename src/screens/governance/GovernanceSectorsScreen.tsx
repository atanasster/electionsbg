// /governance/sectors — the "Държавни сектори" hub.
//
// A single visual entry point to every government-entity dashboard, replacing
// the 15-row "Държавни структури" column that used to bloat the управление
// dropdown. Data comes from the shared sectorRegistry; layout from the reusable
// infographic tile-hub kit (src/ux/infographic). Each tile overlays the sector's
// all-time procurement € from the pre-generated sector_stats.json (one fetch),
// then routes to the sector's existing home.

import { FC, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { usePreserveParams } from "@/ux/usePreserveParams";
import { HubHead, TileHubGrid, TileHubSection } from "@/ux/infographic";
import {
  promotedTiles,
  sectorsHubKpis,
  sectorsKpiNote,
} from "./sectorsHubFigures";
import { SectorBreadcrumb } from "@/screens/components/procurement/SectorBreadcrumb";
import { ScopeControl } from "@/screens/components/ScopeControl";
import {
  useSectorStatsQuery,
  formatSectorMetric,
  sectorMetricCaption,
  scopeProcurementPeriod,
} from "@/data/procurement/useSectorStats";
import { useScopeWindow } from "@/data/scope/useScopeWindow";
import { SECTOR_CLUSTERS } from "./sectorRegistry";
import { SECTOR_SCENES } from "./sectorScenes";

export const GovernanceSectorsScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const { stats, pending } = useSectorStatsQuery();
  const win = useScopeWindow();
  const period = scopeProcurementPeriod(win);
  const searchParams = usePreserveParams();
  // Carry ?pscope across to the methodology page, like every other in-app link.
  //
  // ⚠️ `useCallback`, because the band's `useMemo` depends on it: a fresh closure per render
  // rebuilds the KPI array every time, and `HubHead` keys its cells off that array.
  const linkTo = useCallback(
    (path: string) => {
      const merged = searchParams().toString();
      return merged ? `${path}?${merged}` : path;
    },
    [searchParams],
  );
  const cta = t("sectors_hub_view") || "виж сектора";

  // Sector id → its registry entry, so the band can name and link whichever sector turns
  // out to be largest on each basis without restating the registry.
  const byId = useMemo(
    () =>
      new Map(SECTOR_CLUSTERS.flatMap((c) => c.sectors.map((x) => [x.id, x]))),
    [],
  );
  const kpis = useMemo(
    () =>
      sectorsHubKpis(
        stats,
        i18n.language,
        period,
        t,
        (id) => t(byId.get(id)?.titleKey ?? id),
        // ⚠️ THE BARE REGISTRY PATH — `HubHead` scopes it. Every cell goes through
        // `useHeadHref`, which merges the active `?pscope` in, so routing these through
        // `linkTo` as well was redundant: it produced a pre-scoped href that the head then
        // re-merged, and it made the scope look like this screen's doing when it is the
        // component's. The distinction matters because the procurement cell is the ONE
        // figure here that moves with the pill (€672.6m on the selected parliament against
        // €29.6bn all-time), so who guarantees its link is worth being right about.
        (id) => byId.get(id)?.to,
        // The cross-sector total's own destination — it belongs to no sector.
        "/procurement",
      ),
    [stats, i18n.language, period, t, byId],
  );
  // DERIVED from the cells that rendered — three of the four name whichever sector is
  // largest on their basis, so the displaced tile is not knowable until the payload is read.
  const promoted = useMemo(() => promotedTiles(kpis), [kpis]);

  const sections: TileHubSection[] = SECTOR_CLUSTERS.map((cluster) => ({
    heading: t(cluster.labelKey),
    tiles: cluster.sectors.map((s) => ({
      to: s.to,
      title: t(s.titleKey),
      badge: s.agency,
      desc: t(s.descKey),
      accent: s.accent,
      scene: SECTOR_SCENES[s.id],
      cta,
      // §3.1 rule 5 — a figure is the band's OR the tile's, never both. A promoted tile
      // renders BARE, and `{}` is how that is said.
      //
      // ⚠️ NOT „keeps its caption": `InfographicTile` guards `metricCaption` behind
      // `{metric ? … }` on BOTH layouts, so a lone caption renders exactly nothing. The two
      // spellings are output-identical — which is why no test can tell them apart, and why
      // the wrong one survived review here as a comment asserting an invariant the
      // component cannot honour. `{}` is what every sibling hub passes for a promoted tile
      // with no second figure, and these three sectors carry one headline each.
      ...(promoted.has(s.id)
        ? {}
        : {
            metric: formatSectorMetric(stats?.[s.id], i18n.language),
            metricCaption: sectorMetricCaption(
              stats?.[s.id],
              t,
              period,
              win.year,
            ),
          }),
    })),
  }));

  return (
    <>
      <SectorBreadcrumb className="mt-5" />

      <HubHead
        eyebrow={t("sectors_head_eyebrow")}
        title={t("sectors_head_title")}
        seoDescription={
          t("sectors_hub_seo_description") ||
          "Всичко, което държавата харчи и решава — по сектори: пътища, здравеопазване, пенсии, отбрана, правосъдие и още."
        }
        deck={t("sectors_head_deck")}
        kpis={kpis}
        // Four cells, and only while the payload is genuinely IN FLIGHT. `!stats` would be
        // a tautology against a band that is empty iff `!stats`.
        kpisPending={pending ? 4 : undefined}
        kpiNote={sectorsKpiNote(kpis, t)}
        scope={<ScopeControl mode="toggle" />}
      />

      <div data-og="sectors-hub">
        <TileHubGrid sections={sections} className="mt-4 sm:mt-6" />
      </div>

      {/* The unit-cost family's shared methodology (plan §3). Three sector tiles
          — courts €/case, roads €/km, health €/case — compute the same KIND of
          number, and each used to restate its caveat in its own words. This is
          the one place the rules live; the tiles link back to it.

          Deliberately a NAVIGATIONAL index, not a scoreboard: §3b rules out a
          composite efficiency index because the three units are not
          commensurable, and restating three live figures here would be a fourth
          copy that goes stale — the drift the plan flags for hub_stats. Each
          figure stays where it is computed. */}
      <div className="mt-6 rounded-lg border border-border/60 bg-muted/30 p-4">
        <h2 className="text-sm font-semibold">
          {t("unit_cost_hub_heading") || "Цена за единица резултат"}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("unit_cost_hub_blurb") ||
            "Разход за свършено дело, цена на километър, разход за болничен случай — едно и също по вид число на три места. Какво измерва и какво не."}
        </p>
        <Link
          to={linkTo("/governance/sectors/methodology")}
          className="mt-2 inline-block text-xs font-medium text-primary hover:underline"
        >
          {t("unit_cost_hub_cta") || "Методология"} →
        </Link>
      </div>
    </>
  );
};
