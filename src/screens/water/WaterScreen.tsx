// /water — the Води (water sector) dashboard. Per docs/plans/water-view-v1.md
// §0b.4 this is the PRIMARY surface (the awarder pack on /awarder/206086428 is
// the "money half"). Phase 1 (Tier-A) shows what the existing procurement corpus
// already knows — the consolidated ВиК-холдинг group and its by-function spend —
// scope-aware via the shared ?pscope control. The КЕВР loss/tariff choropleths,
// NSI rationing series and the flood-risk feature (§4.5) arrive in later phases.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Title } from "@/ux/Title";
import { SectorBreadcrumb } from "@/screens/components/procurement/SectorBreadcrumb";
import { ProcurementScopeControl } from "@/screens/components/procurement/ProcurementScopeControl";
import { useVik, useVikFunds } from "@/data/procurement/useVik";
import { VIK_HOLDING_EIK } from "@/lib/vikReferenceData";
import { VikSubsidiaryTile } from "@/screens/components/procurement/vik/VikSubsidiaryTile";
import { VikCategoryTile } from "@/screens/components/procurement/vik/VikCategoryTile";
import { VikEuFundsTile } from "@/screens/components/procurement/vik/VikEuFundsTile";
import { VikContractorHhiTile } from "@/screens/components/procurement/vik/VikContractorHhiTile";
import { VikCompetitionTile } from "@/screens/components/procurement/vik/VikCompetitionTile";
import { WaterFloodTile } from "./WaterFloodTile";
import { WaterStatsTile } from "./WaterStatsTile";

export const WaterScreen: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const { model, operators, groupEiks, isLoading } = useVik(VIK_HOLDING_EIK);
  const { funds } = useVikFunds(groupEiks);

  return (
    <div className="space-y-4">
      <Title
        description={
          bg
            ? "Обществените поръчки на ВиК сектора — консолидиран изглед по дружествата в групата на Български ВиК холдинг."
            : "Public procurement of the water sector — consolidated across the Bulgarian Water Holding group."
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
          ? "Български ВиК холдинг е принципал на ~26 регионални ВиК дружества. Централата почти не купува — поръчките са в дружествата. Тук ги виждаме заедно."
          : "The Bulgarian Water Holding is the principal of ~26 regional water operators. The parent buys almost nothing — the procurement is in the operators. Here we see them together."}
      </p>

      <div className="mb-3">
        <ProcurementScopeControl mode="toggle" />
      </div>

      {isLoading ? (
        <div className="h-[280px] animate-pulse rounded-xl border bg-card" />
      ) : model && model.totalEur > 0 ? (
        <div className="space-y-4">
          <VikSubsidiaryTile operators={operators} />
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
        <Link
          to={`/awarder/${VIK_HOLDING_EIK}`}
          className="inline-flex items-center gap-1 text-primary hover:underline"
        >
          {bg ? "Български ВиК холдинг" : "Bulgarian Water Holding"}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
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
