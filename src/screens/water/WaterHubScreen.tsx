// /water — the water sector hub. Plan: docs/plans/water-hub-v1.md §3.
//
// This URL was one long scroll — finder, operator map, five procurement tiles,
// the НСИ tile and the riverbed tile — with no head and no stated basis. The
// tiles moved, largely unchanged, to five sub-pages (/operators, /procurement,
// /services, /floods, /funds); this page fronts them.
//
// Every figure comes from data/water/derived/hub_stats.json
// (db:gen-water-hub-stats). The hub is UNSCOPED — whole corpus — so it reads no
// scope hook and shows no scope control, and every link to a scoped page carries
// `?pscope=all` (see waterRegistry.ts, G9).

import { FC, useMemo } from "react";
import { isBg } from "@/i18n";
import { useTranslation } from "react-i18next";
import { HubHead, TileHubGrid, type TileHubSection } from "@/ux/infographic";
import { SectorBreadcrumb } from "@/screens/components/procurement/SectorBreadcrumb";
import { useWaterHubStats } from "@/data/water/hubStats";
import { WATER_BANDS, WATER_HUB_COPY } from "./waterRegistry";
import { WATER_SCENES } from "./waterScenes";
import {
  WATER_BAND_TILES,
  waterHubEvidence,
  waterHubKpis,
  waterKpiNote,
  waterTileMetric,
} from "./waterHubFigures";

export const WaterHubScreen: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  const { data: stats, isPending, isError } = useWaterHubStats();
  // A registry typo would make the lookup undefined and `.bg` throw, taking the
  // hub down; waterRegistry.test.ts holds the keys, this degrades the rest.
  const t = (k: string) => {
    const e = WATER_HUB_COPY[k];
    return e ? (bg ? e.bg : e.en) : k;
  };

  const kpis = useMemo(() => waterHubKpis(stats, lang, bg), [stats, lang, bg]);
  const evidence = useMemo(
    () => waterHubEvidence(stats, lang, bg),
    [stats, lang, bg],
  );
  const bandOwned = new Set<string>(WATER_BAND_TILES);

  const sections: TileHubSection[] = WATER_BANDS.map((band) => ({
    heading: t(band.labelKey),
    description: t(band.descKey),
    tiles: band.tiles.map((tile) => ({
      to: tile.to,
      title: t(tile.titleKey),
      desc: t(tile.descKey),
      accent: tile.accent,
      scene: WATER_SCENES[tile.id],
      ...(bandOwned.has(tile.id)
        ? {}
        : waterTileMetric(tile.id, stats, lang, bg)),
    })),
  }));

  const title = bg ? "Води (ВиК)" : "Water (ВиК)";
  const description = bg
    ? "Водният сектор на България — ВиК операторите, обществените им поръчки и конкуренцията в тях, европейските средства, водният режим и почистването на речните корита."
    : "Bulgaria's water sector — the water operators, their public procurement and its competition, EU funds, water rationing and riverbed cleaning.";

  return (
    <>
      <SectorBreadcrumb currentKey="procurement_water_nav" />
      <HubHead
        eyebrow={bg ? "СЕКТОР · ВОДИ" : "SECTOR · WATER"}
        title={title}
        seoDescription={description}
        deck={
          bg
            ? "Проверете кой доставя водата във вашата област, какво купува и при каква конкуренция — и колко хора живеят с воден режим."
            : "See who supplies the water in your province, what they buy and with how much competition — and how many people live with rationing."
        }
        kpis={kpis}
        kpisPending={isPending ? 4 : undefined}
        kpiNote={kpis.length || isPending ? waterKpiNote(bg) : undefined}
        evidence={evidence}
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
    </>
  );
};
