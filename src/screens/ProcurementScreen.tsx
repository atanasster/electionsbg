// /procurement — the public-procurement HUB. A navigation-first landing: the
// combined search up top, then a tile grid that fronts every sub-page (overview
// analytics, contracts, contractors, connected people, tenders, appeals, NGOs,
// by-place, risk, watchlist) and a "featured sectors" strip into the sector
// dashboards. The headline numbers are overlaid on the tiles themselves (no
// separate KPI cards). The deep analytics that used to live here moved to
// /procurement/overview (reached via the "Обзор" tile). Reuses the tile-hub kit.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  TileHubGrid,
  TileHubSection,
  InfographicTileProps,
  FeaturedStrip,
  HubHead,
  HubKpi,
} from "@/ux/infographic";
import { ScopeControl } from "./components/ScopeControl";
import { GovernanceBreadcrumb } from "./components/GovernanceBreadcrumb";
import { useAwarderHref } from "./components/procurement/useAwarderHref";
import { decodeEntities } from "@/lib/decodeEntities";
import { ProcurementSearchTile } from "./components/procurement/ProcurementSearchTile";
import { ClaimCheckBox } from "./components/procurement/ClaimCheckBox";
import { WatchlistDigestTile } from "./components/procurement/WatchlistDigestTile";
import { useProcurementHubStats } from "@/data/procurement/useProcurementHubStats";
import {
  useSectorStats,
  formatSectorMetric,
  sectorMetricCaption,
  scopeProcurementPeriod,
} from "@/data/procurement/useSectorStats";
import { useScopeWindow } from "@/data/scope/useScopeWindow";
import { SCOPE_FIRST_YEAR } from "@/data/scope/constants";
import { useWatchlist } from "@/data/procurement/useWatchlist";
import { formatEurCompact } from "@/lib/currency";
import { PROCUREMENT_SCENES } from "./procurement/procurementScenes";
import {
  PROCUREMENT_BANDS,
  type ProcurementTile,
} from "./procurement/procurementRegistry";
import { FEATURED_SECTORS } from "./governance/sectorRegistry";
import { SECTOR_SCENES } from "./governance/sectorScenes";

export const ProcurementScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const stat = useProcurementHubStats();
  const sectorStats = useSectorStats();
  const sectorWin = useScopeWindow();
  const awarderHref = useAwarderHref();
  const sectorPeriod = scopeProcurementPeriod(sectorWin);
  const watchCount = useWatchlist().length;
  const title = t("procurement_index_title") || "Public procurement";

  const bg = i18n.language === "bg";
  // Locale-aware, and derived once. Pinned to "bg-BG" it grouped with U+00A0 on the English
  // site while the euro beside it followed the reader — two number conventions in one band.
  const numFmt = useMemo(
    () => new Intl.NumberFormat(bg ? "bg-BG" : "en-GB"),
    [bg],
  );

  // Numbers come from the pre-generated per-scope hub_stats.json (one fetch),
  // except the watchlist count which is local. `total` is the euro headline;
  // everything else is a plain count.
  const metricFor = (m?: string): string | undefined => {
    if (m === "watch")
      return watchCount > 0 ? numFmt.format(watchCount) : undefined;
    if (!m || !stat) return undefined;
    if (m === "total") return formatEurCompact(stat.totalEur, i18n.language);
    const counts: Record<string, number | undefined> = {
      contracts: stat.contracts,
      contractors: stat.contractors,
      connected: stat.connected,
      tenders: stat.tenders,
      appeals: stat.appeals,
      ngos: stat.ngos,
      places: stat.places,
      flags: stat.flags,
    };
    const v = counts[m];
    return v != null ? numFmt.format(v) : undefined;
  };

  // ⚠ NEVER a literal window. This read „2007–2026" for one commit — against a corpus whose
  // earliest contract is 2011-01-03 and which holds ZERO rows before 2011, so four years of
  // the stated window contained nothing. That is §0's own failure mode (a figure that is
  // arithmetically right and false as a sentence) in the one string that exists to prevent
  // it. `SCOPE_FIRST_YEAR` is the corpus floor the `?pscope` year picker already uses, and
  // the upper bound is derived the same way `defaultScopeYears()` derives it, so the caption
  // and the selector cannot disagree.
  const corpusYears = `${SCOPE_FIRST_YEAR}–${new Date().getFullYear()}`;
  const scopeBasis = sectorWin.all
    ? bg
      ? `целият корпус · ${corpusYears}`
      : `whole corpus · ${corpusYears}`
    : sectorWin.year != null
      ? `${sectorWin.year}`
      : bg
        ? "този парламент"
        : "this parliament";
  // ⚠ An EMPTY WINDOW renders no band at all, not a row of zeroes. `ns:2005_06_25` is a real
  // option in the election picker and the corpus starts 2011-01-03, so that scope has nothing
  // — and §0 is explicit that a structural zero is hidden rather than printed. The ranked list
  // beside it already rendered nothing there; this makes the two halves of the head agree.
  const kpis: HubKpi[] =
    stat && stat.contracts > 0
      ? [
          {
            value: formatEurCompact(stat.totalEur, i18n.language),
            label: bg ? "договорени" : "contracted",
            basis: scopeBasis,
            // The money story, not the row list — two adjacent cells must not share a
            // destination, and /procurement/contracts is the next cell's.
            to: "/procurement/overview",
          },
          {
            value: numFmt.format(stat.contracts),
            label: bg ? "договора" : "contracts",
            basis: scopeBasis,
            to: "/procurement/contracts",
          },
          {
            value: numFmt.format(stat.contractors),
            label: bg ? "изпълнители" : "contractors",
            basis: scopeBasis,
            to: "/procurement/contractors",
          },
          {
            value: numFmt.format(stat.appeals),
            label: bg ? "обжалвания в КЗК" : "appeals at the CPC",
            basis: scopeBasis,
            to: "/procurement/appeals",
          },
        ]
      : [];

  // The evidence column: a ranked list, deliberately not a chart (§4.2 — vendor-charts is
  // ~115 KB br and lazy, the entry budget is 56 000 B br, and a list is text so it prerenders
  // and is five more internal links). Rows come from the sector stats this page ALREADY
  // fetches for the featured strip below.
  // The head's ranked list: the three biggest BUYERS in the active window.
  //
  // It used to be the featured SECTORS — the same four the FeaturedStrip renders 400 px
  // below, so the head restated the grid instead of adding to it, and the sectors mixed
  // bases besides (`defense` is a single-year budget line, the others are procurement over
  // the window, ranked together as if comparable).
  //
  // These come from the SAME hub_stats blob the tiles read — folded in by the generator from
  // `procurement_overview()`, which is the call /procurement/overview itself renders — so the
  // list costs no extra fetch and cannot disagree with the page each row links to.
  const evidenceRows = (stat?.topAwarders ?? []).map((a) => ({
    id: a.eik,
    label: decodeEntities(a.name),
    value: formatEurCompact(a.eur, i18n.language),
    // Never a hand-rolled /awarder/ path: the helper carries the active scope, which a bare
    // pathname resets — so a row clicked from „целият корпус" would land on this parliament.
    // (HubHead re-merges it anyway now, for the KPI cells and the „виж класацията" link that
    // had exactly that defect; this keeps the row correct at source rather than by rescue.)
    to: awarderHref(a.eik),
  }));

  const captionFor = (p: ProcurementTile): string | undefined => {
    // A caption with no number above it is a floating fragment: `metricFor` returns undefined
    // whenever the blob has not loaded, the scope is not in it, or the watchlist is empty —
    // and the tile then renders „този парламент" under nothing.
    if (!p.metric || !p.metricBasis || !metricFor(p.metric)) return undefined;
    return p.metricBasis === "local"
      ? t("procurement_basis_local")
      : scopeBasis;
  };

  const tileFor = (p: ProcurementTile): InfographicTileProps => ({
    to: p.to,
    // Exactly one of `titleKey` / `title` is set — the registry's type says so and
    // procurementHubBands.test.ts asserts it, so the fallbacks here can never both miss.
    title: p.titleKey ? t(p.titleKey) : (p.title?.[bg ? "bg" : "en"] ?? ""),
    desc: p.descKey ? t(p.descKey) : p.desc?.[bg ? "bg" : "en"],
    accent: p.accent,
    scene: PROCUREMENT_SCENES[p.id],
    metric: metricFor(p.metric),
    metricCaption: captionFor(p),
  });

  const sections: TileHubSection[] = PROCUREMENT_BANDS.map((band) => ({
    heading: t(band.labelKey),
    description: t(band.descKey),
    tiles: band.tiles.map(tileFor),
  }));

  return (
    <>
      <GovernanceBreadcrumb
        sectionKey="procurement_link_label"
        sectionTo="/procurement"
        className="mt-5"
      />

      <HubHead
        eyebrow={t("procurement_link_label")}
        title={title}
        seoDescription="Aggregated public-procurement contracts from data.egov.bg"
        deck={
          bg
            ? "Всеки сключен договор на държавата и общините — възложител, изпълнител, сума, обжалване."
            : "Every contract signed by the Bulgarian state and its municipalities — buyer, supplier, amount, appeal."
        }
        scope={<ScopeControl mode="toggle" />}
        search={<ProcurementSearchTile />}
        kpis={kpis}
        evidence={
          evidenceRows.length
            ? {
                // Literally true of the rows now: they ARE awarders. It read „Най-големи
                // сектори" while the rows were sectors — correct then, because a sector
                // contains many buyers (АПИ sits inside „Пътища") and the two are different
                // sets. A group's content, its label and its destination must be one set.
                heading: t("procurement_head_top_awarders"),
                // „Най-големи" by WHAT. This corpus answers it at least three ways — contract
                // value, contract count, appeals — and the rows show a bare €, so nothing
                // beside them says which. The sibling /funds head carries the same line for the
                // same reason; fixing one hub and not the other is how a pattern stops being
                // one. The window is the reader's own `?pscope`, which the scope pill above
                // already states, so the basis names the measure and not the years.
                basis: t("procurement_head_top_awarders_basis"),
                rows: evidenceRows,
                // /procurement/overview is where the full ranking lives — the page these rows
                // are folded from. It reads the scope, so the link keeps the window.
                // The anchor, not the page top: /procurement/overview is a long analytics
                // page and the ranking these rows come from is its „entities" section. A
                // „see the ranking" link that lands 1 000 px above the ranking is the same
                // broken promise as a see-all that lands on an unfiltered page.
                action: {
                  to: "/procurement/overview#procurement-entities",
                  label: t("procurement_head_see_ranking"),
                },
              }
            : undefined
        }
      />

      <div className="mt-4">
        <ClaimCheckBox />
      </div>
      <WatchlistDigestTile />

      <div data-og="procurement-hub">
        <TileHubGrid sections={sections} className="mt-6" />
      </div>

      {/* Featured sectors — the highest-spend entities surfaced directly, with a
          link to the full 15-sector hub for the rest. */}
      <FeaturedStrip
        className="mt-8"
        heading={t("procurement_hub_sectors") || "Sectors"}
        action={{
          to: "/governance/sectors",
          label: t("procurement_hub_all_sectors") || "All sectors →",
        }}
        tiles={FEATURED_SECTORS.map((s) => ({
          to: s.to,
          title: t(s.titleKey),
          badge: s.agency,
          desc: t(s.descKey),
          accent: s.accent,
          scene: SECTOR_SCENES[s.id],
          cta: t("sectors_hub_view") || "виж сектора",
          metric: formatSectorMetric(sectorStats?.[s.id], i18n.language),
          metricCaption: sectorMetricCaption(
            sectorStats?.[s.id],
            t,
            sectorPeriod,
            sectorWin.year,
          ),
        }))}
      />
    </>
  );
};
