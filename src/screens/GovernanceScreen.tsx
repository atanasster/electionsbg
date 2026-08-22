// /governance — the Управление tile-hub (the view's front door).
//
// A short, curated list of SUB-HUBS (budget, procurement, EU funds, sectors,
// parliament, declarations, indicators + the national overview), each a
// plain-language tile that routes to a hub carrying its own shortcut tiles.
// Replaces the 18-leaf dropdown as the approachable entry point. Data from
// governanceRegistry; layout from the reusable infographic tile-hub kit. The
// former dashboard body now lives at /governance/overview (the "Национален
// преглед" tile), which stays the country node of the Governance place-view.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { TileHubGrid, TileHubSection, HubHead, HubKpi } from "@/ux/infographic";
import { GOV_HUB_CLUSTERS } from "./governance/governanceRegistry";
import { GOV_HUB_SCENES } from "./governance/governanceScenes";
import { useProcurementHubStats } from "@/data/procurement/useProcurementHubStats";
import { useDeclarationsHubStats } from "@/data/governance/useDeclarationsHubStats";
import { formatEurCompact } from "@/lib/currency";
import { SCOPE_FIRST_YEAR } from "@/data/scope/constants";

// Dev-time guard for the stringly-typed tile.id ↔ GOV_HUB_SCENES contract. A tile whose
// id has no scene key does NOT degrade to an empty vignette — InfographicTile renders
// `<Scene />` unguarded, so `undefined` as a component type throws "Element type is
// invalid" and white-screens the whole route. This flags it loudly in dev; the real gate
// is hubRegistry.test.ts, which covers this hub AND the declarations sub-hub at commit
// time. Compiled out of production.
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
  const { t, i18n } = useTranslation();
  const title = t("nav_governance") || "Governance";
  const bg = i18n.language === "bg";
  const numFmt = useMemo(
    () => new Intl.NumberFormat(bg ? "bg-BG" : "en-GB"),
    [bg],
  );

  // ⚠ NOTHING here may import a REGISTRY. A „Държавни сектори 19" row was drafted with the
  // count derived from SECTORS (sectorRegistry) — correct as a figure, and it pulled that
  // registry's whole reference-data closure into this route's static graph. Caught by
  // scripts/i18n/bundle_reachability.test.ts, which is the same class src/entryGraph.test.ts
  // exists for: take a constant from an import-free module, never from a registry.
  //
  // PREVIEW (docs/plans/hub-hero-v1.md §9). The SHIPPED version reads ONE blob,
  // data/governance/hub_stats.json (db:gen-governance-hub-stats) — this page makes zero
  // page-specific fetches today and must stay at exactly one. These two hooks stand in for
  // it so the layout can be judged against real numbers; they are the two blobs that blob
  // would replace, and folding four of them client-side is precisely the option §9.4 rules
  // out.
  // ⚠ "all", EXPLICITLY. This hub has no ?pscope, so the default resolves to the selected
  // parliament and the band would publish €3,3 млрд. under the corpus caption.
  const procurement = useProcurementHubStats("all");
  const { stats: declarations } = useDeclarationsHubStats();

  const corpusYears = `${SCOPE_FIRST_YEAR}–${new Date().getFullYear()}`;

  // Declared as (HubKpi | undefined)[] rather than filtered with `as HubKpi[]`: the cast was
  // load-bearing — `procurement && {…}` yields undefined — so it silently erased the null
  // check from the type system, and a future falsy-but-wrong element would still compile.
  const kpiCandidates: (HubKpi | undefined)[] = [
    procurement && {
      // ⚠ Corpus-wide, and the tile links with ?pscope=all so the destination agrees. Quoting
      // the corpus while linking to /procurement's own default (this parliament, €3.3bn) is
      // §0's "destination counts a different set", guaranteed rather than possible.
      value: formatEurCompact(procurement.totalEur, i18n.language),
      label: bg ? "обществени поръчки" : "public procurement",
      // ⚠ DERIVED, never a literal — this said „2007–2026" against a corpus that starts
      // 2011-01-03 with zero rows before it. See ProcurementScreen for the full note.
      basis: bg ? `договори ${corpusYears}` : `contracts ${corpusYears}`,
      to: "/procurement/contracts?pscope=all",
    },
    procurement && {
      value: numFmt.format(procurement.contractors),
      label: bg ? "изпълнители" : "suppliers",
      basis: bg ? "фирми с договор" : "firms with a contract",
      to: "/procurement/contractors?pscope=all",
    },
    declarations && {
      value: numFmt.format(declarations.people),
      label: bg ? "души в публичния регистър" : "people in the public register",
      basis: bg ? "депутати, магистрати, кметове" : "MPs, judges, mayors",
      to: "/persons",
    },
    declarations && {
      value: numFmt.format(declarations.organisations),
      label: bg ? "организации зад тях" : "organisations behind them",
      basis: bg ? "фирми, сдружения, читалища" : "firms, associations, clubs",
      to: "/governance/companies",
    },
  ];
  const kpis = kpiCandidates.filter((k): k is HubKpi => Boolean(k));

  const sections: TileHubSection[] = GOV_HUB_CLUSTERS.map((cluster) => ({
    heading: t(cluster.labelKey),
    // A heading is a label; this is the sentence that makes the hub a table of contents.
    // All four bands shipped without one.
    description: t(cluster.descKey),
    tiles: cluster.tiles.map((tile) => ({
      to: tile.to,
      title: t(tile.titleKey),
      desc: t(tile.descKey),
      accent: tile.accent,
      scene: GOV_HUB_SCENES[tile.id],
      // No per-tile CTA: the whole card is the link and already has a hover state, so
      // „разгледай →" was one affordance restated 23 times.
    })),
  }));

  return (
    <>
      <HubHead
        eyebrow={bg ? "Управление" : "Governance"}
        title={title}
        seoDescription={
          t("governance_hub_seo_description") ||
          "Where public money goes and how power is held to account in Bulgaria — budget, procurement, EU funds, sectors, parliament, declarations and indicators, in one place."
        }
        deck={
          t("gov_hub_intro") ||
          "Публичните пари, парламентът и отчетността на властта — на едно място."
        }
        kpis={kpis}
        kpiNote={kpis.length ? t("gov_hub_kpi_note") : undefined}
        evidence={
          procurement
            ? {
                // ⚠ The heading names the ROWS, and the rows are counts over the
                // procurement corpus — not money, and „Обжалвани поръчки" is not a *where*
                // at all. „Къде отиват парите" was the same defect this commit caught one
                // component over on /procurement's „Най-големи възложители".
                heading: bg
                  ? "Какво още показват поръчките"
                  : "What else the procurement data shows",
                rows: [
                  {
                    label: bg ? "Свързани с политици" : "Politically connected",
                    value: numFmt.format(procurement.connected),
                    to: "/procurement/mps?pscope=all",
                  },
                  {
                    label: bg
                      ? "Населени места с поръчки"
                      : "Places with contracts",
                    value: numFmt.format(procurement.places),
                    to: "/procurement/by-settlement?pscope=all",
                  },
                  {
                    label: bg ? "Обжалвани поръчки" : "Appealed procedures",
                    value: numFmt.format(procurement.appeals),
                    to: "/procurement/appeals?pscope=all",
                  },
                ],
              }
            : undefined
        }
      />

      <div data-og="governance-hub">
        <TileHubGrid sections={sections} className="mt-8" />
      </div>
    </>
  );
};
