// /water — the Води (water sector) dashboard. Per docs/plans/water-view-v1.md
// §0b.4 this is the PRIMARY surface (the awarder pack on /awarder/206086428 is
// the "money half"). Phase 1 (Tier-A) shows what the existing procurement corpus
// already knows — the consolidated water SECTOR and its by-function spend —
// scope-aware via the shared ?pscope control. The КЕВР loss/tariff choropleths,
// NSI rationing series and the flood-risk feature (§4.5) arrive in later phases.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { AwarderLink } from "@/screens/components/procurement/AwarderLink";
import { ArrowRight } from "lucide-react";
import { Title } from "@/ux/Title";
import { SectorBreadcrumb } from "@/screens/components/procurement/SectorBreadcrumb";
import { ScopeControl } from "@/screens/components/ScopeControl";
import { useWaterSector, useVikFunds } from "@/data/procurement/useVik";
import { useWaterOperatorMap } from "@/data/water/useWaterOperatorMap";
import { WaterOperatorMap } from "./WaterOperatorMap";
import { VIK_HOLDING_EIK } from "@/lib/vikReferenceData";
import { VikSubsidiaryTile } from "@/screens/components/procurement/vik/VikSubsidiaryTile";
import { VikCategoryTile } from "@/screens/components/procurement/vik/VikCategoryTile";
import { VikEuFundsTile } from "@/screens/components/procurement/vik/VikEuFundsTile";
import { VikContractorHhiTile } from "@/screens/components/procurement/vik/VikContractorHhiTile";
import { VikCompetitionTile } from "@/screens/components/procurement/vik/VikCompetitionTile";
import { WaterFloodTile } from "./WaterFloodTile";
import { WaterStatsTile } from "./WaterStatsTile";
import { WaterSearchBox } from "./WaterSearchBox";

export const WaterScreen: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  // The whole sector, not the holding group — the map and the finder above
  // already show every operator, so tiles counting a narrower set would make one
  // page report two different totals. /awarder/206086428 keeps the group view.
  const { model, operators, groupEiks, isLoading } = useWaterSector();
  const { funds } = useVikFunds(groupEiks);
  const { operators: mapOperators } = useWaterOperatorMap();

  return (
    <div className="space-y-4">
      <Title
        description={
          bg
            ? "Обществените поръчки на водния сектор — консолидиран изглед по всички оператори: регионалните ВиК дружества, общинските, концесията за София, Напоителни системи и язовирите."
            : "Public procurement of the water sector — consolidated across every operator: the regional water companies, the municipal ones, the Sofia concession, the irrigation enterprise and the dams."
        }
      >
        {bg ? "Води (ВиК)" : "Water (ВиК)"}
      </Title>

      {/* Water is a sector dashboard like /judiciary and /culture: the
          hierarchy breadcrumb (up to the sectors hub) replaces the old sibling-
          enumeration strip, and it keeps just the shared scope control — not the
          corpus-wide procurement nav. */}
      <SectorBreadcrumb currentKey="procurement_water_nav" />

      <p className="max-w-3xl text-sm text-muted-foreground">
        {bg
          ? "Почти всяка област има свое регионално ВиК дружество; София се обслужва от концесия, а в Пазарджик регионалното дружество е в ликвидация и услугата е разпределена между общински оператори. Български ВиК холдинг е принципал на повечето регионални дружества, но централата почти не купува — поръчките са в самите оператори. Тук ги виждаме заедно."
          : "Almost every province has its own regional water company; Sofia is served by a concession, and in Pazardzhik the regional company is in liquidation with the service split across municipal operators. The Bulgarian Water Holding is the principal of most of the regional companies, but the parent buys almost nothing — the procurement is in the operators themselves. Here we see them together."}
      </p>

      <div className="mb-3">
        <ScopeControl mode="toggle" />
      </div>

      {/* The operator finder, above the map. The operators otherwise appear
          only as map pins and inside the subsidiary tile. */}
      <WaterSearchBox />

      {/* The regional operator map — the sector's signature visual, above the
          consolidated-group tiles. Renders nothing until the operators geo-resolve. */}
      <WaterOperatorMap operators={mapOperators} />

      {isLoading ? (
        <div className="h-[280px] animate-pulse rounded-xl border bg-card" />
      ) : model && model.totalEur > 0 ? (
        <div className="space-y-4">
          <VikSubsidiaryTile operators={operators} universeEiks={groupEiks} />
          <VikEuFundsTile funds={funds} />
          <VikCategoryTile
            categories={model.categories}
            totalEur={model.totalEur}
          />
          <VikContractorHhiTile
            suppliers={model.suppliers}
            totalEur={model.totalEur}
          />
          <VikCompetitionTile operators={operators} />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {bg
            ? "Няма договори в избрания обхват."
            : "No contracts in the selected scope."}
        </p>
      )}

      {/* Corpus-wide (not the ВиК group) — always rendered, independent of the
          group's contracts (FINDING-004). WaterStatsTile is national whole-history
          НСИ data; WaterFloodTile scopes its own figures to ?pscope client-side. */}
      <WaterStatsTile />
      <WaterFloodTile />

      <div className="flex flex-wrap gap-3 pt-1 text-sm">
        <Link
          to="/water/operators"
          className="inline-flex items-center gap-1 text-primary hover:underline"
        >
          {bg ? "Всички ВиК оператори" : "All water operators"}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
        <AwarderLink
          eik={VIK_HOLDING_EIK}
          className="inline-flex items-center gap-1 text-primary hover:underline"
        >
          {bg ? "Български ВиК холдинг" : "Bulgarian Water Holding"}
          <ArrowRight className="h-3.5 w-3.5" />
        </AwarderLink>
        <Link
          to="/procurement/contracts?sector=water"
          className="inline-flex items-center gap-1 text-primary hover:underline"
        >
          {bg ? "Всички договори на сектора" : "All water-sector contracts"}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
};
