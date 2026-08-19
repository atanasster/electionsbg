// /culture — the sector hub.
//
// This URL used to render the НФЦ film-subsidy dashboard, which moved verbatim to
// /culture/subsidies. The reason is the whole point of the rework: film subsidy is
// €94.9m of a subject whose PROCUREMENT alone is €157.9m and whose ИСУН grants are
// €147.1m, so the page carried 13% of its own subject's money and 100% of its
// content.
//
// The hub keeps the URL (it is prerendered and indexed) and changes what is on it.
// Per project_seo_discovery_gap the traffic does not simply transfer — broader-data
// pages earn ~0 impressions — so the prerendered body keeps the subsidy vocabulary
// and names /culture/subsidies explicitly.
//
// ═══════════════════════════════════════════════════════════════════════════════
// WHAT THE MOVE COMMITS YOU TO REGENERATING, none of it automatic:
//
//   • `npm run sitemap` — /culture/subsidies needs its own <loc> in BOTH language
//     shards, and `ogAndSitemapCoverage.test.ts` fails until it has one. Already
//     run; re-run it if either page's path changes again.
//   • `npm run og` — `scripts/og/capture-screens.ts` shoots the film hero, which
//     now lives on /culture/subsidies. The entry was repointed; until the capture
//     is re-run, /og/culture.png still shows the dashboard as it looked at the old
//     URL. Both pages declare that same image.
//   • `npm run build` — the prerender reads data/culture/overview.json at BUILD
//     time for both bodies, so a stale checkout emits stale figures with no error.
//
// The figures in COPY below are FROZEN STRINGS and cannot self-correct.
// `scripts/db/tests/culture_hub_figures.data.test.ts` re-derives every one from
// Postgres — that gate, not this comment, is what keeps them honest.
// ═══════════════════════════════════════════════════════════════════════════════

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { TileHubGrid, type TileHubSection } from "@/ux/infographic";
import { SectorBreadcrumb } from "@/screens/components/procurement/SectorBreadcrumb";
import { HubSearch } from "@/ux/search/HubSearch";
import { CULTURE_BANDS, CULTURE_HUB_COPY } from "./cultureRegistry";
import { CULTURE_SCENES } from "./cultureScenes";
import { cultureSearchSources } from "./cultureSearch";

export const CultureHubScreen: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  // COPY is a Record<string, …>, so TypeScript cannot see a missing key: a typo
  // in the registry would make `COPY[k]` undefined and `.bg` throw, taking the
  // whole hub down rather than one tile's label. `cultureRegistry.test.ts`
  // asserts every key the registry names exists here; this is the runtime half,
  // so a key that slips past the gate degrades to a visible placeholder instead
  // of a blank page.
  const t = (k: string) => {
    const entry = CULTURE_HUB_COPY[k];
    if (!entry) return k;
    return bg ? entry.bg : entry.en;
  };

  // Rebuilt only when the language changes. `cultureSearchSources` folds the
  // whole register into an EntityIndex, and HubSearch diffs its `sources` by
  // identity — a fresh array every render would re-fold on every keystroke.
  const sources = useMemo(() => cultureSearchSources(bg), [bg]);

  const sections: TileHubSection[] = CULTURE_BANDS.map((band) => ({
    heading: t(band.labelKey),
    description: t(band.descKey),
    tiles: band.tiles.map((tile) => ({
      to: tile.to,
      title: t(tile.titleKey),
      desc: t(tile.descKey),
      accent: tile.accent,
      scene: CULTURE_SCENES[tile.id],
    })),
  }));

  const title = bg ? "Култура" : "Culture";
  const description = bg
    ? "Публичните пари за култура на едно място: бюджетът на Министерството на културата, обществените поръчки на 42 държавни институции, филмовите субсидии на НФЦ и еврофондовете — кой получава, от кого и с каква конкуренция."
    : "Bulgaria's public culture money in one place: the Ministry of Culture's budget, the public contracts of 42 state institutions, the National Film Center's film subsidies and EU funds — who receives, from whom, and with how much competition.";

  return (
    <>
      <Title description={description}>{title}</Title>
      <SectorBreadcrumb currentKey="culture_nav" />

      <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
        {bg
          ? "Четирите потока по-долу стоят на различни основи и НЕ се събират: бюджетът на МК е годишен, поръчките и субсидиите са натрупани от 2011 г. и 2014 г. Затова са подредени по източник, а не по размер."
          : "The four streams below sit on different bases and do NOT sum: the ministry budget is annual, while contracts and subsidies accumulate from 2011 and 2014. They are ordered by source rather than by size."}
      </p>

      <HubSearch
        className="mt-4"
        idPrefix="culture-finder"
        sources={sources}
        title={{ bg: "Търси в културата", en: "Search culture" }}
        placeholder={{
          bg: "институция, поръчка, човек…",
          en: "institution, contract, person…",
        }}
        hint={{
          bg: "Институциите се търсят в регистъра на сектора; поръчките и хората — в целия корпус.",
          en: "Institutions are searched in the sector register; contracts and people across the whole corpus.",
        }}
      />

      <TileHubGrid className="mt-6" sections={sections} />
    </>
  );
};
