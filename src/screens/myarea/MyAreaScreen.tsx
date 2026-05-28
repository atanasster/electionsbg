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

import { FC, lazy, Suspense, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import { SEO } from "@/ux/SEO";
import { H1 } from "@/ux/H1";
import { Card } from "@/components/ui/card";
import { useAreaResolver } from "@/data/area/useAreaResolver";
import { useAreaAnchor, useSetAreaAnchor } from "@/data/area/areaAnchor";
import { useCycleKind } from "@/data/area/useCycleKind";
import { MyAreaHero } from "./MyAreaHero";
import { MyAreaRepresentativesStrip } from "./MyAreaRepresentativesStrip";
import { MyAreaUpcomingBallotTile } from "./MyAreaUpcomingBallotTile";
import { MyAreaKmetstvoTile } from "./MyAreaKmetstvoTile";
import { MyAreaTaxReceiptTile } from "./MyAreaTaxReceiptTile";
import { MyAreaTransparencyTile } from "./MyAreaTransparencyTile";
import { MyAreaSchoolsTile } from "./MyAreaSchoolsTile";
import { MyAreaServicesTile } from "./MyAreaServicesTile";
import { MyAreaAirTile } from "./MyAreaAirTile";
import { MyAreaCrimeTile } from "./MyAreaCrimeTile";
import { MyAreaProjectsMapTile } from "./MyAreaProjectsMapTile";

// Lazy-load the heavy dashboard variants — most My-Area visits don't need
// both, and the Suspense fallback shows skeletons identical to a direct
// /settlement or /municipality visit.
const SettlementDashboardCards = lazy(() =>
  import("@/screens/dashboard/SettlementDashboardCards").then((m) => ({
    default: m.SettlementDashboardCards,
  })),
);
const MunicipalityDashboardCards = lazy(() =>
  import("@/screens/dashboard/MunicipalityDashboardCards").then((m) => ({
    default: m.MunicipalityDashboardCards,
  })),
);

export const MyAreaScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const { id } = useParams<{ id: string }>();
  const area = useAreaResolver(id);
  const cycle = useCycleKind();
  const anchor = useAreaAnchor();
  const setAnchor = useSetAreaAnchor();

  // Keep `?area=<id>` in sync with the path when the user lands here via a
  // direct link (e.g. a shared My-Area URL). Without this, the persistent
  // header pill wouldn't show until the user re-picked the area through
  // the sniper button.
  useEffect(() => {
    if (id && anchor?.id !== id) {
      setAnchor(id);
    }
  }, [id, anchor, setAnchor]);

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

        {/* TI-BG Local Integrity System Index — composite + 9-pillar
            municipal transparency score from transparency-bg.org. Renders
            nothing while data is missing (see scripts/transparency/). */}
        <MyAreaTransparencyTile obshtina={area.obshtina} />

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

        {/* Existing canonical dashboard. Reused as-is so every tile —
            mayor, council, budget transfers, EU funds, census, indicators,
            problem sections — flows through. ElectionContext cycle awareness
            cascades into every child tile automatically. */}
        <Suspense
          fallback={
            <div className="h-64 rounded-xl border bg-card animate-pulse" />
          }
        >
          {area.kind === "settlement" ? (
            <SettlementDashboardCards ekatte={area.ekatte} />
          ) : (
            <MunicipalityDashboardCards municipalityCode={area.obshtina} />
          )}
        </Suspense>
      </section>
    </>
  );
};
