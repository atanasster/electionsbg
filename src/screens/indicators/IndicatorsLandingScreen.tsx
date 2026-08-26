// /indicators — the KPI dashboard front door, laid out as a tile hub (like
// /procurement). The headline KpiTile grid stays on top; below it a grid of large
// illustrated tiles fronts the sibling domain pages (Икономика / Фискални /
// Бюджети / Управление / Общество / Сравни), led by a "Сравнение на всички
// кабинети" tile that cross-links to /governments#cabinet-table — where the full
// per-cabinet timeline + sortable table live (so the landing keeps no chart of
// its own).

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { useMacro } from "@/data/macro/useMacro";
import { useMacroPeers } from "@/data/macro/useMacroPeers";
import { useElectionAsOf } from "@/data/macro/useElectionAsOf";
import { pickAtOrBefore } from "@/data/macro/kpiSelectors";
import { formatPeriod } from "@/screens/components/macro/formatPeriod";
import { DOMAIN_PATHS, KPI_REGISTRY } from "./indicatorsRegistry";
import {
  BAND_INDICATORS,
  indicatorsHubEvidence,
  indicatorsHubKpis,
  indicatorsKpiNote,
  promotedIndicators,
  type IndicatorPoint,
  type PeerRank,
} from "./indicatorsHubFigures";
import { formatDate } from "@/lib/formatDate";
import { KpiTile } from "@/screens/components/macro/KpiTile";
import {
  HubHead,
  TileHubGrid,
  TileHubSection,
  InfographicTileProps,
  TILE_ACCENTS,
} from "@/ux/infographic";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";
import { LANDING_KPI_ORDER } from "./indicatorsRegistry";
import { INDICATOR_SCENES } from "./indicatorsScenes";

// The hub tiles. `cabinets` cross-links to the full per-cabinet table on
// /governments; the rest are the sibling domain pages. `to` gets the current
// search appended at render so ?elections= / ?cabinet= survive the navigation.
const HUB_TILES = [
  {
    id: "cabinets",
    to: "/governments",
    hash: "#cabinet-table",
    titleKey: "cabinet_compare_all",
    descKey: "indicators_hub_cabinets_desc",
    accent: TILE_ACCENTS.slate,
    scene: "cabinets",
  },
  {
    id: "economy",
    to: "/indicators/economy",
    titleKey: "indicators_nav_economy",
    descKey: "indicators_hub_economy_desc",
    accent: TILE_ACCENTS.emerald,
    scene: "economy",
  },
  {
    id: "fiscal",
    to: "/indicators/fiscal",
    titleKey: "indicators_nav_fiscal",
    descKey: "indicators_hub_fiscal_desc",
    accent: TILE_ACCENTS.brass,
    scene: "fiscal",
  },
  {
    id: "budgets",
    to: "/indicators/budgets",
    titleKey: "indicators_nav_budgets",
    descKey: "indicators_hub_budgets_desc",
    accent: TILE_ACCENTS.clay,
    scene: "budgets",
  },
  {
    id: "governance",
    to: "/indicators/governance",
    titleKey: "indicators_nav_governance",
    descKey: "indicators_hub_governance_desc",
    accent: TILE_ACCENTS.steel,
    scene: "governance",
  },
  {
    id: "society",
    to: "/indicators/society",
    titleKey: "indicators_nav_society",
    descKey: "indicators_hub_society_desc",
    accent: TILE_ACCENTS.rose,
    scene: "society",
  },
  {
    id: "compare",
    to: "/indicators/compare",
    titleKey: "eu_compare_menu_label",
    descKey: "indicators_hub_compare_desc",
    accent: TILE_ACCENTS.azure,
    scene: "compare",
  },
] as const;

// `macro.fetchedAt` is a real INSTANT ("2026-08-18T15:12:51.726Z"), so the reader's own zone
// is the right answer for it and formatDate leaves it there — the UTC pin in that helper is
// scoped to the date-only shape. Routed through the helper anyway so that a source which
// later publishes a bare day cannot silently start rendering a day early here.
const localDateFromIso = (
  iso: string | undefined,
  lang: "bg" | "en",
): string | null => {
  if (!iso) return null;
  if (Number.isNaN(new Date(iso).getTime())) return null;
  return formatDate(iso, lang);
};

export const IndicatorsLandingScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  // URL search string — appended to the hub-tile hrefs so the cabinet anchor
  // (?cabinet=) and election (?elections=) survive the section change.
  const { search } = useLocation();
  const { data: macro, isPending } = useMacro();
  const { data: peers } = useMacroPeers();
  const asOf = useElectionAsOf();

  // ⚠️ RESOLVED WITH THE TILES' OWN HELPERS — `pickAtOrBefore` against `useElectionAsOf`,
  // formatted by the registry's per-indicator `format` and by KpiTile's `formatPeriod`. The
  // band and the grid show the same indicators as of the same snapshot, so anything the
  // band computed for itself would be a second opinion about one number.
  const bandPoints = useMemo(() => {
    const out: Partial<
      Record<(typeof BAND_INDICATORS)[number], IndicatorPoint>
    > = {};
    if (!macro) return out;
    for (const key of BAND_INDICATORS) {
      const entry = KPI_REGISTRY[key];
      const meta = macro.indicators[key];
      const point = pickAtOrBefore(macro.series[key], asOf ?? null);
      // A series with no point at or before the selected election is WITHHELD, not zeroed —
      // the early elections predate several of these.
      if (!entry || !meta || !point) continue;
      out[key] = {
        value: point.value,
        display: entry.format(point.value),
        period: point.period,
        periodLabel: formatPeriod(
          point.period,
          point.year,
          point.quarter,
          lang,
        ),
        // The unit from the PAYLOAD, never written down: a hand-typed one goes stale the
        // day Eurostat re-bases a series.
        unitLabel: lang === "bg" ? meta.unitLabelBg : meta.unitLabelEn,
        title: lang === "bg" ? meta.titleBg : meta.titleEn,
        // ⚠️ THROUGH `DOMAIN_PATHS` AND THE REGISTRY'S OWN `anchor`, never re-derived. A
        // template of `/indicators/${entry.domain}` restates the map and silently drops the
        // per-indicator anchor some entries carry — and that matters MORE here than on a
        // tile, because a promoted indicator has no grid tile any more, so this cell is its
        // only link.
        //
        // ⚠️ THE ANCHOR ARM IS UNREACHABLE TODAY and no test covers it — only `euFunds` and
        // `municipalCommitments` carry an `anchor`, and neither is in BAND_INDICATORS. It is
        // written for the day one is promoted rather than left to be rediscovered then; the
        // missing test is a fact about the registry, not an oversight.
        to: `${DOMAIN_PATHS[entry.domain]}${search}${entry.anchor ? `#${entry.anchor}` : ""}`,
      };
    }
    return out;
  }, [macro, asOf, lang, search]);

  const kpis = useMemo(() => indicatorsHubKpis(bandPoints), [bandPoints]);

  // ⚠️ THE DISTRIBUTION'S PERIOD MUST MATCH THE CELL'S, and `KpiTile` guards the same thing
  // for its rank badge. The peers payload and the macro payload are separate fetches with
  // separate vintages, so a Q1 field can sit beside a Q2 value — and ranking this quarter's
  // figure in last quarter's field is a claim nobody made. A row whose periods disagree is
  // DROPPED rather than shown with a caveat: a five-word basis cannot carry „this one is a
  // quarter behind" per row.
  const peerRanks = useMemo(() => {
    const out: PeerRank[] = [];
    for (const key of BAND_INDICATORS) {
      const point = bandPoints[key];
      const dist = peers?.indicators?.[key]?.latestDistribution;
      const entry = KPI_REGISTRY[key];
      if (!point || !dist || !entry) continue;
      if (dist.period !== point.period) continue;
      if (!dist.rank || !dist.total) continue;
      out.push({
        indicatorKey: key,
        title: point.title,
        rank: dist.rank,
        total: dist.total,
        to: point.to,
      });
    }
    return out;
  }, [bandPoints, peers]);

  const evidence = useMemo(
    () => indicatorsHubEvidence(peerRanks, t),
    [peerRanks, t],
  );
  // DERIVED from the cells that rendered — a withheld cell must not also blank its grid
  // tile, which would drop the indicator off the page entirely.
  const promoted = useMemo(() => promotedIndicators(kpis), [kpis]);
  const fetchedDate = localDateFromIso(macro?.fetchedAt, lang);

  const hubTiles: InfographicTileProps[] = HUB_TILES.map((tile) => ({
    to: `${tile.to}${search}${"hash" in tile ? tile.hash : ""}`,
    title: t(tile.titleKey),
    desc: t(tile.descKey),
    accent: tile.accent,
    scene: INDICATOR_SCENES[tile.scene],
  }));
  const hubSection: TileHubSection = {
    heading: t("indicators_hub_explore"),
    tiles: hubTiles,
  };

  return (
    <div className="pb-12">
      <GovernanceBreadcrumb
        sectionKey="gov_hub_indicators_title"
        sectionTo="/indicators"
        className="mt-5"
      />

      <HubHead
        eyebrow={t("indicators_head_eyebrow")}
        title={t("indicators_head_title")}
        seoDescription={t("indicators_page_description")}
        deck={t("indicators_head_deck")}
        kpis={kpis}
        // Four cells, and only while the payload is genuinely IN FLIGHT. `!macro` would be
        // a tautology against a band that is empty iff `!macro`.
        kpisPending={isPending ? 4 : undefined}
        kpiNote={indicatorsKpiNote(kpis, t)}
        evidence={evidence}
      />

      <section
        aria-label={t("indicators_landing_kpi_grid_aria")}
        className="mb-8"
        data-og="indicators-kpi-grid"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {/* §3.1 rule 5 — a figure is the band's OR the grid's, never both. The four the
              head promoted leave the grid; the other eight stay. */}
          {LANDING_KPI_ORDER.filter((key) => !promoted.has(key)).map((key) => (
            <KpiTile key={key} indicatorKey={key} />
          ))}
        </div>
      </section>

      <div data-og="indicators-hub">
        <TileHubGrid sections={[hubSection]} />
      </div>

      <p className="text-[11px] text-muted-foreground mt-8">
        {t("governments_source_prefix")}{" "}
        <a
          href="https://ec.europa.eu/eurostat/databrowser/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          Eurostat
        </a>
        {" · "}
        <a
          href="https://databank.worldbank.org/source/worldwide-governance-indicators"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          World Bank WGI
        </a>
        {" · "}
        <a
          href="https://www.transparency.org/en/cpi"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          Transparency International CPI
        </a>
        {" · "}
        <a
          href="https://europa.eu/eurobarometer/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          {lang === "bg" ? "Евробарометър" : "Eurobarometer"}
        </a>
        {fetchedDate ? (
          <>
            {" · "}
            {t("indicators_landing_as_of")} {fetchedDate}
          </>
        ) : null}
      </p>
    </div>
  );
};
