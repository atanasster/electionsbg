// /governance/declarations — the "Декларации" sub-hub.
//
// A single entry point to the asset/interest-declaration surfaces: MP connections,
// MP assets & cars, MP-connected companies, and — newly surfaced — the officials
// asset ranking (ministers, mayors, governors). Replaces the MP-only dropdown
// cluster and makes the officials register reachable. Layout from the reusable
// infographic tile-hub kit; breadcrumb from DeclarationsBreadcrumb.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { TileHubGrid, TileHubSection } from "@/ux/infographic";
import { DeclarationsBreadcrumb } from "@/screens/components/DeclarationsBreadcrumb";
import { DECLARATION_TILES } from "./declarationsRegistry";
import { DECLARATION_SCENES } from "./declarationsScenes";

export const GovernanceDeclarationsScreen: FC = () => {
  const { t } = useTranslation();
  const title = t("menu_group_declarations") || "Declarations";
  const cta = t("gov_hub_view") || "разгледай";

  const sections: TileHubSection[] = [
    {
      heading: t("menu_group_declarations") || "Declarations",
      tiles: DECLARATION_TILES.map((tile) => ({
        to: tile.to,
        title: t(tile.titleKey),
        desc: t(tile.descKey),
        accent: tile.accent,
        scene: DECLARATION_SCENES[tile.id],
        cta,
      })),
    },
  ];

  return (
    <>
      <Title
        description={
          t("declarations_hub_seo_description") ||
          "Asset and interest declarations of MPs and public officials — connections, assets, cars, companies and net-worth rankings from the Court of Audit register."
        }
      >
        {title}
      </Title>
      <DeclarationsBreadcrumb className="mt-5" />

      <div data-og="declarations-hub">
        <TileHubGrid sections={sections} className="mt-4 sm:mt-6" />
      </div>
    </>
  );
};
