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
import { isBg } from "@/i18n";
import { useTranslation } from "react-i18next";
import { HubHead, TileHubGrid, type TileHubSection } from "@/ux/infographic";
import {
  cultureHubEvidence,
  cultureHubKpis,
  demotedMetric,
  cultureStreamsNote,
  promotedTiles,
} from "./cultureHubFigures";
import { SectorBreadcrumb } from "@/screens/components/procurement/SectorBreadcrumb";
import { HubSearch } from "@/ux/search/HubSearch";
import { useAwarderHref } from "@/screens/components/procurement/useAwarderHref";
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
 * EVERY FIGURE IS THE DESTINATION'S OWN, per the dashboard-hub rule.
 *
 * ⚠️ THERE IS NO `funds`, `budget` OR `subsidies` CASE BELOW — all three fall to
 * `default`, and their tiles render bare because the HEAD carries those figures now
 * (cultureHubFigures.ts). A paragraph here used to say which funds arm this quoted; it
 * was stale before the head existed — there has never been such a case — and actively
 * misleading after it, because a reader checking whether the hub contradicts itself
 * about funds would have concluded the tile quotes the arm the band does not.
 * The funds arms and their 38.8% gap are documented where the figure now lives.
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
  const bg = isBg(lang);
  const { data: stats, isPending } = useCultureHubStats();
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

  const kpis = useMemo(
    () => cultureHubKpis(stats, lang, bg),
    [stats, lang, bg],
  );
  // DERIVED from the cells that actually rendered — see `promotedTiles`. Two of the four
  // are optional on the wire, so a compile-time list would blank a tile whose cell was
  // withheld and delete the figure from the page altogether.
  const promoted = useMemo(() => promotedTiles(kpis), [kpis]);
  // Through the shared helper, never a hand-built `/awarder/…` — a bare pathname RESETS
  // the active time scope on the destination.
  //
  // ⚠️ AND FORCED TO `?pscope=all`, because the helper preserves the CURRENT scope and this
  // hub has none: the awarder page then opens on the selected parliament while the rail's
  // figures are whole-corpus. Measured, the €43.7m НДК row landed on a page showing zero
  // contracts. Same rule `cultureRegistry.ts` states for every procurement tile.
  const rawAwarderHref = useAwarderHref();
  const awarderHref = useMemo(
    () => (eik: string) => {
      const to = rawAwarderHref(eik);
      return typeof to === "string"
        ? { pathname: to.split("?")[0], search: "?pscope=all" }
        : { ...to, search: "?pscope=all" };
    },
    [rawAwarderHref],
  );
  const evidence = useMemo(
    () => cultureHubEvidence(stats, lang, bg, awarderHref),
    [stats, lang, bg, awarderHref],
  );

  const sections: TileHubSection[] = CULTURE_BANDS.map((band) => ({
    heading: t(band.labelKey),
    description: t(band.descKey),
    tiles: band.tiles.map((tile) => ({
      to: tile.to,
      title: t(tile.titleKey),
      desc: t(tile.descKey),
      accent: tile.accent,
      scene: CULTURE_SCENES[tile.id],
      // §3.1 rule 5 — a figure is the band's OR the tile's, never both. The TILE is
      // demoted rather than the cell dropped: `procurement` keeps its OTHER figure
      // (договори · институции) as its headline, so promoting a number moves it up the
      // page instead of removing it. The other three carry no tile metric today, so for
      // them the band is pure gain.
      ...(promoted.has(tile.id)
        ? demotedMetric(tile.id, stats, lang, bg)
        : tileMetric(tile.id, stats, lang, bg)),
    })),
  }));

  const title = bg ? "Култура" : "Culture";
  const description = bg
    ? "Публичните пари за култура на едно място: бюджетът на Министерството на културата, обществените поръчки на държавните културни институти, филмовите субсидии на НФЦ и еврофондовете — кой получава, от кого и с каква конкуренция."
    : "Bulgaria's public culture money in one place: the Ministry of Culture's budget, the public contracts of the state cultural institutes, the National Film Center's film subsidies and EU funds — who receives, from whom, and with how much competition.";

  return (
    <>
      <SectorBreadcrumb currentKey="culture_nav" />

      <HubHead
        eyebrow={bg ? "СЕКТОР · КУЛТУРА" : "SECTOR · CULTURE"}
        title={title}
        seoDescription={description}
        deck={
          bg
            ? "Публичните пари за култура на едно място: бюджетът на Министерството, поръчките на държавните културни институти, филмовите субсидии на НФЦ и еврофондовете."
            : "Bulgaria's public culture money in one place: the Ministry's budget, the state cultural institutes' contracts, the National Film Center's film subsidy and EU funds."
        }
        kpis={kpis}
        // Four cells, and only while the request is genuinely IN FLIGHT. `!stats` would be
        // a tautology against a band that is empty iff `!stats`: the hook treats a 404 as
        // an ANSWER („render the tiles without numbers"), so a skeleton keyed on it pulses
        // for ever on any checkout that never ran the generator.
        kpisPending={isPending ? 4 : undefined}
        // ⚠️ THE TWO GUARDS ARE EXACT COMPLEMENTS, and the condition is „does the band
        // BLOCK render", not „are there cells". HubHead draws the block for a PENDING band
        // too, so gating on `kpis.length` alone put the note below the head while loading
        // and moved it into the band when stats landed — one placement throughout, but a
        // sentence that visibly jumps and shifts everything under it.
        kpiNote={kpis.length || isPending ? cultureStreamsNote(bg) : undefined}
        evidence={evidence}
        search={
          <HubSearch
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
        }
      />

      {/* The streams note's OTHER home, and the exact complement of `kpiNote` above. With
          no blob AND nothing in flight the head renders no band at all, and `kpiNote` lives
          inside the band's guard — so without this the page loses the one claim on it that
          is an argument rather than a number, on exactly the checkouts that have no numbers
          to argue about. Never zero placements, never two. */}
      {kpis.length === 0 && !isPending ? (
        <p className="mt-4 max-w-3xl text-sm text-muted-foreground">
          {cultureStreamsNote(bg)}
        </p>
      ) : null}

      <TileHubGrid className="mt-6" sections={sections} />
    </>
  );
};
