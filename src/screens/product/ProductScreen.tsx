// /product/:slug — one product across chains.
//
// Composition (design §9.4): cross-chain ladder (cheapest first, "спести X €",
// unit price) · price-history chart · since-euro verdict · match-quality note.
//
// Cross-chain comparison renders only for a confident, multi-chain group. A
// single-chain or low-confidence product is shown honestly as one chain's price,
// never dressed up as a like-for-like comparison. See design §4.3.

import { FC, useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ShoppingBasket,
  TrendingUp,
  TrendingDown,
  Minus,
  MapPin,
  ArrowRight,
} from "lucide-react";
import { SEO } from "@/ux/SEO";
import { H1 } from "@/ux/H1";
import { Link } from "@/ux/Link";
import { ConsumptionBreadcrumb } from "@/screens/components/ConsumptionBreadcrumb";
import { Card } from "@/components/ui/card";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { useProduct, useProductHistory } from "@/data/prices/useProducts";
import { usePriceDict } from "@/data/prices/usePrices";
import {
  fmtEur,
  fmtPriceDate,
  mapsDirectionsUrl,
} from "@/data/prices/usePrices";
import { useAreaAnchor } from "@/data/area/areaAnchor";
import { useAreaResolver } from "@/data/area/useAreaResolver";
import { resolvePriceKeys } from "@/data/prices/pricePlaceKeys";
import { PriceHistoryChart } from "@/screens/components/prices/PriceHistoryChart";
import type { ChainLadderRow } from "@/data/prices/fetchPricePayload";

const CONFIDENCE_MIN = 55; // gate the cross-chain ladder

/** What a shopper actually pays today — the promo price when one is running.
 *  Every ladder derivation (sort order, cheapest/dearest bounds, the +X € gap,
 *  the €/kg unit price) must read this, not the regular `price_eur`: mixing the
 *  two put promo rows in the wrong slot and badged the wrong row "най-евтино". */
const shownPrice = (row: ChainLadderRow): number =>
  row.promo_eur ?? row.price_eur;

/** €/kg or €/L, when the pack size is known. */
const unitPrice = (
  price: number,
  qty: number | null,
  unit: string | null,
  lang: "bg" | "en",
): string | null => {
  if (!qty || !unit) return null;
  if (unit === "g")
    return `${fmtEur((price / qty) * 1000, lang)}/${lang === "bg" ? "кг" : "kg"}`;
  if (unit === "ml")
    return `${fmtEur((price / qty) * 1000, lang)}/${lang === "bg" ? "л" : "L"}`;
  return null;
};

export const ProductScreen: FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const { i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const T = (bg: string, en: string) => (lang === "bg" ? bg : en);

  // Location-aware pricing: when the global ?area= anchor resolves to a
  // settlement (or Sofia city), narrow the cross-chain ladder to that place's
  // stores. `?all=1` forces the national ladder while keeping the anchor intact
  // (so the user's pinned place survives leaving this page). A plain município
  // anchor has no single settlement ekatte → national (honest; product-level
  // local price is settlement-grain).
  const [params] = useSearchParams();
  const forceAll = params.get("all") === "1";
  const anchor = useAreaAnchor();
  const area = useAreaResolver(anchor?.id);
  const localEkatte = useMemo(() => {
    if (forceAll || !area || area.kind === "unknown") return undefined;
    return resolvePriceKeys(
      area.obshtina,
      area.kind === "settlement" ? area.ekatte : undefined,
    ).priceEkatte;
  }, [forceAll, area]);
  const placeName =
    area?.kind === "settlement"
      ? lang === "bg"
        ? area.settlement.name
        : area.settlement.name_en
      : area?.kind === "municipality"
        ? lang === "bg"
          ? area.municipality.name
          : area.municipality.name_en
        : null;
  // `@/ux/Link` already carries the global params (elections, area) forward;
  // we only need to layer `all=1` on top to force the national ladder.
  const allTo = useMemo(
    () => ({ pathname: `/product/${slug}`, search: { all: "1" } }),
    [slug],
  );

  const { data, isLoading } = useProduct(slug, localEkatte);
  const { data: history } = useProductHistory(slug);
  const { data: dict } = usePriceDict();

  if (isLoading) {
    return (
      <section className="my-4 space-y-3">
        <div className="h-24 rounded-xl border bg-card animate-pulse" />
        <div className="h-40 rounded-xl border bg-card animate-pulse" />
      </section>
    );
  }

  if (!data?.product) {
    return (
      <div className="p-6 text-center">
        <H1>{T("Продуктът не е намерен", "Product not found")}</H1>
        <p className="text-muted-foreground mt-2">
          {T(
            "Този продукт вече не се предлага или адресът е грешен.",
            "This product is no longer listed, or the address is wrong.",
          )}
        </p>
      </div>
    );
  }

  const p = data.product;
  const chains = [...data.chains].sort((a, b) => shownPrice(a) - shownPrice(b));
  const cheapest = chains[0];
  const dearest = chains[chains.length - 1];
  const catName =
    dict?.products.find((x) => x.id === p.pid)?.[lang] ?? `№${p.pid}`;
  // Gate on the ACTUAL ladder length, not the national chain_count: a local
  // (?area=) filter can narrow the ladder to zero or one store even for a
  // product sold in many chains nationally, so p.chain_count would wrongly keep
  // the comparable branch on and dereference an empty ladder.
  const noLocalChains = localEkatte != null && chains.length === 0;
  const comparable = chains.length > 1 && p.confidence >= CONFIDENCE_MIN;

  const pct = p.pct_since_euro;
  const verdict =
    pct == null
      ? {
          icon: Minus,
          cls: "text-muted-foreground",
          label: T("нов след еврото", "new since the euro"),
        }
      : pct > 0.1
        ? {
            icon: TrendingUp,
            cls: "text-red-600 dark:text-red-400",
            label: `${T("поскъпна", "up")} ${pct.toFixed(1)}%`,
          }
        : pct < -0.1
          ? {
              icon: TrendingDown,
              cls: "text-green-600 dark:text-green-400",
              label: `${T("поевтиня", "down")} ${Math.abs(pct).toFixed(1)}%`,
            }
          : {
              icon: Minus,
              cls: "text-muted-foreground",
              label: T("без промяна", "unchanged"),
            };
  const Vi = verdict.icon;

  return (
    <>
      <SEO
        title={`${p.title} — ${T("цени", "prices")}`}
        description={T(
          `Цена на ${p.title} по вериги в България от въвеждането на еврото. Мониторингов индекс на КЗП.`,
          `Price of ${p.title} across retail chains in Bulgaria since the euro. CPC monitoring data.`,
        )}
        canonical={`https://naiasno.bg/product/${slug}`}
      />

      <ConsumptionBreadcrumb
        section={T("Продукти", "Products")}
        sectionTo="/consumption/products"
        current={p.title}
        className="mt-4"
      />

      <section className="my-4 space-y-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            {catName}
          </div>
          <H1>{p.title}</H1>
          <div
            className={`mt-1 flex items-center gap-1.5 text-sm ${verdict.cls}`}
          >
            <Vi className="h-4 w-4" />
            <span>{verdict.label}</span>
            <span className="text-muted-foreground">
              · {T("от", "from")} {fmtPriceDate(dict?.baseline, lang)}
            </span>
          </div>
        </div>

        {localEkatte && placeName ? (
          <div className="rounded-lg border bg-card px-3 py-2 flex items-center gap-2 text-sm flex-wrap">
            <MapPin className="size-4 shrink-0 text-primary" />
            <span className="min-w-0">
              {T("Цени за", "Prices for")}{" "}
              <span className="font-semibold">{placeName}</span>
            </span>
            <Link
              to={allTo}
              className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              {T("За цялата страна", "Nationwide")}
              <ArrowRight className="size-3" />
            </Link>
          </div>
        ) : null}

        <DashboardSection
          id="chains"
          title={T("Цени по вериги", "Prices by chain")}
          icon={ShoppingBasket}
        >
          {noLocalChains ? (
            <Card className="p-4 text-sm text-muted-foreground">
              {T(
                `Този продукт не се предлага в наблюдаваните магазини в ${placeName}. `,
                `This product isn't listed in the monitored stores in ${placeName}. `,
              )}
              <Link
                to={allTo}
                className="text-primary hover:underline inline-flex items-center gap-1"
              >
                {T("Виж цените за страната", "See nationwide prices")}
                <ArrowRight className="size-3" />
              </Link>
            </Card>
          ) : comparable ? (
            <Card className="divide-y">
              {chains.map((c) => (
                <LadderRow
                  key={c.eik}
                  row={c}
                  best={shownPrice(cheapest)}
                  worst={shownPrice(dearest)}
                  qty={p.net_qty}
                  unit={p.net_unit}
                  lang={lang}
                  T={T}
                />
              ))}
            </Card>
          ) : (
            <Card className="p-4">
              {chains.map((c) => (
                <div key={c.eik} className="flex justify-between text-sm py-1">
                  <Link
                    to={`/consumption/chain/${c.eik}`}
                    className="hover:text-primary hover:underline min-w-0 truncate"
                  >
                    {c.chain}
                  </Link>
                  <span className="tabular-nums shrink-0 pl-3">
                    {fmtEur(shownPrice(c), lang)}
                    {c.promo_eur != null && (
                      <span className="ml-1 text-xs text-amber-600 dark:text-amber-400">
                        {T("промо", "promo")}
                      </span>
                    )}
                  </span>
                </div>
              ))}
              <p className="mt-3 text-xs text-muted-foreground">
                {T(
                  "Този продукт се предлага само в една верига или съвпадението между вериги не е достатъчно сигурно за сравнение.",
                  "This product is sold at a single chain, or the cross-chain match is not confident enough to compare.",
                )}
              </p>
            </Card>
          )}
        </DashboardSection>

        {history && history.length >= 2 && (
          <DashboardSection
            id="history"
            title={T("Цена във времето", "Price over time")}
            icon={TrendingUp}
          >
            <Card className="p-4">
              <PriceHistoryChart points={history} />
            </Card>
          </DashboardSection>
        )}

        <p className="text-xs text-muted-foreground">
          {comparable
            ? T(
                `Сравнено в ${p.chain_count} вериги. Съвпадението е по име, не по баркод — сигни за грешно съвпадение са добре дошли.`,
                `Matched across ${p.chain_count} chains. Matched by name, not barcode — report a bad match if you spot one.`,
              )
            : T(
                "Мониторингов индекс на КЗП, не официален ИПЦ.",
                "CPC monitoring data, not official CPI.",
              )}
        </p>
      </section>
    </>
  );
};

const LadderRow: FC<{
  row: ChainLadderRow;
  best: number;
  worst: number;
  qty: number | null;
  unit: string | null;
  lang: "bg" | "en";
  T: (bg: string, en: string) => string;
}> = ({ row, best, worst, qty, unit, lang, T }) => {
  const paid = shownPrice(row);
  const save = paid - best;
  const up = unitPrice(paid, qty, unit, lang);
  // The chain's cheapest store for this product — a directions link built from
  // free-text label + settlement (no coordinates; Google geocodes + routes from
  // the user's location). Same affordance as the my-area price tile.
  const storeLabel = [row.store, row.settlement].filter(Boolean).join(" · ");
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <div className="min-w-0">
        <Link
          to={`/consumption/chain/${row.eik}`}
          className="text-sm font-medium truncate block hover:text-primary hover:underline"
        >
          {row.chain}
        </Link>
        <div className="text-xs text-muted-foreground">
          {up && <span>{up}</span>}
          {up && row.stores > 1 && " · "}
          {row.stores > 1 && (
            <span>
              {row.stores} {T("обекта", "stores")}
            </span>
          )}
        </div>
        {row.store ? (
          <a
            href={mapsDirectionsUrl([row.chain, row.store, row.settlement])}
            target="_blank"
            rel="noreferrer"
            title={T(
              `Упътване до ${storeLabel}`,
              `Directions to ${storeLabel}`,
            )}
            className="mt-0.5 text-[11px] text-muted-foreground hover:text-primary hover:underline inline-flex items-center gap-1 min-w-0 max-w-full"
          >
            <MapPin className="size-3 shrink-0" />
            <span className="truncate">{storeLabel}</span>
          </a>
        ) : null}
      </div>
      <div className="text-right shrink-0 pl-3">
        <div className="tabular-nums font-medium">
          {fmtEur(paid, lang)}
          {row.promo_eur != null && (
            <span className="ml-1 text-xs text-amber-600 dark:text-amber-400">
              {T("промо", "promo")}
            </span>
          )}
        </div>
        {save > 0.005 && worst > best && (
          <div className="text-xs text-red-600 dark:text-red-400">
            +{fmtEur(save, lang)}
          </div>
        )}
        {save <= 0.005 && (
          <div className="text-xs text-green-600 dark:text-green-400">
            {T("най-евтино", "cheapest")}
          </div>
        )}
      </div>
    </div>
  );
};
