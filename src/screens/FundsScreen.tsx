// /funds — the EU-funds (ИСУН) hub. HubHead (identity → finder → the four corpus figures),
// then the live band-1 modules, then a tile grid fronting the deeper /funds/* pages.
//
// The map, the breakdown table and the „кой получи парите" band are NOT here: each lives on
// the page it belongs to. The map was the heaviest thing on this route — Leaflet plus a
// nation-wide GeoJSON plus a per-municipality payload — to draw a preview nobody had asked for.
//
// This banner described a „hero strip (clickable KPIs + map)" for some months after all three
// were gone. A stale file header is the cheapest kind of wrong comment to write and the most
// expensive to trust, so it is worth re-reading whenever the render tree below moves.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import { useFundsIndex } from "@/data/funds/useFundsIndex";
import { FundsFinder } from "./funds/FundsFinder";
import { OpenCallsTile } from "./funds/OpenCallsTile";
import { FitResolverTile } from "./funds/FitResolverTile";
import { FundsWireLine, FundsNewsRail } from "./funds/FundsWire";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";
import { HubHead, TileHubGrid, type TileHubSection } from "@/ux/infographic";
import { FUNDS_BANDS } from "./funds/fundsRegistry";
import { kpisFor, tileMetric } from "./funds/fundsHubFigures";
import { FUNDS_SCENES } from "./funds/fundsScenes";
import { useFundsHubStats } from "@/data/funds/useFundsHubStats";
import { formatEurCompact } from "@/lib/currency";

// Compact one-row breakdown strip — chips for the largest by-type buckets
// plus a trailing "by legal form" mini-summary. Replaces the tall two-axis
// table that previously dominated the page.
const SourceFooter: FC = () => {
  const { t } = useTranslation();
  return (
    <p className="mt-4 text-[11px] text-muted-foreground/80">
      {t("funds_index_source_hint") ||
        "Source: ИСУН 2020 public beneficiary register."}{" "}
      <a
        href="https://2020.eufunds.bg/bg/0/0/Beneficiary"
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-0.5 text-primary hover:underline"
      >
        2020.eufunds.bg <ExternalLink className="h-3 w-3" />
      </a>
    </p>
  );
};

/** The head's search slot: the wire line over the finder.
 *
 *  Written ONCE, so `hub_finder_single_render.test.ts` — a SOURCE scan counting
 *  `<FundsFinder />` — cannot be defeated by a second copy in a loading branch.
 */
const FundsHeadSearch: FC = () => (
  <>
    <FundsWireLine className="mb-3" />
    <FundsFinder />
  </>
);

export const FundsScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const { data: index } = useFundsIndex();
  const { data: hubStats } = useFundsHubStats();

  // The tile grid. Metrics come from ONE fetch (migration 145), and each is read from the same
  // payload its DESTINATION renders — so a tile cannot announce a figure the page it links to
  // disagrees with. A tile whose figure is absent renders without one rather than showing 0.
  const sections: TileHubSection[] = useMemo(
    () =>
      FUNDS_BANDS.map((band) => ({
        heading: t(band.labelKey),
        description: t(band.descKey),
        tiles: band.tiles.map((tile) => ({
          to: tile.to,
          title: t(tile.titleKey),
          desc: t(tile.descKey),
          accent: tile.accent,
          scene: FUNDS_SCENES[tile.id],
          // NO `cta`. „разгледай →" on every tile restates an affordance the card already has.
          ...(tileMetric(tile.id, hubStats, i18n.language, t) ?? {}),
        })),
      })),
    [t, hubStats, i18n.language],
  );

  const title = t("funds_index_title") || "EU funds";
  const description =
    "EU-funds beneficiaries from the ИСУН 2020 public register — funds contracted and paid, the political-economy cross-reference, and per-programme concentration metrics.";

  /* ONE HEAD, ONE RETURN. This screen used to early-return a whole second page shape for the
     loading state, which duplicated the identity and — because it returned — suppressed five
     modules that need no payload at all: the open calls, the fit resolver, the news rail, the
     tile grid and the source footer. A reader on a cold load saw four grey boxes where an
     entire page could already have rendered. The band is the ONLY part that waits, and
     `kpisPending` stands its own cells in its own slot until `index` lands. */
  const kpis = kpisFor(index, hubStats, i18n.language, t);

  /* THE HEAD'S RANKED LIST — where the „Договорени" cell's €44 млрд. actually sits.
   *
   * It DECOMPOSES a figure the reader has read in the same head — beside the band at `lg`,
   * beneath it on a phone — rather than adding a fifth statistic:
   * `sum(total_eur)` over the whole corpus IS `isun.contractedEur`, so these five rows are
   * parts of that number. Measured 2026-08-25 they hold 68% of it, and the Recovery Plan alone
   * holds 40% — which is the finding, and it is invisible on a page that only prints the total.
   *
   * Each row links to its OWN programme page, not all five to /funds/programmes: five links to
   * one destination is the defect the /procurement band shipped. The heading's action carries
   * the „see all" case.
   *
   * `?? []` and not a zero row: a database whose 145 predates the list has nothing to say here,
   * and HubHead renders no aside for an empty list. „0" would be a claim.
   */
  const evidence = useMemo(() => {
    const rows = hubStats?.topProgrammes ?? [];
    if (!rows.length) return undefined;
    return {
      heading: t("funds_head_evidence"),
      // „Най-големи" is answerable four ways here. The euro is `sum(total_eur)` — the contract
      // value INCLUDING the beneficiary's own co-finance — not the EU grant, which is 24%
      // smaller and ranks the programmes differently.
      basis: t("funds_head_evidence_basis"),
      rows: rows.map((p) => ({
        id: p.code,
        label: p.name,
        value: formatEurCompact(p.eur, i18n.language),
        to: `/funds/programme/${encodeURIComponent(p.code)}`,
      })),
      action: {
        to: "/funds/programmes",
        label: t("funds_head_evidence_all"),
      },
    };
  }, [hubStats, t, i18n.language]);

  return (
    <>
      <GovernanceBreadcrumb
        sectionKey="funds_index_title"
        sectionTo="/funds"
        className="mt-5"
      />
      <section aria-label={title}>
        {/* THE FOUR CORPUS FIGURES USED TO SIT AT ~2 600 px, below the wire, the finder, the
            open calls, the resolver and the news rail — on a page whose tile grid started at
            2 846 px. This hub was the extreme case in docs/plans/hub-hero-v1.md 2.1: nothing on
            it made a corpus-level statement until a reader had scrolled three screens.

            LOOK-UP STILL COMES BEFORE READ. The finder sits INSIDE the head, above the band, so
            the ordering docs/plans/funds-module-v2.md 5.2 argued for is kept: an aggregate is
            where you arrive after a look-up, not an entry point. What changed is that the
            aggregate is now on the first screen instead of the fourth. */}
        <HubHead
          eyebrow={t("funds_head_eyebrow")}
          title={title}
          seoDescription={description}
          deck={t("funds_head_deck")}
          search={<FundsHeadSearch />}
          kpis={kpis}
          kpisPending={4}
          evidence={evidence}
        />

        {/* BAND 1, second half. The finder answers „намери нещо конкретно"; this answers
            „какво мога да подам сега" — the question ~68% of the measured demand actually asks.
            Both sit above the KPI strip, because an aggregate is where you arrive AFTER a
            look-up, not an entry point. */}
        <OpenCallsTile />

        {/* BAND 1, third module. The finder answers „намери нещо конкретно"; the tile above
            answers „какво мога да подам сега"; this answers the question that comes BEFORE both
            and is the one most readers actually arrive with — „има ли изобщо нещо за мен".
            It sits after the open calls because a live deadline outranks a base rate: if
            something is open now, that is the more actionable fact. */}
        <FitResolverTile />

        {/* BAND 2 — the news rail, after the two band-1 lead modules and before the „кой получи
            парите" band. What is open and whether anything like mine was funded both outrank
            what merely changed. */}
        <FundsNewsRail />

        {/* THE MAP, THE BREAKDOWN STRIP AND THE „Кой получи парите" BAND ARE GONE FROM HERE.
            All five tiles they held now live on /funds/places, /funds/beneficiaries and
            /funds/programmes, and the grid below fronts them. The map was the single heaviest
            thing on this page — Leaflet plus a nation-wide GeoJSON plus a per-municipality
            payload — rendered to draw a preview nobody had asked for yet. */}

        {/* ── THE TILE GRID ────────────────────────────────────────────────────────────────
            Bands 2-4 used to render fourteen analysis tiles inline. Measured before this
            rework: /funds was 10 098 px tall and fetched 390 KB across 8 requests, of which
            /api/db/dual-corpus-rankings alone was 247 KB — 63% of the page, pulled to draw a
            preview leaderboard. Each of those tiles now lives on its own page and the hub
            fronts it, per the dashboard-hub pattern.

            Band 1 stays LIVE above this grid: /parliament keeps a lead card and a news rail
            around its own grid too, and funds-module-v2 measured that ~68% of this audience
            arrives asking „can I get money" — which band 1 answers. Band 5 („За теб") was
            removed on 2026-08-09; /funds/places is the place question's home now. */}
        <TileHubGrid sections={sections} className="mt-6 sm:mt-8" />

        <SourceFooter />
      </section>
    </>
  );
};
