// /culture — the sector hub.
//
// This URL used to render the НФЦ film-subsidy dashboard, which moved verbatim to
// /culture/subsidies. The reason is the whole point of the rework: film subsidy is
// €94.9m of a subject whose PROCUREMENT alone is €166.7m and whose ИСУН grants are
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
import {
  useCultureHubStats,
  type CultureHubStats,
} from "@/data/culture/hubStats";
import { formatEurCompact, formatInt } from "@/lib/currency";
import { CULTURE_SCENES } from "./cultureScenes";
import { cultureSearchSources } from "./cultureSearch";

/** One tile's metric, or nothing.
 *
 * `undefined` when the figure is absent — a checkout that never ran
 * `db:gen-culture-hub-stats`, or a cold database. The tile then renders with no
 * number, which is the honest state; a `0` would be a claim.
 *
 * EVERY FIGURE IS THE DESTINATION'S OWN, per the dashboard-hub rule. The funds
 * tile is the one that can go wrong quietly: `/culture/funds` will rank the
 * NAME-matched population, so this quotes `byNameEur` (€147.1m) and carries the
 * EIK-exact figure as the secondary rather than the other way round — the two
 * are 56% apart and both true.
 */
const tileMetric = (
  id: string,
  s: CultureHubStats | null | undefined,
  lang: string,
  bg: boolean,
):
  | { metric: string; metricCaption: string; metricSecondary?: string }
  | undefined => {
  if (!s) return undefined;
  const eur = (n: number) => formatEurCompact(n, lang);
  const int = (n: number) => formatInt(n, lang);
  const pct = (num: number, den: number) =>
    den
      ? new Intl.NumberFormat(bg ? "bg-BG" : "en-GB", {
          maximumFractionDigits: 1,
        }).format((num / den) * 100) + "%"
      : null;
  const p = s.procurement;

  switch (id) {
    case "procurement":
      return {
        metric: eur(p.eur),
        metricCaption: bg ? "поръчки" : "contracts",
        metricSecondary: bg
          ? `${int(p.contracts)} договора · ${int(p.buyers)} институции`
          : `${int(p.contracts)} contracts · ${int(p.buyers)} institutions`,
      };
    case "competition": {
      const sector = pct(p.singleBid, p.bidKnown);
      const national = pct(p.nationalSingleBid, p.nationalBidKnown);
      if (!sector) return undefined;
      return {
        metric: sector,
        metricCaption: bg ? "с една оферта" : "single-bidder",
        // The baseline rides WITH the figure, never in a footnote: alone, this
        // number reads as an indictment of something entirely ordinary.
        metricSecondary: national
          ? bg
            ? `при ${national} за страната`
            : `against ${national} nationally`
          : undefined,
      };
    }
    case "risk": {
      const flagged = (s.risk.grades.C ?? 0) + (s.risk.grades.D ?? 0);
      if (!flagged) return undefined;
      return {
        metric: int(flagged),
        metricCaption: bg ? "с оценка C или D" : "graded C or D",
      };
    }
    case "contractors":
      // NO METRIC, deliberately. The 408 suppliers below ARE culture's, but this
      // tile links to /procurement/contractors — the NATIONAL leaderboard of
      // 29,550, which refuses ?sector by design because contractor_rank has no
      // buyer dimension (§1.3-B / step 2b). Quoting 408 over a destination that
      // shows 29,550 breaks the dashboard-hub rule that a tile's figure is its
      // destination's own, and it is the more damaging direction: the reader
      // trusts the number, clicks, and finds a different world.
      //
      // The figure returns when /culture/procurement#contractors lands (step 6),
      // which renders exactly these 408 from awarder_group_model.
      return undefined;
    case "directors":
      return {
        metric: int(s.people.culturalInstituteRoles),
        metricCaption: bg ? "директори" : "directors",
      };
    default:
      return undefined;
  }
};

export const CultureHubScreen: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const { data: stats } = useCultureHubStats();
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
      ...tileMetric(tile.id, stats, lang, bg),
    })),
  }));

  const title = bg ? "Култура" : "Culture";
  const description = bg
    ? "Публичните пари за култура на едно място: бюджетът на Министерството на културата, обществените поръчки на държавните културни институти, филмовите субсидии на НФЦ и еврофондовете — кой получава, от кого и с каква конкуренция."
    : "Bulgaria's public culture money in one place: the Ministry of Culture's budget, the public contracts of the state cultural institutes, the National Film Center's film subsidies and EU funds — who receives, from whom, and with how much competition.";

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
