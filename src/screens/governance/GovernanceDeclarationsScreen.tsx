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
//   /mp-assets and /mp-cars ARE SCOPED BY `?pscope`, THE SHARED PARAM THIS PAGE READS —
//   the same value, through the same `useMpAssetsScope`, so those two tiles and the pages
//   they open cannot show different windows. Measured on the committed blob: the 52nd is
//   240 MPs and 42 cars, the roll-up 2,122 and 643. Either number is defensible; the tile
//   and its destination must not each pick a different one.
//
//   Until 2026-08-26 the scope was `?elections` plus a local `useState` on each screen, so
//   the hub could offer no all-time view and the destinations reset to their own default on
//   arrival — a reader who widened one and followed a link silently got the other's window.
//
// The other four are lifetime by nature — /persons, /officials/assets and /mp/companies
// have no election scope at all.
// ===========================================================================

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { HubHead, TileHubGrid, TileHubSection } from "@/ux/infographic";
import { DeclarationsBreadcrumb } from "@/screens/components/DeclarationsBreadcrumb";
import { useDeclarationsHubStats } from "@/data/governance/useDeclarationsHubStats";
import { HubSearch } from "@/ux/search/HubSearch";
import { declarationsSearchSources } from "./declarationsSearch";
import { ScopeControl } from "@/screens/components/ScopeControl";
import { useMpAssetsScope } from "@/screens/utils/mpAssetsScope";
import {
  declarationsHubKpis,
  declarationsKpiNote,
  promotedTiles,
  tileFigures,
  type TileFigures,
} from "./declarationsHubFigures";
import { DECLARATION_BANDS, DECLARATION_TILES } from "./declarationsRegistry";
import { DECLARATION_SCENES } from "./declarationsScenes";

export const GovernanceDeclarationsScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const { stats, nsStats, bucket, pending } = useDeclarationsHubStats();
  // The RESOLVED scope, handed to the control so the pill and the figures are one
  // value. Left uncontrolled it re-reads `?pscope` against the full corpus band and
  // paints a year this register has no slice for — see `useMpAssetsScope`.
  const { pscope, setPscope } = useMpAssetsScope();
  // Stable identity: the sources close over nothing that changes, and a new array on every
  // render would re-issue every fetch.
  const searchSources = useMemo(
    () => declarationsSearchSources(i18n.language === "bg"),
    [i18n.language],
  );

  const nf = useMemo(
    () => new Intl.NumberFormat(i18n.language === "bg" ? "bg-BG" : "en-GB"),
    [i18n.language],
  );

  // One entry per tile id. Absent when the blob has not been generated — the tiles then
  // render exactly as they did before, without numbers, rather than with zeroes.
  const metrics = useMemo<Record<string, TileFigures>>(() => {
    if (!stats) return {};
    const out: Record<string, TileFigures> = {
      persons: {
        metric: nf.format(stats.people),
        caption: t("decl_kpi_people"),
        // NO `secondary` sentence. This tile's band cell always renders when `stats`
        // does, so the tile is always demoted and the sentence was unreachable — only
        // the bare value it falls back to is ever printed.
        secondaryValue: nf.format(stats.peopleWithDeclaration),
      },
      officials: {
        metric: nf.format(stats.officials),
        caption: t("decl_kpi_officials"),
      },
    };

    // ⚠️ OMITTED AT ZERO, never rendered as „0 организации". The generator ships 0 when
    // company_browse_table (188) is absent or unbuilt — a state its own warning calls "ships
    // without a figure" — and a tile printing that zero would turn "we have not built this
    // yet" into "no office-holder is attached to any organisation", about every named person
    // at once. Same rule the per-parliament tiles below already follow for an empty slice.
    if (stats.organisations > 0) {
      out.companies = {
        metric: nf.format(stats.organisations),
        caption: t("decl_kpi_companies"),
        // NO `secondary` sentence, for the reason `persons` has none: this tile and its
        // band cell share ONE condition (`organisations > 0`), so the tile exists only
        // when the cell rendered and is therefore always demoted. Only the bare value it
        // falls back to is ever printed.
        secondaryValue: nf.format(stats.organisationPeople),
      };
    }

    // The two PER-PARLIAMENT tiles. Absent when the selected election's parliament has no
    // registry rows — the 39th has 124 members with a filing and no cars at all — and an
    // absent slice must leave the tile bare rather than print 0.
    if (nsStats) {
      out.assets = {
        metric: nf.format(nsStats.mpsWithAssets),
        caption: t("decl_kpi_mps"),
        // The all-time figure, which is what stops the SCOPED headline being read as the
        // whole registry — and names the scope the destination will open in.
        //
        // ⚠️ DROPPED WHEN THE BUCKET READ IS THE ROLL-UP, where the headline IS that figure: „2 122 · от 2 122 за
        // всички парламенти" is the same number printed twice on one tile, which reads as
        // two facts. The cars tile keeps its secondary because owners (360) is a different
        // quantity from cars (643) at every scope.
        ...(bucket === "all"
          ? {}
          : {
              // ⚠️ NO `?? nsStats.mpsWithAssets` FALLBACK. With the roll-up absent that
              // prints THIS parliament's 240 under „депутати за всички парламенти",
              // directly below a band cell reading „240 · този парламент" — the same
              // number twice, one of them under a false label. An absent roll-up leaves
              // the tile bare, which is the rule the slice above already follows.
              ...(stats.byNs.all
                ? { secondaryValue: nf.format(stats.byNs.all.mpsWithAssets) }
                : {}),
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
  }, [stats, nsStats, nf, t, bucket]);

  const kpis = useMemo(
    () => declarationsHubKpis(stats, nsStats, bucket, (n) => nf.format(n), t),
    [stats, nsStats, bucket, nf, t],
  );
  // DERIVED from the cells that actually rendered — see `promotedTiles`. A compile-time
  // list would blank a tile whose band cell was withheld, deleting the figure outright.
  const promoted = useMemo(() => promotedTiles(kpis), [kpis]);

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
              // §3.1 rule 5 — a figure is the band's OR the tile's, never both. The
              // TILE is demoted, not the band cell dropped: a demoted tile keeps its
              // OTHER figure (persons → those with a filing, companies → the people
              // behind them, assets → the all-parliaments count), so promoting a
              // number never removes one from the page.
              ...tileFigures(metrics[id], promoted.has(id), id, t),
            },
          ];
        }),
      })).filter((section) => section.tiles.length > 0),
    [t, byId, metrics, promoted],
  );

  return (
    <>
      <DeclarationsBreadcrumb className="mt-5" />

      <HubHead
        eyebrow={t("decl_head_eyebrow")}
        title={t("decl_head_title")}
        seoDescription={
          t("declarations_hub_seo_description") ||
          "Asset and interest declarations of MPs and public officials — connections, assets, cars, companies and net-worth rankings from the Court of Audit register."
        }
        deck={t("decl_head_deck")}
        kpis={kpis}
        // Four cells, and only while the request is genuinely IN FLIGHT.
        //
        // ⚠️ `pending`, NEVER `!stats`. A 404 is an answer here — the hook renders the
        // tiles bare on a checkout with no generated blob — and it leaves `stats`
        // undefined exactly as a request in flight does, so `!stats` is a tautology
        // against a band that is empty iff `!stats`: 12 pulse nodes, for ever, on any
        // hosting deploy that lands before the bucket sync.
        kpisPending={pending ? 4 : undefined}
        kpiNote={declarationsKpiNote(kpis, t)}
        scope={
          /* ⚠️ TWO SCOPES, NOT THE SHARED THREE. This register is sliced by PARLIAMENT, so
             `years: []` — 2024 held two parliaments and `y:2024` names no single slice,
             which `resolveScope` sends back to `ns` rather than rendering an arbitrary one.

             It drives `/mp-assets` and `/mp-cars` through the SAME `?pscope`, and it is
             handed the RESOLVED value so the pill and the figures are one value. */
          <ScopeControl
            years={[]}
            allowAll
            value={pscope}
            onChange={setPscope}
            nsLabelOverride={t("decl_scope_ns")}
            // `yearsLabelOverride` is the PROP's name, not this register's dimension:
            // it has no year slices at all, which is why the default „Години" had to go.
            yearsLabelOverride={t("decl_scope_all")}
          />
        }
        search={
          /* The fastest route to a destination; the tiles are the slow one. A reader who
             already knows the name should not have to guess which of eight tiles holds it. */
          <HubSearch
            sources={searchSources}
            idPrefix="decl-search"
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
        }
      />

      <div data-og="declarations-hub">
        <TileHubGrid sections={sections} className="mt-4 sm:mt-6" />
      </div>
    </>
  );
};
