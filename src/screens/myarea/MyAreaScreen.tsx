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
import { MyAreaHero } from "./MyAreaHero";
import { MyAreaRepresentativesStrip } from "./MyAreaRepresentativesStrip";
import { MyAreaImportantVotesTile } from "./MyAreaImportantVotesTile";
import { MyAreaUpcomingBallotTile } from "./MyAreaUpcomingBallotTile";
import { hasUpcomingLocalBallot } from "@/data/myarea/upcomingElections";
import { MyAreaKmetstvoTile } from "./MyAreaKmetstvoTile";
import { MyAreaTaxReceiptTile } from "./MyAreaTaxReceiptTile";
import { MyAreaLocalTaxesTile } from "./MyAreaLocalTaxesTile";
import { MyAreaTransparencyTile } from "./MyAreaTransparencyTile";
import { MyAreaQualityStrip } from "./MyAreaQualityStrip";
import { MyAreaProjectsMapTile } from "./MyAreaProjectsMapTile";
import { MyAreaAlertsTile } from "./MyAreaAlertsTile";
import { MyAreaSofiaRaionStrip } from "./MyAreaSofiaRaionStrip";
import { MyAreaCouncilMinutesTile } from "./MyAreaCouncilMinutesTile";
import { MyAreaActionBand } from "./MyAreaActionBand";
import { MyAreaGovernmentCard } from "./MyAreaGovernmentCard";
import { MyAreaHistoryStrip } from "./MyAreaHistoryStrip";

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

        {/* Action band — single high-priority "what to notice now" card.
            Selector (useNextAction) picks one of: imminent election /
            recent council vote / recent procurement red flag / default
            countdown. Always renders one card so the band never feels
            empty. See src/data/myarea/useNextAction.ts for priorities. */}
        <MyAreaActionBand obshtina={area.obshtina} />

        {hasUpcomingLocalBallot() ? (
          <div className="grid gap-3 grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <MyAreaRepresentativesStrip oblast={area.oblast} />
            <MyAreaUpcomingBallotTile />
          </div>
        ) : (
          <MyAreaRepresentativesStrip oblast={area.oblast} />
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
        <MyAreaAlertsTile obshtina={area.obshtina} />

        {/* Council minutes — AI-summarised digest of what the общински
            съвет is voting on. MyTownView pattern. Auto-hides until
            update-council-minutes populates the data file. */}
        <MyAreaCouncilMinutesTile obshtina={area.obshtina} />

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

        {/* Band E — Money. Three pieces in a "what I pay → at what rate →
            where it comes back" narrative: TaxReceiptTile (national-budget
            COFOG split for the user's personal income tax) and the local
            tax-rate strip on top, EU-funded projects map on the bottom.
            TaxReceiptTile + ProjectsMap stay collapsed-by-default because
            their COFOG payload and Leaflet chunk are heavy; the local-tax
            strip is light and renders by default. */}
        <MyAreaLocalTaxesTile obshtina={area.obshtina} />
        <div className="grid gap-3 grid-cols-1 lg:grid-cols-2">
          <MyAreaTaxReceiptTile obshtina={area.obshtina} oblast={area.oblast} />
          <MyAreaProjectsMapTile obshtina={area.obshtina} />
        </div>

        {/* Band F — Quality of life. A 4-up strip summarising
            crime / air / schools / services with one headline number
            per column; each column links to the full canonical page
            for the município. Auto-hides when fewer than 2 columns
            have data. The full per-tile detail still ships on the
            canonical /settlement and /municipality routes. */}
        <MyAreaQualityStrip obshtina={area.obshtina} />

        {/* Footer — collapsed-by-default "Area history" details card.
            Holds the cycle-over-cycle turnout sparkline (settlement
            view) plus the drill-down link to the full canonical
            settlement / município dashboard. Used to be a flat
            "Виж пълно табло" link card (Phase 1); Phase 8 wraps it in
            a <details> with the turnout history attached so power users
            can see the long-term trend without inflating the default
            page weight. */}
        <MyAreaHistoryStrip area={area} />
      </section>
    </>
  );
};

// (Phase 8: MyAreaFullDashboardLink was folded into MyAreaHistoryStrip
// as the drill-down link inside its expanded body.)
