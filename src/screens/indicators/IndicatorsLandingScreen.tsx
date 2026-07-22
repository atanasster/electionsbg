// /indicators — the KPI dashboard front door, laid out as a tile hub (like
// /procurement). The headline KpiTile grid stays on top; below it a grid of large
// illustrated tiles fronts the sibling domain pages (Икономика / Фискални /
// Бюджети / Управление / Общество / Сравни), led by a "Сравнение на всички
// кабинети" tile that cross-links to /governments#cabinet-table — where the full
// per-cabinet timeline + sortable table live (so the landing keeps no chart of
// its own).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { Title } from "@/ux/Title";
import { useMacro } from "@/data/macro/useMacro";
import { KpiTile } from "@/screens/components/macro/KpiTile";
import {
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

const localDateFromIso = (
  iso: string | undefined,
  lang: "bg" | "en",
): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(lang === "bg" ? "bg-BG" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

export const IndicatorsLandingScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const { data: macro } = useMacro();
  // URL search string — appended to the hub-tile hrefs so the cabinet anchor
  // (?cabinet=) and election (?elections=) survive the section change.
  const { search } = useLocation();
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
      <Title description={t("indicators_page_description")}>
        {t("indicators_page_title")}
      </Title>
      <GovernanceBreadcrumb
        sectionKey="gov_hub_indicators_title"
        sectionTo="/indicators"
        className="mt-5 mb-6"
      />

      <section
        aria-label={t("indicators_landing_kpi_grid_aria")}
        className="mb-8"
        data-og="indicators-kpi-grid"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {LANDING_KPI_ORDER.map((key) => (
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
