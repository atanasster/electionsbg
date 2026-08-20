// One sentence, shown beside any figure built on a THIN day.
//
// The distinction it exists for: the price INDEX is chain-matched, so a chain
// joining or leaving cannot move it. Every LEVEL figure — basketLevel, the
// „Най-евтини области" board, the basket-cost map, one place's own cheapest
// prices — is a single raw day over whichever stores filed, and
// `build_index.ts`'s own header records that these "remain exposed to exactly
// the reporter-set drift the index was fixed for".
//
// That exposure is not hypothetical: the КЗП feed fell from 210 reporting
// chains to 98 between 2026-07-26 and 2026-08-14. Measured by removing one
// large chain from a single day, a MEDIAN moves +0.068% while a MINIMUM — which
// is what these boards rank on — moves +4.29% on average and +415% at worst,
// because the chain that left was disproportionately likely to have been the
// cheapest.
//
// ⚠️ Plan T3 (moving the levels onto a matched panel) was ATTEMPTED AND
// REVERTED: it reached only the settlement tier while the cheapest board is the
// oblast tier, and per-place baselines biased newcomers cheaper. So until that
// lands this note is the ONLY thing telling a reader the board may be
// composition-driven, which is why it says where to look instead rather than
// ending on a hedge.
//
// SURFACES (keep this list current — an unwired level surface is SILENT, which
// is how the first cut shipped with the „Най-евтини области" board itself
// unwired while this very header quoted it by name):
//   PricesScreen                „Най-евтини области" board            ranking
//   PriceHeatmapTile            basket-cost map — once for the tile,  ranking
//                               NOT inside PriceChoropleth: the change
//                               map is the chain-matched index and is
//                               not exposed, and rendering it in the
//                               choropleth made it a flex-ROW sibling
//                               of the map and squeezed the SVG
//   ConsumptionPriceLevelTile   national/size-class/oblast ranks      ranking
//   ConsumptionAffordabilityTile  basket € vs GDP/capita rank         ranking
//   GovernancePricesTile        oblast basket + national rank         ranking
//   MyAreaPricesTile            the place's own basket + rank         ranking
//   PlaceBasketTile             one settlement's own prices           place
//
// See docs/plans/prices-chain-absence-v1.md T4.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  fmtPriceDate,
  type PriceRankingCoverage,
} from "@/data/prices/usePrices";

export const PriceCoverageNote: FC<{
  coverage: PriceRankingCoverage | undefined;
  /** What the surface actually shows. "ranking" compares places against each
   *  other; "place" shows one place's own prices and compares nothing — telling
   *  a reader of a single-place tile that "the ranking" may be composition-
   *  driven describes something the tile is not doing, and costs the note its
   *  credibility on the surfaces where the sentence IS true. */
  basis?: "ranking" | "place";
  className?: string;
}> = ({ coverage, basis = "ranking", className }) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const lang: "bg" | "en" = bg ? "bg" : "en";

  // Absent coverage is NOT "complete" — it is a payload built before this field
  // existed, or one we could not read. Say nothing rather than vouch for it.
  // (The producer-side gate is what makes that silence observable; see
  // scripts/db/tests/prices_last_seen.data.test.ts.)
  if (!coverage || coverage.chainsComplete !== false) return null;

  const { chains, trailingMedian, latestDate } = coverage;
  const day = latestDate ? fmtPriceDate(latestDate, lang) : null;
  // Both halves or neither: "98 chains" without its baseline is not a fact a
  // reader can weigh, and the baseline alone says nothing about today.
  const detail =
    chains != null && trailingMedian != null
      ? bg
        ? ` — подали са ${chains} вериги при обичайни около ${Math.round(trailingMedian)}`
        : ` — ${chains} chains filed, against a usual ~${Math.round(trailingMedian)}`
      : "";

  const body =
    basis === "place"
      ? bg
        ? 'Всяка цена тук е най-ниската сред магазините, подали данни, така че за някои продукти „най-евтино" идва от по-малко магазини от обичайното.'
        : "Every price here is the lowest among the shops that filed, so for some products the cheapest local price comes from fewer shops than usual."
      : bg
        ? "Класирането сравнява цени от различен брой вериги по места, затова разликите между тях могат да отразяват кой е подал данни, а не кое е по-евтино. За промяната на цените вижте индекса — той сравнява само вериги, подали данни и за двата дни."
        : "The ranking compares prices from a different number of chains in each place, so the gaps between them may reflect who filed rather than what is cheaper. For price change, use the index — it compares only chains that filed on both days.";

  return (
    <p
      className={cn("text-xs text-muted-foreground", className)}
      data-testid="price-coverage-note"
    >
      {bg
        ? `Данните за ${day ?? "този ден"} са непълни${detail}. ${body}`
        : `Data for ${day ?? "this day"} is incomplete${detail}. ${body}`}
    </p>
  );
};
