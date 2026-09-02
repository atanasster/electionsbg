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
import { isBg } from "@/i18n";
import { useTranslation } from "react-i18next";
import { TileHubGrid, TileHubSection, HubHead, HubKpi } from "@/ux/infographic";
import {
  GOV_HUB_CLUSTERS,
  BAND_TILES,
  BAND_TO,
} from "./governance/governanceRegistry";
import { GOV_HUB_SCENES } from "./governance/governanceScenes";
import { HubSearch } from "@/ux/search/HubSearch";
import { governanceSearchSources } from "./governance/governanceSearch";
import {
  useGovernanceHubStats,
  type GovTileStat,
} from "@/data/governance/useGovernanceHubStats";
import { formatEurCompact } from "@/lib/currency";
import { SCOPE_FIRST_YEAR } from "@/data/scope/constants";

// The four money taps, in the KPI band. Their tiles therefore carry NO metric: the band
// publishes those figures above the fold with a declared basis, and the same number twice on
// one page reads as two different facts (SKILL.md §3.1 rule 5).

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
  const bg = isBg(i18n.language);
  const numFmt = useMemo(
    () => new Intl.NumberFormat(bg ? "bg-BG" : "en-GB"),
    [bg],
  );

  // ⚠ NOTHING here may import a REGISTRY. A „Държавни сектори 19" row was drafted with the
  // count derived from SECTORS (sectorRegistry) — correct as a figure, and it pulled that
  // registry's whole reference-data closure into this route's static graph. Caught by
  // scripts/i18n/bundle_reachability.test.ts, the same class src/entryGraph.test.ts exists
  // for: take a constant from an import-free module, or from the blob you already fetch.
  //
  // ONE blob, one fetch (SKILL.md §3.1 rule 3). Every figure on this page — the four in the
  // band, the seven on tiles and the four coverage rows — comes from it, and every one of
  // them is the DESTINATION'S OWN number: the generator folds each sibling hub's serving
  // function, payload row or committed blob rather than re-aggregating, so no two hubs one
  // click apart can disagree. See scripts/db/gen_governance/hub_stats.ts.
  const { stats, tile } = useGovernanceHubStats();
  const searchSources = useMemo(() => governanceSearchSources(bg), [bg]);

  // ⚠ DERIVED, never a literal. This caption read „2007–2026" for one commit, against a
  // corpus whose first contract is 2011-01-03 and which holds zero rows before it.
  const corpusYears = `${SCOPE_FIRST_YEAR}–${new Date().getFullYear()}`;

  /** A stat's value, formatted for its own kind. */
  const statValue = (s: GovTileStat): string =>
    s.kind === "eur"
      ? formatEurCompact(s.value, i18n.language)
      : numFmt.format(s.value);

  /** The basis line: what window / denominator the figure is over, in the reader's words.
   *  `basis` arrives as an ENUM KEY so the blob carries no prose (§1). */
  const statBasis = (s: GovTileStat): string =>
    t(`gov_stat_${s.basis}`, {
      year: s.year,
      years: corpusYears,
      n: s.extra != null ? numFmt.format(s.extra) : "",
      // RAW, unlike `n`: a year through `numFmt` prints „2 025".
      basisYear: s.basisYear ?? "",
    });

  const kpiCandidates: (HubKpi | undefined)[] = BAND_TILES.map((id) => {
    const s = tile(id);
    return s
      ? {
          value: statValue(s),
          label: t(`gov_kpi_${id}`),
          basis: statBasis(s),
          to: BAND_TO[id],
        }
      : undefined;
  });
  const kpis = kpiCandidates.filter((k): k is HubKpi => Boolean(k));

  // The head's ranked list. Deliberately corpus SIZES rather than money: every money figure
  // on this page is already in the band above, and a list that restates it would be the same
  // number a third time.
  const coverageRows = (stats?.coverage ?? []).map((row) => ({
    label: t(`gov_cov_${row.id}`),
    value: numFmt.format(row.value),
    to: row.to,
  }));

  /** A tile's overlay figure — omitted for the four the band carries, and for any tile whose
   *  source did not answer (which renders descriptor-only, as the whole hub did before). */
  const tileMetric = (
    id: string,
  ): { metric?: string; metricCaption?: string } => {
    if ((BAND_TILES as readonly string[]).includes(id)) return {};
    const s = tile(id);
    return s ? { metric: statValue(s), metricCaption: statBasis(s) } : {};
  };

  const sections: TileHubSection[] = GOV_HUB_CLUSTERS.map((cluster) => ({
    heading: t(cluster.labelKey),
    // A heading is a label; this is the sentence that makes the hub a table of contents.
    // All four bands shipped without one.
    description: t(cluster.descKey),
    tiles: cluster.tiles.map((t2) => ({
      to: t2.to,
      title: t(t2.titleKey),
      desc: t(t2.descKey),
      accent: t2.accent,
      scene: GOV_HUB_SCENES[t2.id],
      // No per-tile CTA: the whole card is the link and already has a hover state, so
      // „разгледай →" was one affordance restated 23 times.
      ...tileMetric(t2.id),
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
        search={
          <HubSearch
            sources={searchSources}
            idPrefix="governance-search"
            title={{ bg: "Търсене в управлението", en: "Search governance" }}
            placeholder={{
              bg: "човек, институция или фирма…",
              en: "a person, an institution or a company…",
            }}
            hint={{
              bg: "Хора от публичния регистър, държавни възложители и фирми с договори.",
              en: "People in the public register, state buyers and companies with contracts.",
            }}
          />
        }
        kpis={kpis}
        kpiNote={kpis.length ? t("gov_hub_kpi_note") : undefined}
        evidence={
          coverageRows.length
            ? {
                heading: t("gov_hub_coverage_heading"),
                rows: coverageRows,
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
