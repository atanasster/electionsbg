// /my-area/:id — the personalized dashboard. ID resolves via useAreaResolver
// to one of: settlement (EKATTE 5-digit numeric), municipality (obshtina
// alphanumeric like SFO00), or unknown.
//
// Composition strategy: a thin "My-Area top strip" (hero + representatives +
// upcoming-ballot) above the existing canonical dashboard cards
// (SettlementDashboardCards for settlements, MunicipalityDashboardCards for
// municipalities). This reuses every existing tile — Mayor & council,
// budget transfers, EU funds, census, indicators, problem sections — and
// inherits ElectionContext cycle awareness for free.
//
// The MyArea top strip is where this route differentiates from the existing
// /settlement/:id and /municipality/:id routes: it's place-first, with
// representatives and the next-election calendar pinned at the top.

import { FC } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { SEO } from "@/ux/SEO";
import { H1 } from "@/ux/H1";
import { Card } from "@/components/ui/card";
import {
  useAreaResolver,
  type ResolvedArea,
} from "@/data/area/useAreaResolver";
import { useCycleKind } from "@/data/area/useCycleKind";
import { MyAreaHero } from "./MyAreaHero";
import { MyAreaRepresentativesStrip } from "./MyAreaRepresentativesStrip";
import { MyAreaUpcomingBallotTile } from "./MyAreaUpcomingBallotTile";
import { MyAreaKmetstvoTile } from "./MyAreaKmetstvoTile";
import { MunicipalMayorTile } from "@/screens/dashboard/MunicipalMayorTile";
import { MunicipalCouncilCompositionTile } from "@/screens/dashboard/MunicipalCouncilCompositionTile";
import { MunicipalOfficialsRosterTile } from "@/screens/dashboard/MunicipalOfficialsRosterTile";
import { Landmark } from "lucide-react";
import { Link } from "@/ux/Link";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { MyAreaTaxReceiptTile } from "./MyAreaTaxReceiptTile";
import { MyAreaTransparencyTile } from "./MyAreaTransparencyTile";
import { MyAreaSchoolsTile } from "./MyAreaSchoolsTile";
import { MyAreaServicesTile } from "./MyAreaServicesTile";
import { MyAreaAirTile } from "./MyAreaAirTile";
import { MyAreaCrimeTile } from "./MyAreaCrimeTile";
import { MyAreaProjectsMapTile } from "./MyAreaProjectsMapTile";
import { MyAreaAlertsTile } from "./MyAreaAlertsTile";
import { MyAreaSofiaRaionStrip } from "./MyAreaSofiaRaionStrip";
import { MyAreaContactsTile } from "./MyAreaContactsTile";
import { MyAreaCouncilMinutesTile } from "./MyAreaCouncilMinutesTile";

export const MyAreaScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const { id } = useParams<{ id: string }>();
  const area = useAreaResolver(id);
  const cycle = useCycleKind();

  // No need to mirror the path :id into `?area=` — AreaAnchorProvider now
  // reads from the path directly on the /my-area/<id> route. That removed
  // both the URL dupe (path + query carrying the same code) AND the race
  // where setAnchor(null) on the pill or popover got immediately re-set
  // here from the path. See AreaAnchorProvider for the precedence rules.

  if (!id) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        {t("my_area_no_id")}
      </div>
    );
  }

  if (!area) {
    // Resolution in flight — render an empty skeleton placeholder. We don't
    // pre-render a tile skeleton here because the resolved kind drives which
    // dashboard tile cluster to show.
    return (
      <section className="flex flex-col gap-3 my-4">
        <div className="h-32 rounded-xl border bg-card animate-pulse" />
        <div className="h-20 rounded-xl border bg-card animate-pulse" />
      </section>
    );
  }

  if (area.kind === "unknown") {
    return (
      <div className="p-6 text-center">
        <H1>{t("my_area_unknown_title")}</H1>
        <p className="text-muted-foreground mt-2">
          {t("my_area_unknown_description")}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          {t("my_area_unknown_id_label")}: <code>{id}</code>
        </p>
      </div>
    );
  }

  const seoTitle =
    area.kind === "settlement"
      ? `${t("my_area_dashboard")} — ${lang === "bg" ? area.settlement.name : area.settlement.name_en}`
      : `${t("my_area_dashboard")} — ${lang === "bg" ? area.municipality.name : area.municipality.name_en}`;

  // chmi banner: when the selected cycle is a partial local election, the
  // mayor card downstream may show a freshly elected replacement. Surface
  // that context above the dashboard so users don't miss the framing.
  const showChmiBanner = cycle.kind === "chmi";

  return (
    <>
      <SEO title={seoTitle} description={seoTitle} />
      <section
        aria-label={t("my_area_dashboard")}
        className="my-4 flex flex-col gap-3"
      >
        <MyAreaHero area={area} />

        {/* Sofia райони chip row — only renders for users in a Sofia
            район (obshtina S2xxx). Auto-hides everywhere else. Helps
            users jump between райони without bouncing through search. */}
        <MyAreaSofiaRaionStrip activeObshtina={area.obshtina} />

        {showChmiBanner ? (
          <Card className="p-3 border-amber-500/40 bg-amber-500/5 flex items-center gap-2">
            <AlertTriangle className="size-4 text-amber-500 shrink-0" />
            <p className="text-sm">
              {lang === "bg"
                ? `Частични избори за кмет — ${cycle.date}.`
                : `Partial mayoral election — ${cycle.date}.`}
            </p>
          </Card>
        ) : null}

        <div className="grid gap-3 grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <MyAreaRepresentativesStrip oblast={area.oblast} />
          <MyAreaUpcomingBallotTile />
        </div>

        {/* Kметство (sub-municipal village mayor) only renders when the
            resolved area is a settlement AND that settlement appears in the
            município's kmetstva[]. Auto-hides otherwise so most settlements
            don't see an empty tile. */}
        {area.kind === "settlement" ? (
          <MyAreaKmetstvoTile
            ekatte={area.ekatte}
            settlementName={area.settlement.name}
            obshtina={area.obshtina}
          />
        ) : null}

        {/* Município mayor + council on the SETTLEMENT view as well.
            MunicipalityDashboardCards already renders these on the
            município route, but the settlement route's
            SettlementDashboardCards doesn't include the local_government
            section — so a user looking at с. Пролеша would never see
            who governs община Божурище. Surface the parent município's
            mayor / council / roster here too so the chain
            kметство → община → МИР is fully visible.

            The heading line above the block names the município and
            links to its dedicated page so the user knows which place
            the data describes, with a one-click drill-up. */}
        {area.kind === "settlement" ? (
          <>
            <MyAreaMuniSectionHeading obshtina={area.obshtina} />
            <div className="grid gap-3 grid-cols-1 lg:grid-cols-2">
              <MunicipalMayorTile obshtinaCode={area.obshtina} />
              <MunicipalCouncilCompositionTile obshtinaCode={area.obshtina} />
            </div>
            <MunicipalOfficialsRosterTile obshtinaCode={area.obshtina} />
          </>
        ) : null}

        {/* TI-BG Local Integrity System Index — composite + 9-pillar
            municipal transparency score from transparency-bg.org. Renders
            nothing while data is missing (see scripts/transparency/). */}
        <MyAreaTransparencyTile obshtina={area.obshtina} />

        {/* Municipal contacts (phone / email / website / address) —
            auto-hides until update-municipal-contacts populates the data. */}
        <MyAreaContactsTile obshtina={area.obshtina} />

        {/* Council minutes — AI-summarised digest of what the общински
            съвет is voting on. MyTownView pattern. Auto-hides until
            update-council-minutes populates the data file. */}
        <MyAreaCouncilMinutesTile obshtina={area.obshtina} />

        {/* "Recent activity" simulated feed — materialized from existing
            per-município data (procurement, EU funds, capital programmes,
            local-election cycle, and plenary debates that mention this
            município). V1 substitute for email alerts until auth ships. */}
        <MyAreaAlertsTile obshtina={area.obshtina} />

        {/* EU-funded projects map — geocoded contracts as Leaflet pins,
            OSM tiles. Collapsed by default; expanding the tile lazy-loads
            the Leaflet chunk (~150 KB gz) and the slim per-município geo
            JSON. Auto-hides when no geocoded contracts are available. */}
        <MyAreaProjectsMapTile obshtina={area.obshtina} />

        {/* Scaffolded tiles for Phases 6/7/8/9 — all auto-hide until the
            corresponding ingest skill populates their data file. See the
            respective scripts/<source>/README.md for the planned scrape. */}
        <MyAreaSchoolsTile obshtina={area.obshtina} />
        <MyAreaServicesTile obshtina={area.obshtina} />
        <MyAreaAirTile obshtina={area.obshtina} />
        <MyAreaCrimeTile oblast={area.oblast} />

        {/* "Where do my taxes go" personalized receipt. Collapsed by
            default — the COFOG payload only fetches when the user expands.
            Same for every area (national budget mix); placed here because
            the My-Area page is the civic-engagement landing. */}
        <MyAreaTaxReceiptTile />

        {/* Footer link to the canonical settlement/município dashboard.
            We used to render SettlementDashboardCards / MunicipalityDashboardCards
            inline (in compact mode) below the curated tiles. That nearly
            duplicated several of the cards above (mayor, council, election
            results, indicators) and inflated the bundle. A single drill-down
            link is the cleaner exit. */}
        <MyAreaFullDashboardLink area={area} />
      </section>
    </>
  );
};

const MyAreaFullDashboardLink: FC<{
  area: Extract<
    ResolvedArea,
    { kind: "settlement" } | { kind: "municipality" }
  >;
}> = ({ area }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const to =
    area.kind === "settlement"
      ? `/settlement/${area.ekatte}`
      : `/municipality/${area.oblast}`;
  const label =
    area.kind === "settlement"
      ? lang === "bg"
        ? "Виж пълно табло на населеното място"
        : "View full settlement dashboard"
      : lang === "bg"
        ? "Виж пълно табло на общината"
        : "View full municipality dashboard";
  return (
    <Card className="p-3 mt-2">
      <Link
        to={to}
        underline={false}
        className="flex items-center justify-between gap-2 text-sm group"
        aria-label={label}
      >
        <span className="font-medium">{label}</span>
        <ArrowRight className="size-4 text-muted-foreground group-hover:text-primary transition-colors" />
      </Link>
      {/* Reference `t` so future translatable copy can land here without
          re-adding the import — same pattern used in MyAreaRoadmapTile. */}
      <span hidden aria-hidden>
        {t("my_area_dashboard")}
      </span>
    </Card>
  );
};

// Small heading + link line that introduces the município-level tile
// block on the settlement view. Tells the user the next three tiles
// describe the parent община, with a click-through to its dedicated page.
const MyAreaMuniSectionHeading: FC<{ obshtina: string }> = ({ obshtina }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const { findMunicipality } = useMunicipalities();
  const m = findMunicipality(obshtina);
  if (!m) return null;
  const muniName = lang === "bg" ? m.name : m.name_en;
  return (
    <div className="flex items-center gap-2 mt-2">
      <Landmark className="size-4 text-primary" />
      <h2 className="text-sm font-semibold flex items-baseline gap-2">
        {t("my_area_municipality_section_label")}
        <span className="text-xs font-normal text-muted-foreground">·</span>
        <Link
          to={`/settlement/${obshtina}`}
          underline
          className="text-sm font-semibold"
        >
          {lang === "bg" ? `община ${muniName}` : `${muniName} municipality`}
        </Link>
      </h2>
    </div>
  );
};
