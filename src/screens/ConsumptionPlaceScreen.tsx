// Município / settlement node of the Consumption (Потребление) view.
// Route: /consumption/:id  (id resolves via useAreaResolver to a settlement
// EKATTE or an obshtina code; Sofia city is the synthetic SOF00).
//
// The cost-of-living picture for one place: the КЗП basket change since the
// euro, how the place ranks among peers, cheapest chains, and the biggest
// product movers (MyAreaPricesTile, coverage-aware — it self-hides outside the
// ~245 covered settlements / their parent município). Cross-links up to the
// region + national consumption views are always present, so even an uncovered
// place lands on a useful page rather than an empty one.

import { FC } from "react";
import { Navigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ShoppingBasket, ArrowRight } from "lucide-react";
import { SEO } from "@/ux/SEO";
import { H1 } from "@/ux/H1";
import { Card } from "@/components/ui/card";
import { Link } from "@/ux/Link";
import { useAreaResolver } from "@/data/area/useAreaResolver";
import { PlaceHeader } from "@/screens/components/PlaceHeader";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { MyAreaPricesTile } from "@/screens/myarea/MyAreaPricesTile";
import { isSofiaCityObshtina } from "@/data/local/placeViews";
import { findCityRayon } from "@/data/local/cityRayonCatalog";

export const ConsumptionPlaceScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const { id } = useParams<{ id: string }>();
  const area = useAreaResolver(id);

  if (!id) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        {t("my_area_no_id")}
      </div>
    );
  }

  if (!area) {
    // Resolution in flight — render a skeleton placeholder.
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

  // Cost-of-living is published at município grain; a Пловдив/Варна район has
  // none of its own (it resolves to a synthetic município keyed by the район
  // id), so send it up to its parent city's consumption page.
  const cityRayon = findCityRayon(area.obshtina);
  if (cityRayon) {
    return <Navigate to={`/consumption/${cityRayon.obshtina}`} replace />;
  }

  const areaName =
    area.kind === "settlement"
      ? lang === "bg"
        ? area.settlement.name
        : area.settlement.name_en
      : lang === "bg"
        ? area.municipality.name
        : area.municipality.name_en;

  // Sofia city aggregate — no município row, so suppress its МИР oblast from the
  // breadcrumb and the region cross-link (it would mis-label as "област S23").
  const sofiaCity =
    area.kind === "municipality" && isSofiaCityObshtina(area.obshtina);

  return (
    <>
      <SEO
        title={`${t("consumption_title")} — ${areaName}`}
        description={t("consumption_place_intro")}
        // Thin place-tier variant of the prerendered governance place page
        // (shares its price tile) — canonical there so it isn't indexed as a
        // near-duplicate. These nodes are SPA-only (not prerendered / sitemap).
        canonical={`https://electionsbg.com/governance/${id}`}
      />
      <section
        aria-label={`${t("consumption_title")} — ${areaName}`}
        className="my-4 flex flex-col gap-3"
      >
        <PlaceHeader
          active="consumption"
          level={area.kind === "settlement" ? "settlement" : "municipality"}
          ekatte={area.kind === "settlement" ? area.ekatte : undefined}
          obshtina={area.obshtina}
          oblast={sofiaCity ? undefined : area.oblast}
          fallbackName={
            area.kind === "municipality"
              ? lang === "bg"
                ? area.municipality.name
                : area.municipality.name_en
              : undefined
          }
        />

        <DashboardSection
          id="prices"
          title={t("prices_section_overview") || "Кошница на цените"}
          subtitle={t("prices_not_cpi")}
          icon={ShoppingBasket}
        >
          {/* Coverage-aware — self-hides outside the ~245 covered settlements
              (falls back to the município row, then hides). The drill-down link
              is suppressed here — it would point at this very page. */}
          <MyAreaPricesTile
            ekatte={area.kind === "settlement" ? area.ekatte : undefined}
            obshtina={area.obshtina}
            showConsumptionLink={false}
          />

          {/* Always-present cross-links up the place ladder — keeps the page
              useful even for an uncovered place where the tile above hides. */}
          <Card className="p-4 flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              {t("consumption_place_intro")}
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {!sofiaCity && area.oblast ? (
                <Link
                  to={`/consumption/region/${area.oblast}`}
                  className="text-primary hover:underline inline-flex items-center gap-1"
                >
                  {t("consumption_region_link")}
                  <ArrowRight className="size-3.5" />
                </Link>
              ) : null}
              <Link
                to="/consumption"
                className="text-primary hover:underline inline-flex items-center gap-1"
              >
                {t("consumption_national_link")}
                <ArrowRight className="size-3.5" />
              </Link>
            </div>
          </Card>
        </DashboardSection>
      </section>
    </>
  );
};
