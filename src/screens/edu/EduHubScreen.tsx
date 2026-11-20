// /sector/edu — the education-and-science sector hub. Plan:
// docs/plans/edu-hub-v1.md §3.
//
// This URL rendered the generic SectorDashboardScreen around MonPack — a
// textbook-market analysis that never bound the sector's 126-EIK roster, so
// widening the roster moved no number on the page. The sector's analysis now
// lives on three sub-pages (/procurement, /bodies, /money) and this page fronts
// them; MonPack is kept, as the #textbooks section of /procurement.
//
// Every figure comes from data/education/derived/hub_stats.json
// (db:gen-edu-hub-stats). The hub is UNSCOPED — whole corpus — so every link to
// a scoped page carries `?pscope=all`.

import { FC, useMemo } from "react";
import { isBg } from "@/i18n";
import { useTranslation } from "react-i18next";
import { HubHead, TileHubGrid, type TileHubSection } from "@/ux/infographic";
import { SectorBreadcrumb } from "@/screens/components/procurement/SectorBreadcrumb";
import { useEduHubStats } from "@/data/edu/hubStats";
import { EDU_BANDS, EDU_HUB_COPY } from "./eduRegistry";
import { EDU_SCENES } from "./eduScenes";
import {
  EDU_BAND_TILES,
  eduHubEvidence,
  eduHubKpis,
  eduKpiNote,
  eduTileMetric,
} from "./eduHubFigures";
import { EDU_HUB_TITLE } from "./eduSectorData";

/** „16.10" from the blob's generatedAt (YYYY-MM-DD). */
const ddmm = (iso: string | undefined): string | null => {
  const m = iso?.match(/^\d{4}-(\d{2})-(\d{2})/);
  return m ? `${m[2]}.${m[1]}` : null;
};

const BAND_OWNED = new Set<string>(EDU_BAND_TILES);

export const EduHubScreen: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  const { data: stats, isPending, isError } = useEduHubStats();
  // A registry typo would make the lookup undefined and `.bg` throw, taking the
  // hub down; eduRegistry.test.ts holds the keys, this degrades the rest.
  const t = (k: string) => {
    const e = EDU_HUB_COPY[k];
    return e ? (bg ? e.bg : e.en) : k;
  };

  const kpis = useMemo(() => eduHubKpis(stats, lang, bg), [stats, lang, bg]);
  const evidence = useMemo(
    () => eduHubEvidence(stats, lang, bg),
    [stats, lang, bg],
  );

  const sections: TileHubSection[] = EDU_BANDS.map((band) => ({
    heading: t(band.labelKey),
    description: t(band.descKey),
    tiles: band.tiles.map((tile) => ({
      to: tile.to,
      title: t(tile.titleKey),
      desc: t(tile.descKey),
      accent: tile.accent,
      scene: EDU_SCENES[tile.id],
      ...(BAND_OWNED.has(tile.id)
        ? {}
        : eduTileMetric(tile.id, stats, lang, bg)),
    })),
  }));

  const title = bg ? EDU_HUB_TITLE.bg : EDU_HUB_TITLE.en;
  const description = bg
    ? "Обществените поръчки на държавното образование и науката — МОН и неговите агенции, държавните университети, БАН и Селскостопанската академия: кой купува, при каква конкуренция, най-големите договори и еврофондовете до тях."
    : "Public procurement of Bulgaria's state education and science — МОН and its agencies, the state universities, the Academy of Sciences and the Agricultural Academy: who buys, with how much competition, the largest contracts and the EU funds beside them.";
  const updated = ddmm(stats?.generatedAt);

  return (
    <>
      <SectorBreadcrumb currentKey="sector_edu_title" />
      <HubHead
        eyebrow={
          bg
            ? `СЕКТОР · ОБРАЗОВАНИЕ И НАУКА${updated ? ` · обновено ${updated}` : ""}`
            : `SECTOR · EDUCATION AND SCIENCE${updated ? ` · updated ${updated}` : ""}`
        }
        title={title}
        seoDescription={description}
        deck={
          bg
            ? "Какво купуват министерството, университетите и БАН, при каква конкуренция и колко евро идва отвън."
            : "What the ministry, the universities and the Academy of Sciences buy, with how much competition, and how many euros come from outside."
        }
        kpis={kpis}
        kpisPending={isPending ? 4 : undefined}
        kpiNote={kpis.length || isPending ? eduKpiNote(bg) : undefined}
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
