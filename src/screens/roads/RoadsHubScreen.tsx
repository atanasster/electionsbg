// /sector/roads — the roads sector hub. Plan: docs/plans/roads-hub-v1.md §3.
//
// This URL rendered the generic SectorDashboardScreen around RoadsPack — one
// ~4,000 px scroll with no head, no stated basis and no way to say what you were
// looking for. The pack's tiles moved, largely unchanged, to three sub-pages
// (/network, /costs, /procurement); this page fronts them.
//
// Every figure comes from data/roads/derived/hub_stats.json
// (db:gen-roads-hub-stats), which runs the same engine as the sub-pages over the
// same roll-up (АПИ + НКСИП). The hub is UNSCOPED — whole corpus — so every link
// out carries `?pscope=all` (see roadsRegistry.ts).

import { FC, useMemo } from "react";
import { isBg } from "@/i18n";
import { useTranslation } from "react-i18next";
import { HubHead, TileHubGrid, type TileHubSection } from "@/ux/infographic";
import { SectorBreadcrumb } from "@/screens/components/procurement/SectorBreadcrumb";
import { HubSearch } from "@/ux/search/HubSearch";
import { roadsSearchSources } from "./roadsSearch";
import { useRoadsHubStats } from "@/data/roads/hubStats";
import { ROADS_BANDS, ROADS_HUB_COPY } from "./roadsRegistry";
import { ROADS_SCENES } from "./roadsScenes";
import {
  ROADS_BAND_TILES,
  roadsHubEvidence,
  roadsHubKpis,
  roadsKpiNote,
  roadsTileMetric,
} from "./roadsHubFigures";

export const RoadsHubScreen: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  const { data: stats, isPending } = useRoadsHubStats();
  // A registry typo would make the lookup undefined and `.bg` throw, taking the
  // hub down; roadsRegistry.test.ts holds the keys, this degrades the rest.
  const t = (k: string) => {
    const e = ROADS_HUB_COPY[k];
    return e ? (bg ? e.bg : e.en) : k;
  };

  const kpis = useMemo(() => roadsHubKpis(stats, lang, bg), [stats, lang, bg]);
  const evidence = useMemo(
    () => roadsHubEvidence(stats, lang, bg),
    [stats, lang, bg],
  );
  // HubSearch diffs `sources` by identity, so rebuild only when the blob or the
  // language changes — never per render.
  const sources = useMemo(
    () => roadsSearchSources(stats, lang, bg),
    [stats, lang, bg],
  );
  const bandOwned = new Set<string>(ROADS_BAND_TILES);

  const sections: TileHubSection[] = ROADS_BANDS.map((band) => ({
    heading: t(band.labelKey),
    description: t(band.descKey),
    tiles: band.tiles.map((tile) => ({
      to: tile.to,
      title: t(tile.titleKey),
      desc: t(tile.descKey),
      accent: tile.accent,
      scene: ROADS_SCENES[tile.id],
      ...(bandOwned.has(tile.id)
        ? {}
        : roadsTileMetric(tile.id, stats, lang, bg)),
    })),
  }));

  const title = bg ? "Пътища" : "Roads";
  const description = bg
    ? "Обществените поръчки за републиканските пътища — АПИ, областните пътни управления и НКСИП: кой строи и поддържа, на каква цена на километър, при каква конкуренция и колко са добавили анексите."
    : "Public procurement for Bulgaria's national roads — АПИ, its regional directorates and НКСИП: who builds and maintains them, at what cost per kilometre, with how much competition and how much annexes added.";

  return (
    <>
      <SectorBreadcrumb currentKey="sector_roads_title" />
      <HubHead
        eyebrow={bg ? "СЕКТОР · ПЪТИЩА" : "SECTOR · ROADS"}
        title={title}
        seoDescription={description}
        deck={
          bg
            ? "Проверете кой строи и поддържа републиканските пътища, на каква цена на километър и при каква конкуренция."
            : "See who builds and maintains Bulgaria's national roads, at what cost per kilometre and with how much competition."
        }
        kpis={kpis}
        kpisPending={isPending ? 4 : undefined}
        kpiNote={kpis.length || isPending ? roadsKpiNote(bg) : undefined}
        evidence={evidence}
        search={
          <HubSearch
            idPrefix="roads-finder"
            sources={sources}
            title={{ bg: "Търси в пътищата", en: "Search roads" }}
            placeholder={{
              bg: "коридор, фирма, договор…",
              en: "corridor, company, contract…",
            }}
            hint={{
              bg: "Коридорите се търсят в сектора; фирмите и договорите — в целия регистър.",
              en: "Corridors are searched in the sector; companies and contracts across the whole register.",
            }}
          />
        }
      />
      <TileHubGrid className="mt-6" sections={sections} />
    </>
  );
};
