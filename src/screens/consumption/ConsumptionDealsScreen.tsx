// /consumption/deals — "Промоции", the biggest current price cuts. The largest
// promo discount per product from the daily КЗП feed (promo vs regular price),
// precomputed into the `deals` payload. When an area anchor (?area=) is set the
// screen re-scopes to that município's promos ("промоции край вас") with a
// link back to the national feed; the prerendered/canonical page stays the
// national version (the re-scope is client-only). Monitoring index, not
// official CPI.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { Tag, ArrowRight } from "lucide-react";
import { Link } from "@/ux/Link";
import { SEO } from "@/ux/SEO";
import { ConsumptionBreadcrumb } from "@/screens/components/ConsumptionBreadcrumb";
import { Title } from "@/ux/Title";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { Card } from "@/components/ui/card";
import { DealsList } from "@/screens/components/consumption/DealsList";
import { MethodologyCallout } from "@/screens/components/MethodologyCallout";
import { useAreaAnchor } from "@/data/area/areaAnchor";
import { useAreaResolver } from "@/data/area/useAreaResolver";
import { resolvePriceKeys } from "@/data/prices/pricePlaceKeys";
import { useDeals, useMuniDeals, fmtPriceDate } from "@/data/prices/usePrices";

export const ConsumptionDealsScreen: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const lang: "bg" | "en" = bg ? "bg" : "en";
  const T = (b: string, e: string) => (bg ? b : e);

  const [params] = useSearchParams();
  // "виж всички" forces the national feed while KEEPING the global ?area=
  // anchor intact (so leaving the deals page doesn't drop the user's place).
  const forceAll = params.get("all") === "1";
  const anchor = useAreaAnchor();
  const area = useAreaResolver(anchor?.id);
  // Route through resolvePriceKeys so Sofia (city SOF00 / a район) maps to the
  // SOF46 deals-muni key — matching the place dashboard. Using the raw
  // area.obshtina here would miss every Sofia anchor.
  const obshtina =
    area && area.kind !== "unknown"
      ? resolvePriceKeys(
          area.obshtina,
          area.kind === "settlement" ? area.ekatte : undefined,
        ).priceObshtina
      : null;
  const placeName =
    area?.kind === "settlement"
      ? bg
        ? area.settlement.name
        : area.settlement.name_en
      : area?.kind === "municipality"
        ? bg
          ? area.municipality.name
          : area.municipality.name_en
        : null;

  const { data: national } = useDeals();
  const { data: local } = useMuniDeals(obshtina);

  // Scope to the anchored município only when it actually has local promos;
  // otherwise fall through to the national feed (an obshtina with no covered
  // stores returns null).
  const scoped = !forceAll && !!(local && local.deals.length > 0);
  // `@/ux/Link` keeps the global params (elections, area); layer `all=1` on top
  // to force the national feed.
  const allTo = { pathname: "/consumption/deals", search: { all: "1" } };
  const data = scoped ? local : national;
  const deals = data?.deals ?? [];

  return (
    <>
      <SEO
        title={T("Промоции · Потребление", "Deals · Consumption")}
        description={T(
          "Най-големите намаления по продукти в България — промоционална спрямо редовна цена от дневния фийд на КЗП.",
          "The biggest per-product price cuts in Bulgaria — promo vs regular price from the daily CPC feed.",
        )}
      />
      <ConsumptionBreadcrumb
        section={T("Промоции", "Deals")}
        className="mt-4 mb-2"
      />
      <Title>{T("Промоции", "Deals")}</Title>

      <section aria-label={T("Промоции", "Deals")}>
        <DashboardSection
          id="prices"
          title={
            scoped && placeName
              ? T(`Промоции · ${placeName}`, `Deals · ${placeName}`)
              : T("Най-големи намаления днес", "Biggest cuts today")
          }
          subtitle={
            data?.latestDate
              ? `${T("промоционална спрямо редовна цена", "promo vs regular price")} · ${fmtPriceDate(data.latestDate, lang)}`
              : T("промоционална спрямо редовна цена", "promo vs regular price")
          }
          icon={Tag}
        >
          {scoped ? (
            <p className="mb-2 text-xs text-muted-foreground">
              {T(
                `Показва промоции в община ${placeName}. `,
                `Showing promotions in ${placeName} municipality. `,
              )}
              <Link
                to={allTo}
                className="text-primary hover:underline inline-flex items-center gap-1"
              >
                {T("Виж всички", "See all")}
                <ArrowRight className="size-3" />
              </Link>
            </p>
          ) : null}
          {deals.length === 0 ? null : (
            <Card className="p-3 sm:p-4">
              <DealsList deals={deals} lang={lang} />
            </Card>
          )}
          {deals.length === 0 ? null : (
            <MethodologyCallout
              variant="info"
              title={T(
                "Как смятаме намалението",
                "How we calculate the discount",
              )}
              className="mt-3"
            >
              {T(
                'Данните са от дневния фийд на КЗП „Колко струва". За всеки продукт показваме най-голямото намаление в момента за страната. Процентът се смята спрямо типичната редовна цена за продукта при всички вериги (една верига — един глас), а не спрямо обявената от конкретния магазин „редовна" цена, която понякога е завишена. Показваме само намаления, потвърдени в поне 2 вериги и 3 обекта; изключваме и над 70% явно грешни цени. Мониторингов индекс, не официален ИПЦ.',
                'Data comes from the КЗП „Колко струва" daily price feed. For each product we show the biggest current discount nationwide. The percentage is measured against the product’s typical regular price across every chain that sells it (one vote per chain), not against an individual store’s declared “regular” price, which is sometimes inflated. We show only discounts corroborated at ≥2 chains and ≥3 stores, and drop anything above 70% off or with obviously erroneous prices. A monitoring index, not official CPI.',
              )}
            </MethodologyCallout>
          )}
        </DashboardSection>
      </section>
    </>
  );
};
