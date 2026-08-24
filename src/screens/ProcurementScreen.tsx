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
        ? "по текущия парламент"
        : "this parliament";
  const kpis: HubKpi[] = stat
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
  const evidenceRows = FEATURED_SECTORS.map((sector) => ({
    label: t(sector.titleKey),
    value: formatSectorMetric(sectorStats?.[sector.id], i18n.language) ?? "—",
    to: sector.to,
  })).filter((row) => row.value !== "—");

  const tileFor = (p: ProcurementTile): InfographicTileProps => ({
    to: p.to,
    // Exactly one of `titleKey` / `title` is set — the registry's type says so and
    // procurementHubBands.test.ts asserts it, so the fallbacks here can never both miss.
    title: p.titleKey ? t(p.titleKey) : (p.title?.[bg ? "bg" : "en"] ?? ""),
    desc: p.descKey ? t(p.descKey) : p.desc?.[bg ? "bg" : "en"],
    accent: p.accent,
    scene: PROCUREMENT_SCENES[p.id],
    metric: metricFor(p.metric),
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
                // ⚠ SECTORS, so the heading says sectors. These rows are Пътища / Отбрана /
                // Енергетика — a sector contains many buyers (АПИ is inside „Пътища"), so
                // „Най-големи възложители" named a set the rows are not. A group's content,
                // its label and its destination have to be the same set.
                //
                // Shipping note: this duplicates the FeaturedStrip further down the page. The
                // shipped version should carry the top AWARDERS (a different set, and the one
                // the heading originally promised) so the head and the strip say two things.
                heading: bg ? "Най-големи сектори" : "Largest sectors",
                rows: evidenceRows.slice(0, 5),
                action: {
                  to: "/governance/sectors",
                  label: t("procurement_hub_all_sectors") || "All sectors →",
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
