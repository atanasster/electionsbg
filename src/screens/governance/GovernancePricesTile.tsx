// "Цени / Prices" tile on the Governance dashboards — country (national) and
// oblast. Shows the basket price index since the euro, biggest category movers,
// cheapest chains, and a cheapest / rose-most place leaderboard. Sits beside
// the macro CPI tile with an explicit "monitoring index, not official CPI"
// disclaimer.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Tag, ArrowRight } from "lucide-react";
import { Link } from "@/ux/Link";
import { PriceSparkline } from "@/screens/components/prices/PriceSparkline";
import { ChainBasketList } from "@/screens/components/prices/ChainBasketList";
import { MoversInline } from "@/screens/components/prices/PriceMovers";
import {
  usePriceIndex,
  usePriceRanking,
  useNationalChains,
  fmtEur,
  fmtPct,
  fmtPriceDate,
  priceChangeColor as changeColor,
  type PriceRankPlace,
} from "@/data/prices/usePrices";

interface Props {
  // When set, render the oblast view (its index series + settlements within).
  oblast?: string;
  // On the Governance dashboards, link out to the full Consumption view. Off by
  // default so the tile stays link-free when it is itself inside /consumption.
  showConsumptionLink?: boolean;
}

export const GovernancePricesTile: FC<Props> = ({
  oblast,
  showConsumptionLink = false,
}) => {
  const { i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const { data: index } = usePriceIndex();
  const { data: ranking } = usePriceRanking();
  const { data: chains } = useNationalChains();

  const catName = useMemo(
    () =>
      new Map(
        (index?.categories ?? []).map((c) => [
          c.id,
          lang === "bg" ? c.bg : c.en,
        ]),
      ),
    [index, lang],
  );

  if (!index) return null;
  const T = (bg: string, en: string) => (lang === "bg" ? bg : en);

  const series = oblast
    ? (index.regions[oblast]?.index ?? [])
    : index.national.index;
  if (series.length < 2) return null;
  const latest = series[series.length - 1].v;
  const change = latest / 100 - 1;
  const baselineLabel = fmtPriceDate(index.firstDate || index.baseline, lang);

  // category movers (national only — oblast category series isn't shipped)
  const catMovers = oblast
    ? []
    : Object.entries(index.national.byCategory)
        .map(([cid, s]) => ({
          id: +cid,
          change: (s[s.length - 1]?.v ?? 100) / 100 - 1,
        }))
        .sort((a, b) => b.change - a.change);
  const up = catMovers.slice(0, 3);
  const down = catMovers.slice(-3).reverse();

  // place leaderboard
  const places = (ranking?.places ?? []).filter((p) =>
    oblast
      ? p.tier === "settlement" && p.oblast === oblast && p.rank?.national
      : p.tier === "oblast" && p.rank?.national,
  );
  const cheapest = [...places]
    .filter((p) => p.basketLevel != null)
    .sort((a, b) => a.basketLevel! - b.basketLevel!)
    .slice(0, 3);
  const rose = [...places]
    .sort((a, b) => b.indexSinceEuro - a.indexSinceEuro)
    .slice(0, 3);

  const placeRow = (p: PriceRankPlace, showLevel: boolean) => (
    <li key={p.code} className="flex justify-between gap-2">
      <span className="truncate min-w-0">{p.name}</span>
      <span className="tabular-nums shrink-0 text-muted-foreground">
        {showLevel && p.basketLevel != null
          ? fmtEur(p.basketLevel, lang)
          : fmtPct(p.indexSinceEuro / 100 - 1)}
      </span>
    </li>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div
            className={`text-3xl font-bold tabular-nums ${changeColor(change)}`}
          >
            {fmtPct(change)}
          </div>
          <div className="text-xs text-muted-foreground">
            {T("кошница спрямо", "basket vs")} {baselineLabel}
            {oblast
              ? ""
              : ` · ${index.coverage.settlements} ${T("населени места", "settlements")}`}
          </div>
        </div>
        <PriceSparkline points={series} width={260} height={56} />
      </div>

      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
        {/* category movers (national) — self-hides when empty */}
        <MoversInline
          up={up}
          down={down}
          nameFor={(id) => catName.get(id) ?? String(id)}
          title={T("По категории", "By category")}
        />

        {/* cheapest chains nationally */}
        {!oblast && chains?.national?.length ? (
          <div className="text-xs">
            <div className="font-medium mb-1">
              {T("Най-евтини вериги", "Cheapest chains")}
            </div>
            <ChainBasketList
              chains={chains.national}
              basketSize={chains.commonBasketSize}
              lang={lang}
              limit={4}
            />
          </div>
        ) : null}

        {/* cheapest places */}
        {cheapest.length ? (
          <div className="text-xs">
            <div className="font-medium mb-1">
              {oblast
                ? T("Най-евтини места", "Cheapest places")
                : T("Най-евтини области", "Cheapest oblasts")}
            </div>
            <ul className="space-y-0.5">
              {cheapest.map((p) => placeRow(p, true))}
            </ul>
          </div>
        ) : null}

        {/* rose most */}
        {rose.length ? (
          <div className="text-xs">
            <div className="font-medium mb-1">
              {T("Най-голямо поскъпване", "Rose the most")}
            </div>
            <ul className="space-y-0.5">
              {rose.map((p) => placeRow(p, false))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Tag className="size-3" />
          {T(
            "мониторингов индекс на КЗП, не официален ИПЦ",
            "CPC monitoring index, not official CPI",
          )}
        </span>
        <a
          href={index.source.url}
          target="_blank"
          rel="noreferrer"
          className="text-primary hover:underline inline-flex items-center gap-1"
        >
          kolkostruva.bg
          <ArrowRight className="size-3" />
        </a>
        {showConsumptionLink ? (
          <Link
            to={
              oblast ? `/consumption/region/${oblast}` : "/consumption/overview"
            }
            className="ml-auto inline-flex items-center gap-1 font-medium text-primary hover:underline"
          >
            {T("Виж потреблението подробно", "See full consumption view")}
            <ArrowRight className="size-3" />
          </Link>
        ) : null}
      </div>
    </div>
  );
};
