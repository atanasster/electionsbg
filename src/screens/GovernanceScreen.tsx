// /governance — the Управление tile-hub (the view's front door).
//
// A short, curated list of SUB-HUBS (budget, procurement, EU funds, sectors,
// parliament, declarations, indicators + the national overview), each a
// plain-language tile that routes to a hub carrying its own shortcut tiles.
// Replaces the 18-leaf dropdown as the approachable entry point. Data from
// governanceRegistry; layout from the reusable infographic tile-hub kit. The
// former dashboard body now lives at /governance/overview (the "Национален
// преглед" tile), which stays the country node of the Governance place-view.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { TileHubGrid, TileHubSection } from "@/ux/infographic";
import { GOV_HUB_CLUSTERS } from "./governance/governanceRegistry";
import { GOV_HUB_SCENES } from "./governance/governanceScenes";

// Dev-time guard for the stringly-typed tile.id ↔ GOV_HUB_SCENES contract:
// a tile whose id has no scene key would silently render an empty vignette
// (GOV_HUB_SCENES[id] === undefined) rather than fail the build. Flag any such
// gap loudly in dev; compiled out of production.
if (import.meta.env.DEV) {
  const missing = GOV_HUB_CLUSTERS.flatMap((cluster) => cluster.tiles)
    .map((tile) => tile.id)
    .filter((id) => !GOV_HUB_SCENES[id]);
  if (missing.length) {
    console.error(
      `[governance hub] tile id(s) with no GOV_HUB_SCENES scene: ${missing.join(", ")}`,
    );
  }
}

export const GovernanceScreen: FC = () => {
  const { t } = useTranslation();
  const title = t("nav_governance") || "Governance";
  const cta = t("gov_hub_view") || "разгледай";

  const sections: TileHubSection[] = GOV_HUB_CLUSTERS.map((cluster) => ({
    heading: t(cluster.labelKey),
    tiles: cluster.tiles.map((tile) => ({
      to: tile.to,
      title: t(tile.titleKey),
      desc: t(tile.descKey),
      accent: tile.accent,
      scene: GOV_HUB_SCENES[tile.id],
      cta,
    })),
  }));

  return (
    <>
      <Title
        description={
          t("governance_hub_seo_description") ||
          "Where public money goes and how power is held to account in Bulgaria — budget, procurement, EU funds, sectors, parliament, declarations and indicators, in one place."
        }
      >
        {title}
      </Title>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        {t("gov_hub_intro") ||
          "Публичните пари, парламентът и отчетността на властта — на едно място."}
      </p>

      <div data-og="governance-hub">
        <TileHubGrid sections={sections} className="mt-4 sm:mt-6" />
      </div>
    </>
  );
};
