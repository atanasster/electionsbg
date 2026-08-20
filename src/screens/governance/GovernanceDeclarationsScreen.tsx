// /governance/declarations — the "Декларации" sub-hub.
//
// A single entry point to the asset/interest-declaration surfaces: the person browser, the
// officials and MP wealth rankings, MP cars, MP-connected companies and the connections
// graph. Layout from the reusable infographic tile-hub kit; breadcrumb from
// DeclarationsBreadcrumb.
//
// ===========================================================================
// EVERY FIGURE HERE QUOTES ITS DESTINATION'S BASIS, AND FIVE OF SIX ARE NOT count(*) ON
// THE TILE'S TABLE. The generator's header carries the measurements and the four grains
// the first draft of this page got wrong; what matters HERE is the last of them:
//
//   /mp-assets and /mp-cars OPEN SCOPED TO THE SELECTED ELECTION (`scope = "ns"`), and
//   this tile carries `?elections` forward — so those two tiles read the per-parliament
//   slice, not the lifetime roll-up. The 52nd is 240 MPs and 65 cars; the roll-up is
//   2,122 and 621. Either number is defensible; only one of them is the page's.
//
// The other four are lifetime by nature — /persons, /officials/assets and /mp/companies
// have no election scope at all.
// ===========================================================================

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { TileHubGrid, TileHubSection } from "@/ux/infographic";
import { DeclarationsBreadcrumb } from "@/screens/components/DeclarationsBreadcrumb";
import { useDeclarationsHubStats } from "@/data/governance/useDeclarationsHubStats";
import { HubSearch } from "@/ux/search/HubSearch";
import { declarationsSearchSources } from "./declarationsSearch";
import { DECLARATION_BANDS, DECLARATION_TILES } from "./declarationsRegistry";
import { DECLARATION_SCENES } from "./declarationsScenes";

export const GovernanceDeclarationsScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const { stats, nsStats } = useDeclarationsHubStats();
  // Stable identity: the sources close over nothing that changes, and a new array on every
  // render would re-issue every fetch.
  const searchSources = useMemo(
    () => declarationsSearchSources(i18n.language === "bg"),
    [i18n.language],
  );
  const title = t("menu_group_declarations") || "Declarations";

  const nf = useMemo(
    () => new Intl.NumberFormat(i18n.language === "bg" ? "bg-BG" : "en-GB"),
    [i18n.language],
  );

  // One entry per tile id. Absent when the blob has not been generated — the tiles then
  // render exactly as they did before, without numbers, rather than with zeroes.
  const metrics = useMemo<
    Record<string, { metric: string; caption: string; secondary?: string }>
  >(() => {
    if (!stats) return {};
    const out: Record<
      string,
      { metric: string; caption: string; secondary?: string }
    > = {
      persons: {
        metric: nf.format(stats.people),
        caption: t("decl_kpi_people"),
        // nf.format on BOTH lines. i18next interpolates a raw number verbatim, so the
        // headline read „62 050" and the line under it „19513" — same tile, two number
        // formats. `count` still carries the numeric value so plural rules keep working.
        secondary: t("decl_kpi_people_secondary", {
          count: stats.peopleWithDeclaration,
          n: nf.format(stats.peopleWithDeclaration),
        }),
      },
      officials: {
        metric: nf.format(stats.officials),
        caption: t("decl_kpi_officials"),
      },
    };

    // ⚠️ OMITTED AT ZERO, never rendered as „0 организации". The generator ships 0 when
    // official_companies (178) is absent or unbuilt — a state its own warning calls "ships
    // without a figure" — and a tile printing that zero would turn "we have not built this
    // yet" into "no office-holder is attached to any organisation", about every named person
    // at once. Same rule the per-parliament tiles below already follow for an empty slice.
    if (stats.organisations > 0) {
      out.companies = {
        metric: nf.format(stats.organisations),
        caption: t("decl_kpi_companies"),
        // The people attached to them. „17 608" alone reads as a corpus size; paired with
        // the people it is a statement about public life. NOT „MPs" any more — the
        // destination covers every tier and they are a minority of it.
        secondary: t("decl_kpi_companies_secondary", {
          count: stats.organisationPeople,
          n: nf.format(stats.organisationPeople),
        }),
      };
    }

    // The two PER-PARLIAMENT tiles. Absent when the selected election's parliament has no
    // registry rows — the 39th has 124 members with a filing and no cars at all — and an
    // absent slice must leave the tile bare rather than print 0.
    if (nsStats) {
      out.assets = {
        metric: nf.format(nsStats.mpsWithAssets),
        caption: t("decl_kpi_mps"),
        // The all-time figure, which is what stops the scoped headline being read as the
        // whole registry — and names the scope the destination will open in.
        secondary: t("decl_kpi_assets_secondary", {
          count: stats.byNs.all?.mpsWithAssets ?? nsStats.mpsWithAssets,
          n: nf.format(stats.byNs.all?.mpsWithAssets ?? nsStats.mpsWithAssets),
        }),
      };
      out.cars = {
        metric: nf.format(nsStats.cars),
        caption: t("decl_kpi_cars"),
        // The OWNERS. A car count alone reads as a headcount in a chamber of 240.
        secondary: t("decl_kpi_cars_secondary", {
          count: nsStats.carOwners,
          n: nf.format(nsStats.carOwners),
        }),
      };
    }
    // NO figure on Връзки, deliberately. The graph draws a 150-of-1,823 company sample, so
    // any count on that tile is either the sample (understating the register) or the
    // register (overstating what the page draws). The page states both itself.
    return out;
  }, [stats, nsStats, nf, t]);

  const byId = useMemo(
    () => new Map(DECLARATION_TILES.map((tile) => [tile.id, tile])),
    [],
  );

  const sections: TileHubSection[] = useMemo(
    () =>
      DECLARATION_BANDS.map((band) => ({
        heading: t(band.labelKey),
        description: t(band.descKey),
        tiles: band.tileIds.flatMap((id) => {
          const tile = byId.get(id);
          if (!tile) return [];
          return [
            {
              to: tile.to,
              title: t(tile.titleKey),
              desc: t(tile.descKey),
              accent: tile.accent,
              scene: DECLARATION_SCENES[tile.id],
              // NO `cta`. „разгледай →" on every tile restates an affordance the whole card
              // already has.
              ...(metrics[id]
                ? {
                    metric: metrics[id].metric,
                    metricCaption: metrics[id].caption,
                    ...(metrics[id].secondary
                      ? { metricSecondary: metrics[id].secondary }
                      : {}),
                  }
                : {}),
            },
          ];
        }),
      })).filter((section) => section.tiles.length > 0),
    [t, byId, metrics],
  );

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

      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        {t("decl_hub_intro")}
      </p>

      {/* Directly under the intro and ABOVE the first band: it is the fastest route to a
          destination and the tiles are the slow one. A reader who already knows the name
          should not have to guess which of six tiles contains it. */}
      <HubSearch
        sources={searchSources}
        idPrefix="decl-search"
        className="mt-4 max-w-2xl"
        title={{ bg: "Търсене на човек", en: "Find a person" }}
        placeholder={{
          bg: "име на депутат, министър, кмет…",
          en: "an MP, a minister, a mayor…",
        }}
        hint={{
          bg: "Хората в регистъра на Сметната палата — и тези без подадена декларация.",
          en: "People in the Court of Audit register — and those with no filing on record.",
        }}
      />

      <div data-og="declarations-hub">
        <TileHubGrid sections={sections} className="mt-4 sm:mt-6" />
      </div>
    </>
  );
};
