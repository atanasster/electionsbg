// /sector/transport — the transport sector hub. Plan:
// docs/plans/transport-hub-v1.md §3.
//
// This URL rendered the generic SectorDashboardScreen around TransportPack — one
// long scroll with no head and no stated basis, in which the ministry looked
// like a €2.4bn spender in its own right. The pack's tiles moved to four
// sub-pages (/network, /procurement, /bodies, /money); this page fronts them.
//
// Every figure comes from data/transport/derived/hub_stats.json
// (db:gen-transport-hub-stats), which runs the same model functions as the
// sub-pages (src/lib/transportAttributes.ts). The hub is UNSCOPED — whole corpus
// — so every link out to a scoped page carries `?pscope=all`.

import { FC, useMemo } from "react";
import { isBg } from "@/i18n";
import { useTranslation } from "react-i18next";
import { HubHead, TileHubGrid, type TileHubSection } from "@/ux/infographic";
import { SectorBreadcrumb } from "@/screens/components/procurement/SectorBreadcrumb";
import { useTransportHubStats } from "@/data/transport/hubStats";
import { HubSearch } from "@/ux/search/HubSearch";
import { transportSearchSources } from "./transportSearch";
import { TRANSPORT_BANDS, TRANSPORT_HUB_COPY } from "./transportRegistry";
import { TRANSPORT_SCENES } from "./transportScenes";
import {
  TRANSPORT_BAND_TILES,
  transportHubEvidence,
  transportHubKpis,
  transportKpiNote,
  transportTileMetric,
} from "./transportHubFigures";
import { TransportRoadsLinkTile } from "./TransportRoadsLinkTile";

/** „16.10" from the blob's generatedAt (YYYY-MM-DD). */
const ddmm = (iso: string | undefined): string | null => {
  const m = iso?.match(/^\d{4}-(\d{2})-(\d{2})/);
  return m ? `${m[2]}.${m[1]}` : null;
};

export const TransportHubScreen: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  const { data: stats, isPending, isError } = useTransportHubStats();
  // A registry typo would make the lookup undefined and `.bg` throw, taking the
  // hub down; transportRegistry.test.ts holds the keys, this degrades the rest.
  const t = (k: string) => {
    const e = TRANSPORT_HUB_COPY[k];
    return e ? (bg ? e.bg : e.en) : k;
  };

  // HubSearch diffs `sources` by identity, so rebuild only when the blob or the
  // language changes — never per render.
  const sources = useMemo(
    () => transportSearchSources(stats, lang, bg),
    [stats, lang, bg],
  );
  const kpis = useMemo(
    () => transportHubKpis(stats, lang, bg),
    [stats, lang, bg],
  );
  const evidence = useMemo(
    () => transportHubEvidence(stats, lang, bg),
    [stats, lang, bg],
  );
  const bandOwned = new Set<string>(TRANSPORT_BAND_TILES);

  const sections: TileHubSection[] = TRANSPORT_BANDS.map((band) => ({
    heading: t(band.labelKey),
    description: t(band.descKey),
    tiles: band.tiles.map((tile) => ({
      to: tile.to,
      title: t(tile.titleKey),
      desc: t(tile.descKey),
      accent: tile.accent,
      scene: TRANSPORT_SCENES[tile.id],
      ...(bandOwned.has(tile.id)
        ? {}
        : transportTileMetric(tile.id, stats, lang, bg)),
    })),
  }));

  const title = bg ? "Транспорт" : "Transport";
  const description = bg
    ? "Обществените поръчки на държавния транспорт — министерството, железниците, пристанищата, ръководството на въздушното движение и регулаторите: по вид транспорт, при каква конкуренция, колко остават в държавната група и какви еврофондове и субсидии стоят до тях."
    : "Public procurement of Bulgaria's state transport bodies — the ministry, the railways, the ports, air-traffic control and the regulators: by mode, with how much competition, how much stays inside the state group, and the EU funds and subsidies beside it.";
  const updated = ddmm(stats?.generatedAt);

  return (
    <>
      <SectorBreadcrumb currentKey="sector_transport_title" />
      <HubHead
        eyebrow={
          bg
            ? `СЕКТОР · ТРАНСПОРТ${updated ? ` · обновено ${updated}` : ""}`
            : `SECTOR · TRANSPORT${updated ? ` · updated ${updated}` : ""}`
        }
        title={title}
        seoDescription={description}
        deck={
          bg
            ? "Кой купува за железниците, пристанищата и въздушния транспорт, при каква конкуренция и колко остава в държавната група."
            : "Who buys for the railways, the ports and air transport, with how much competition, and how much stays inside the state group."
        }
        kpis={kpis}
        kpisPending={isPending ? 4 : undefined}
        kpiNote={kpis.length || isPending ? transportKpiNote(bg) : undefined}
        evidence={evidence}
        search={
          <HubSearch
            idPrefix="transport-finder"
            sources={sources}
            title={{
              bg: "Търси в транспортния сектор",
              en: "Search the transport sector",
            }}
            placeholder={{
              bg: "структура, жп участък, фирма, договор…",
              en: "body, rail section, company, contract…",
            }}
            hint={{
              bg: "Структурите и участъците се търсят в сектора; фирмите и договорите — в целия регистър.",
              en: "Bodies and sections are searched in the sector; companies and contracts across the whole register.",
            }}
          />
        }
      />
      {/* HubHead drops the band when it has no figures; without this a failed or
          absent blob just removes the head's numbers, with nothing saying why. */}
      {!isPending && (isError || !stats) ? (
        <p className="mt-4 rounded-xl border border-dashed border-border p-3 text-sm text-muted-foreground">
          {bg
            ? "Обобщените числа не можаха да се заредят — плочките по-долу водят към страниците с данните."
            : "The summary figures could not be loaded — the tiles below lead to the pages with the data."}
        </p>
      ) : null}
      <TileHubGrid className="mt-6" sections={sections} />
      {/* Roads is its own sector (D1): one footer cross-link, its figure read
          from the roads blob — never a literal. */}
      <div className="mt-6">
        <TransportRoadsLinkTile />
      </div>
    </>
  );
};
