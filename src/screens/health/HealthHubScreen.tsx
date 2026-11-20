// /sector/health — the health sector hub. Plan: docs/plans/health-hub-v1.md §3.
//
// This URL rendered the generic SectorDashboardScreen around NzokPack, whose
// subject — the fund's ЗОП — is ~2% of the sector's money, while hospitals and
// medicines sat two clicks away on an awarder page (P1). The sector's analysis
// now lives on four sub-pages (/hospitals, /drugs, /procurement, /money) and
// this page fronts them.
//
// Every figure comes from data/health/derived/hub_stats.json
// (db:gen-health-hub-stats). The hub is UNSCOPED; only /procurement is scoped,
// so only its links carry `?pscope=all`.

import { FC, useMemo } from "react";
import { isBg } from "@/i18n";
import { useTranslation } from "react-i18next";
import { HubHead, TileHubGrid, type TileHubSection } from "@/ux/infographic";
import { SectorBreadcrumb } from "@/screens/components/procurement/SectorBreadcrumb";
import { useHealthHubStats } from "@/data/health/hubStats";
import { HEALTH_BANDS, HEALTH_HUB_COPY } from "./healthRegistry";
import { HEALTH_SCENES } from "./healthScenes";
import {
  HEALTH_BAND_TILES,
  healthHubEvidence,
  healthHubKpis,
  healthKpiNote,
  healthTileMetric,
} from "./healthHubFigures";
import { HEALTH_HUB_TITLE } from "./healthSectorData";

/** „16.10" from the blob's generatedAt (YYYY-MM-DD). */
const ddmm = (iso: string | undefined): string | null => {
  const m = iso?.match(/^\d{4}-(\d{2})-(\d{2})/);
  return m ? `${m[2]}.${m[1]}` : null;
};

const BAND_OWNED = new Set<string>(HEALTH_BAND_TILES);

export const HealthHubScreen: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  const { data: stats, isPending, isError } = useHealthHubStats();
  // A registry typo would make the lookup undefined and `.bg` throw, taking the
  // hub down; healthRegistry.test.ts holds the keys, this degrades the rest.
  const t = (k: string) => {
    const e = HEALTH_HUB_COPY[k];
    return e ? (bg ? e.bg : e.en) : k;
  };

  const kpis = useMemo(() => healthHubKpis(stats, lang, bg), [stats, lang, bg]);
  const evidence = useMemo(
    () => healthHubEvidence(stats, lang, bg),
    [stats, lang, bg],
  );

  const sections: TileHubSection[] = HEALTH_BANDS.map((band) => ({
    heading: t(band.labelKey),
    description: t(band.descKey),
    tiles: band.tiles.map((tile) => ({
      to: tile.to,
      title: t(tile.titleKey),
      desc: t(tile.descKey),
      accent: tile.accent,
      scene: HEALTH_SCENES[tile.id],
      ...(BAND_OWNED.has(tile.id)
        ? {}
        : healthTileMetric(tile.id, stats, lang, bg)),
    })),
  }));

  const title = bg ? HEALTH_HUB_TITLE.bg : HEALTH_HUB_TITLE.en;
  const description = bg
    ? "Къде отиват парите на здравната каса — болниците и лекарствата, които плаща, бюджетът ѝ, и какво купуват касата и Министерството на здравеопазването с обществени поръчки."
    : "Where Bulgaria's health insurance fund's money goes — the hospitals and medicines it pays for, its budget, and what the fund and the Ministry of Health buy through public procurement.";
  const updated = ddmm(stats?.generatedAt);

  return (
    <>
      <SectorBreadcrumb currentKey="sector_health_title" />
      <HubHead
        eyebrow={
          bg
            ? `СЕКТОР · ЗДРАВЕОПАЗВАНЕ${updated ? ` · обновено ${updated}` : ""}`
            : `SECTOR · HEALTHCARE${updated ? ` · updated ${updated}` : ""}`
        }
        title={title}
        seoDescription={description}
        deck={
          bg
            ? "Къде отиват парите на здравната каса: болници, лекарства, поръчки — и кой ги харчи."
            : "Where the health fund's money goes: hospitals, medicines, procurement — and who spends it."
        }
        kpis={kpis}
        kpisPending={isPending ? 4 : undefined}
        kpiNote={kpis.length || isPending ? healthKpiNote(bg) : undefined}
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
