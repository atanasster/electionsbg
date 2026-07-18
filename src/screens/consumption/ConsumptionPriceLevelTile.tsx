// "Цените тук спрямо страната" — the place-vs-country price-level tile.
// Turns the place's КЗП basket cost into a price-LEVEL index (100 = national
// median) plus a distribution band showing where it sits in the national
// spread, and a robust "под / около / над средното" label (median-absolute-
// deviation threshold, ONS-style — robust to outliers, never says better/worse).
//
// This is the Eurostat PLI / BEA RPP "=100 baseline" framing our basket is most
// ready for. It complements MyAreaPricesTile (which shows WHAT is cheap here and
// the cheapest stores) by answering "is it expensive HERE vs the rest of BG?".
//
// Everything is read from ranking.json — settlement rows are keyed by EKATTE,
// município rows by obshtina (Sofia city = SOF46); each row already carries its
// national / size-class / oblast rank, so no rank is recomputed here.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Gauge } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  usePriceRanking,
  fmtEur,
  type PriceRankPlace,
} from "@/data/prices/usePrices";
import { resolvePriceKeys } from "@/data/prices/pricePlaceKeys";

interface Props {
  ekatte?: string;
  obshtina: string;
}

const POP_BAND_LABEL: Record<"XL" | "L" | "M" | "S", [string, string]> = {
  XL: ["големите градове", "large cities"],
  L: ["градовете", "cities"],
  M: ["средните градове", "mid-size towns"],
  S: ["малките места", "small places"],
};

export const ConsumptionPriceLevelTile: FC<Props> = ({ ekatte, obshtina }) => {
  const { i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const T = (bg: string, en: string) => (lang === "bg" ? bg : en);
  const { data: ranking } = usePriceRanking();

  // Resolve to the price tree's keys (Sofia район → city aggregate, SOF→SOF46).
  const { priceObshtina: muniCode, priceEkatte: settCode } = resolvePriceKeys(
    obshtina,
    ekatte,
  );

  const resolved = useMemo(() => {
    if (!ranking) return null;
    const places = ranking.places;
    // Prefer the settlement's own row; fall back to its município row.
    let me: PriceRankPlace | undefined;
    if (settCode)
      me = places.find(
        (p) =>
          p.tier === "settlement" &&
          p.code === settCode &&
          p.basketLevel != null,
      );
    if (!me)
      me = places.find(
        (p) =>
          p.tier === "muni" && p.code === muniCode && p.basketLevel != null,
      );
    if (!me || me.basketLevel == null) return null;

    // Distribution = all priced places of the same tier (settlement-to-
    // settlement, município-to-município — the basket is computed identically,
    // but same-tier keeps the spread honest).
    const levels = places
      .filter((p) => p.tier === me!.tier && p.basketLevel != null)
      .map((p) => p.basketLevel as number)
      .sort((a, b) => a - b);
    if (levels.length < 8) return null; // too thin to compare

    const median = levels[Math.floor(levels.length / 2)];
    const min = levels[0];
    const max = levels[levels.length - 1];
    // Median absolute deviation — robust spread for the "around average" band.
    const devs = levels.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
    const mad = devs[Math.floor(devs.length / 2)] || 0;
    return { me, median, min, max, mad };
  }, [ranking, settCode, muniCode]);

  if (!ranking || !resolved) return null;
  const { me, median, min, max, mad } = resolved;
  const level = me.basketLevel as number;

  const index = Math.round((level / median) * 100);
  const deltaPct = Math.abs(index - 100);
  const band: "below" | "around" | "above" =
    level < median - mad ? "below" : level > median + mad ? "above" : "around";

  // Marker positions along the min→max track (0..1).
  const span = max - min || 1;
  const pos = (level - min) / span;
  const medPos = (median - min) / span;

  const indexColor =
    index < 98
      ? "text-green-600 dark:text-green-400"
      : index > 102
        ? "text-red-600 dark:text-red-400"
        : "text-foreground";

  const bandLabel =
    band === "below"
      ? T("под средното за страната", "below the national average")
      : band === "above"
        ? T("над средното за страната", "above the national average")
        : T("около средното за страната", "around the national average");
  const bandClass =
    band === "below"
      ? "bg-green-500/15 text-green-700 dark:text-green-300"
      : band === "above"
        ? "bg-red-500/15 text-red-700 dark:text-red-300"
        : "bg-muted text-muted-foreground";

  const nat = me.rank?.national;
  const natN = me.peers?.national;
  const sc = me.rank?.sizeClass;
  const scN = me.peers?.sizeClass;
  const popLabel = me.popBand
    ? POP_BAND_LABEL[me.popBand]?.[lang === "bg" ? 0 : 1]
    : null;

  return (
    <Card className="p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold flex items-center gap-1.5">
            <Gauge className="size-4 text-primary" />
            {T("Цените тук спрямо страната", "Prices here vs the country")}
          </h3>
          <p className="text-xs text-muted-foreground">
            {T(
              "Индекс на нивото на цените · 100 = средно за страната",
              "Price-level index · 100 = national average",
            )}
          </p>
        </div>
      </div>

      {/* Headline index + plain-language read */}
      <div className="flex items-end gap-3 flex-wrap">
        <div className={`text-3xl font-bold tabular-nums ${indexColor}`}>
          {index}
        </div>
        <div className="text-sm text-muted-foreground pb-1">
          {deltaPct < 1 ? (
            T("колкото средното", "about average")
          ) : (
            <>
              <span
                className={
                  index < 100
                    ? "text-green-600 dark:text-green-400"
                    : "text-red-600 dark:text-red-400"
                }
              >
                {deltaPct}%{" "}
                {index < 100
                  ? T("по-евтино", "cheaper")
                  : T("по-скъпо", "dearer")}
              </span>{" "}
              {T("от средното", "than average")}
            </>
          )}
        </div>
        <span
          className={`ml-auto rounded-full px-2 py-1 text-xs font-medium ${bandClass}`}
        >
          {bandLabel}
        </span>
      </div>

      {/* Distribution band — where the place sits in the national spread.
          Median tick at the centre, the place as a dot. */}
      <div className="pt-1">
        <div className="relative h-2.5 rounded-full bg-gradient-to-r from-green-500/40 via-muted to-red-500/40">
          {/* national median */}
          <div
            className="absolute -top-1 -bottom-1 w-px bg-foreground/40"
            style={{ left: `${medPos * 100}%` }}
            aria-hidden
          />
          {/* this place */}
          <div
            className="absolute -top-1 size-4 -translate-x-1/2 rounded-full border-2 border-background bg-primary shadow-sm"
            style={{ left: `${pos * 100}%` }}
            aria-hidden
          />
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
          <span>
            {T("по-евтино", "cheaper")} · {fmtEur(min, lang, 0)}
          </span>
          <span>
            {T("по-скъпо", "dearer")} · {fmtEur(max, lang, 0)}
          </span>
        </div>
      </div>

      {/* Rank context — national position + the peer-group ("places like
          this") comparison, which the basket tile's headline pill doesn't show. */}
      <div className="flex flex-wrap gap-2 text-xs">
        {nat && natN ? (
          <span className="rounded-full bg-muted px-2 py-1">
            {T(
              `№${nat} от ${natN} в страната`,
              `#${nat} of ${natN} nationally`,
            )}
          </span>
        ) : null}
        {sc && scN && scN > 1 && popLabel ? (
          <span className="rounded-full bg-muted px-2 py-1">
            {T(
              `${sc}-о най-евтино сред ${popLabel} (${scN})`,
              `#${sc} cheapest among ${popLabel} (${scN})`,
            )}
          </span>
        ) : null}
        <span className="rounded-full bg-muted px-2 py-1 tabular-nums">
          {T("кошница", "basket")} {fmtEur(level, lang)}
        </span>
      </div>
    </Card>
  );
};
