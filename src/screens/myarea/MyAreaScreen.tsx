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
import { AlertTriangle } from "lucide-react";
import { SEO } from "@/ux/SEO";
import { H1 } from "@/ux/H1";
import { Card } from "@/components/ui/card";
import { useAreaResolver } from "@/data/area/useAreaResolver";
import { useCycleKind } from "@/data/area/useCycleKind";
import { MyAreaRepresentativesStrip } from "./MyAreaRepresentativesStrip";
import { MyAreaImportantVotesTile } from "./MyAreaImportantVotesTile";
import { MyAreaUpcomingBallotTile } from "./MyAreaUpcomingBallotTile";
import { hasUpcomingLocalBallot } from "@/data/myarea/upcomingElections";
import { MyAreaKmetstvoTile } from "./MyAreaKmetstvoTile";
import { MyAreaTaxReceiptTile } from "./MyAreaTaxReceiptTile";
import { MyAreaMunicipalBudgetTile } from "./MyAreaMunicipalBudgetTile";
import { MyAreaProcurementTile } from "./MyAreaProcurementTile";
import { MyAreaTendersTile } from "./MyAreaTendersTile";
import { MyAreaTransparencyTile } from "./MyAreaTransparencyTile";
import { MyAreaQualityStrip } from "./MyAreaQualityStrip";
import { MyAreaCommunityTile } from "./MyAreaCommunityTile";
import { MyAreaProjectsMapTile } from "./MyAreaProjectsMapTile";
import { MyAreaPropertyStockTile } from "./MyAreaPropertyStockTile";
import { MyAreaAlertsTile } from "./MyAreaAlertsTile";
import { MyAreaSofiaRaionStrip } from "./MyAreaSofiaRaionStrip";
import { MyAreaCouncilTile } from "./MyAreaCouncilTile";
import { MyAreaActionBand } from "./MyAreaActionBand";
import { MyAreaGovernmentCard } from "./MyAreaGovernmentCard";
import { MyAreaHistoryStrip } from "./MyAreaHistoryStrip";
import { MunicipalCapitalProjectsTiles } from "@/screens/dashboard/MunicipalCapitalProjectsTiles";
import { IpopExecutionTile } from "@/screens/dashboard/IpopExecutionTile";
import { CompaniesHqTile } from "@/screens/dashboard/CompaniesHqTile";
import { PlaceHeader } from "@/screens/components/PlaceHeader";
import { isSofiaCityObshtina } from "@/data/local/placeViews";
import { SOFIA_REGIONS } from "@/data/dataTypes";

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

  const areaName =
    area.kind === "settlement"
      ? lang === "bg"
        ? area.settlement.name
        : area.settlement.name_en
      : lang === "bg"
        ? area.municipality.name
        : area.municipality.name_en;
  const seoTitle = `${t("my_area_dashboard")} — ${areaName}`;

  // Sofia city aggregate — no município row, so its header needs an explicit
  // fallback name and its МИР oblast suppressed from the breadcrumb.
  const sofiaCity =
    area.kind === "municipality" && isSofiaCityObshtina(area.obshtina);
  // The MP strip is МИР-scoped; Sofia city spans all three (S23/S24/S25), so
  // hand it the full set and caption it to the city page rather than one МИР.
  const repsProps = sofiaCity
    ? {
        oblast: area.oblast,
        oblasts: SOFIA_REGIONS,
        regionLabel: lang === "bg" ? "София" : "Sofia",
        regionHref: "/sofia",
      }
    : { oblast: area.oblast };

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
        {/* Unified place header — identity, breadcrumb, map, and the
            three-way view switcher (parliamentary / local). Local pill
            self-hides when the place has no data in the active cycle. */}
        <PlaceHeader
          active="governance"
          level={area.kind === "settlement" ? "settlement" : "municipality"}
          ekatte={area.kind === "settlement" ? area.ekatte : undefined}
          obshtina={area.obshtina}
          // Sofia city has no município row, so its oblast is a representative
          // МИР (S23) used only by the governance tiles below — passing it to
          // the header would mis-label the breadcrumb ("област София 23 МИР").
          // Suppress it there and let fallbackName supply the title instead.
          oblast={sofiaCity ? undefined : area.oblast}
          fallbackName={
            area.kind === "municipality"
              ? lang === "bg"
                ? area.municipality.name
                : area.municipality.name_en
              : undefined
          }
        />

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

        {/* Action band — election-imminent countdown only (within 60
            days). Past activity (council votes, procurement, EU
            contracts) lives in MyAreaAlertsTile below. Auto-hides
            outside the campaign window. */}
        <MyAreaActionBand obshtina={area.obshtina} />

        {/* Area history — the cycle-over-cycle turnout sparkline plus
            top-party-per-cycle strip. Lives just above the "Your MPs"
            block so the question "how does this place vote" lands
            before the question "who represents it now". */}
        <MyAreaHistoryStrip area={area} />

        {hasUpcomingLocalBallot() ? (
          <div className="grid gap-3 grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <MyAreaRepresentativesStrip {...repsProps} />
            <MyAreaUpcomingBallotTile />
          </div>
        ) : (
          <MyAreaRepresentativesStrip {...repsProps} />
        )}

        {/* "Как гласуваха" — voting record of the area's MPs on the most
            consequential roll-call items from the currently-selected NS.
            Auto-hides for non-parliamentary cycles, empty MIRs, or NSes
            with no important items in topic_index. */}
        <MyAreaImportantVotesTile oblast={area.oblast} />

        {/* Band C — Accountability. The freshest, most actionable
            signals about how the município is governed: recent activity,
            council minutes, then the trust-signals duo (LISI score +
            contacts). Promoted above the local-government block because
            "what's happening" beats "who's in charge" for return visits. */}

        {/* "Recent activity" simulated feed — materialized from existing
            per-município data (procurement, EU funds, capital programmes,
            local-election cycle, and plenary debates that mention this
            município). V1 substitute for email alerts until auth ships. */}
        <MyAreaAlertsTile
          obshtina={area.obshtina}
          ekatte={area.kind === "settlement" ? area.ekatte : undefined}
          placeName={areaName}
        />

        {/* Общински съвет — unified council surface. Replaces the former
            "Последни решения" + "Как гласуваха в съвета" pair (both drew
            from the same resolution set; showing them side-by-side made
            users scan the same decisions twice). Each row carries the
            decision metadata + optional AI summary + an expand control
            that reveals the per-councillor avatar strip for resolutions
            that have a named-vote breakdown. A "Спорни" filter chip at
            the top of the tile narrows the list to contested votes
            (≥ 10% against + abstain). Auto-hides until the
            update-council-minutes ingest has populated data for the
            município. */}
        <MyAreaCouncilTile obshtina={area.obshtina} />

        {/* Transparency tile — official contact emails moved inline next
            to each name on MyAreaGovernmentCard. */}
        <MyAreaTransparencyTile obshtina={area.obshtina} />

        {/* Band D — Local government. */}

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

        {/* Município government compact card — collapses Mayor +
            Council composition + Officials roster into one. Renders for
            both settlement and município views: on the município view it
            replaces the three separate tiles that used to live inside
            MunicipalityDashboardCards' local_government section; on the
            settlement view it gives the user a "who governs the parent
            obshtina" summary that SettlementDashboardCards never showed.
            The full versions still ship on /municipality/:id and
            /settlement/:id direct routes. */}
        <MyAreaGovernmentCard obshtina={area.obshtina} />

        {/* Band E — Money. The TaxReceiptTile (national-budget COFOG split for
            the user's personal income tax) + the EU-funded projects map carry
            this band now. Consumer prices and the local-tax rates moved to the
            Потребление (cost-of-living) view, which owns the household-cost
            domain — reach it via the place header's "потребление" switch. */}
        {/* Land-use / property-stock composition for the area's oblast — a
            "what the place is made of" fact. Full width; self-hides without
            data. */}
        <MyAreaPropertyStockTile oblast={area.oblast} />
        {/* "Money in / money out" pair — Чл.53 state-budget envelope
            (always present for the 265 общини, with an adaptive
            касово-изпълнение sub-block for the 2 munis that publish a B3)
            on the left, and the EU-funded projects list/map on the right.
            ProjectsMapTile uses a sibling-driven height trick (lg:h-full +
            lg:absolute lg:inset-0) so its scrollable contract list matches
            whichever tile is taller — keeps the row aligned regardless of
            whether the budget tile shows the execution sub-block. */}
        <div className="grid gap-3 grid-cols-1 lg:grid-cols-2 [&>*:only-child]:lg:col-span-2">
          <MyAreaMunicipalBudgetTile
            obshtina={area.obshtina}
            oblast={area.oblast}
          />
          <MyAreaProjectsMapTile obshtina={area.obshtina} />
        </div>
        {/* Public procurement pinned to this place — local-tier buyers
            (município, schools, hospitals) and what they spent. Self-hides
            when the place has no local-tier procurement on record. */}
        <MyAreaProcurementTile
          obshtina={area.obshtina}
          ekatte={area.kind === "settlement" ? area.ekatte : undefined}
        />
        {/* Tender pipeline (announced procedures, before a contract) by the
            place's municipal-tier buyers — auto-hides when none on record. */}
        <MyAreaTendersTile obshtina={area.obshtina} />
        {/* Personal-tax receipt calculator — content-rich (COFOG breakdown
            + municipal-return line + local-tax estimate + capital-program
            top items). Renders full-width on its own row so the calculator
            chrome and the multi-section body have room to breathe. */}
        <MyAreaTaxReceiptTile obshtina={area.obshtina} oblast={area.oblast} />

        {/* The remaining canonical finance tiles, consolidated here so the
            local-elections município page can drop its duplicate finances
            block and just link across to /my-area: the full per-object +
            per-district capital programme (the tax-receipt above carries only
            a top-3 teaser), the МРРБ investment-programme (IPOP) execution,
            and the MP-linked companies HQ'd in the município. Each self-hides
            without data; all are obshtina-scoped, so a settlement view shows
            its parent município's figures — same convention as the money
            tiles above. */}
        <MunicipalCapitalProjectsTiles obshtinaCode={area.obshtina} />
        <IpopExecutionTile obshtinaCode={area.obshtina} />
        <CompaniesHqTile kind="muni" obshtina={area.obshtina} />

        {/* Band F — Quality of life. A 4-up strip summarising
            crime / air / schools / services with one headline number
            per column; each column links to the full canonical page
            for the município. Auto-hides when fewer than 2 columns
            have data. The full per-tile detail still ships on the
            canonical /settlement and /municipality routes. */}
        <MyAreaQualityStrip obshtina={area.obshtina} />

        {/* Community funnel — the dashboard's final tile invites the user
            into the Наясно Facebook group for discussion and alerts about
            this place. */}
        <MyAreaCommunityTile area={areaName} />
      </section>
    </>
  );
};

// (Phase 8: MyAreaFullDashboardLink was folded into MyAreaHistoryStrip
// as the drill-down link inside its expanded body.)
