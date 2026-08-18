// /consumption/unit-prices — the "€ на килограм / литър" value explorer.
// Because pack size is baked into product identity (and brand is empty), the
// only way to compare a 400g and an 800g tin fairly is to normalize to €/kg
// (from g) and €/L (from ml). Per KZP category: the median plus the best-value
// (lowest €/unit) products you can actually buy. `pc` products have no kg/L
// basis and are excluded. A monitoring index, NOT official CPI.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Scale, Tag, ArrowRight } from "lucide-react";
import { Link } from "@/ux/Link";
import { SEO } from "@/ux/SEO";
import { ConsumptionBreadcrumb } from "@/screens/components/ConsumptionBreadcrumb";
import { Title } from "@/ux/Title";
import { Card } from "@/components/ui/card";
import {
  useUnitPrices,
  usePriceIndex,
  fmtEur,
  type UnitPriceBasis,
  HOUSEHOLD_PACK_MAX_G,
} from "@/data/prices/usePrices";

export const ConsumptionUnitPricesScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const T = (bg: string, en: string) => (lang === "bg" ? bg : en);
  const { data } = useUnitPrices();
  const { data: index } = usePriceIndex();

  const title = T("€ на килограм", "€ per kilo");
  const description = T(
    "Нормализирана цена на 1 кг и 1 л по категории — за да сравниш опаковки с различен грамаж коя дава най-много за парите. Едрите опаковки са отбелязани: те са по-евтини на килограм по дефиниция.",
    "Price normalized to 1 kg and 1 L per category — so packs of different sizes are comparable and you can see which gives the most for your money. Catering packs are marked: they are cheaper per kilo by definition.",
  );

  // Only categories with at least one usable basis.
  const cats = (data?.categories ?? []).filter((c) => c.kg || c.l);

  const perUnitLabel = (unit: "kg" | "l") =>
    unit === "kg" ? T("€/кг", "€/kg") : T("€/л", "€/L");

  const basisBlock = (basis: UnitPriceBasis, unit: "kg" | "l") => (
    <div className="text-xs">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="font-medium">
          {T("Среден", "Median")} {perUnitLabel(unit)}
        </span>
        <span className="tabular-nums text-muted-foreground">
          {fmtEur(basis.median, lang)}
        </span>
      </div>
      <div className="mb-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        {T("Най-добра стойност", "Best value")}
      </div>
      <ul className="space-y-0.5">
        {basis.best.slice(0, 4).map((p) => (
          <li key={p.slug} className="flex justify-between gap-2">
            <Link
              to={`/product/${p.slug}`}
              className="min-w-0 flex-1 truncate hover:underline"
            >
              {p.title}
            </Link>
            {/* A CATERING pack is marked rather than hidden — this page is the
                explorer, and its promise is "which gives the most for your
                money". Bulk is cheaper per kilo by definition, so an unmarked
                10kg sack at the top of a "best value" list answers a question
                nobody asked. (The /prices tile filters these out instead; it
                has four slots and no room for a caveat.) The kg ceiling does
                NOT apply to the L basis — see HOUSEHOLD_PACK_MAX_G. */}
            {unit === "kg" && p.netQty > HOUSEHOLD_PACK_MAX_G ? (
              <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                {T("едро", "bulk")}
              </span>
            ) : null}
            <span className="shrink-0 tabular-nums text-green-700 dark:text-green-400">
              {fmtEur(p.eurPerUnit, lang)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <>
      <SEO
        title={`${title} · ${T("Потребление", "Consumption")}`}
        description={description}
      />
      <ConsumptionBreadcrumb
        section={T("Цени", "Prices")}
        sectionTo="/prices"
        current={title}
        className="mt-4 mb-2"
      />
      <Title description={description}>{title}</Title>

      <div className="my-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cats.map((c) => (
          <Card key={c.cat} className="flex flex-col gap-3 p-4">
            <div className="flex items-center gap-2">
              <Scale className="size-4 text-muted-foreground" />
              <span className="font-semibold">
                {lang === "bg" ? c.bg : c.en}
              </span>
            </div>
            {c.kg ? basisBlock(c.kg, "kg") : null}
            {c.l ? basisBlock(c.l, "l") : null}
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Tag className="size-3" />
          {t("prices_not_cpi")}
        </span>
        {index?.source?.url ? (
          <a
            href={index.source.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            kolkostruva.bg
            <ArrowRight className="size-3" />
          </a>
        ) : null}
      </div>
    </>
  );
};
