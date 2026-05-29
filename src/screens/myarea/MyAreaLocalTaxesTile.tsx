// Local taxes tile — Институт за пазарна икономика 265obshtini.bg
// per-município tax rates. Five indicators (Tier A): property tax on
// legal entities, property-transfer tax, vehicle tax (74-110 kW),
// retail patent tax, taxi patent tax — all 265 общини.
//
// Optional Tier B (per-município naredba): residential ТБО with basis
// flag, tourist tax, dog tax. Currently fills only for oblast capitals;
// rows for missing taxes silently drop.
//
// Tile auto-hides when the município has no ipi block (e.g. data file
// not yet ingested).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Coins } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  useLocalTaxes,
  type IpiIndicatorKey,
  type IpiPerIndicator,
  type LocalTaxIndicatorMeta,
  type NaredbaBlock,
} from "@/data/local_taxes/useLocalTaxes";

type Props = {
  obshtina: string;
};

// 1 = lowest rate (best for taxpayer). Bottom decile gets the green band,
// top decile the red band, middle is neutral. Same ramp the LISI tile uses.
const colorForRank = (rank: number, total: number): string => {
  if (!total) return "#9CA3AF";
  const pct = rank / total;
  if (pct <= 0.2) return "#56A86F";
  if (pct <= 0.5) return "#9BB856";
  if (pct <= 0.8) return "#E0A22C";
  return "#D74A56";
};

const formatValue = (
  value: number,
  unit: string,
  lang: "bg" | "en",
): string => {
  // Patent-tax EUR values are integer-ish; per-kW rates and promilles have
  // fractional precision. Keep up to 3 decimals, strip trailing zeros.
  const fixed = value.toFixed(3).replace(/\.?0+$/, "");
  // Match the project-wide euro convention (see MyAreaTaxReceiptTile and
  // MyAreaProjectsMapTile): "${num} €" in BG, "€${num}" in EN. Compound
  // units like "€/kW" stay glued to the number and follow the same
  // ordering ("0.62 €/kW" / "€0.62/kW"). Non-currency units (‰, %) are
  // suffix-only in both locales.
  if (unit === "€") return lang === "bg" ? `${fixed} €` : `€${fixed}`;
  if (unit.startsWith("€/"))
    return lang === "bg" ? `${fixed} ${unit}` : `€${fixed}${unit.slice(1)}`;
  return `${fixed} ${unit}`;
};

export const MyAreaLocalTaxesTile: FC<Props> = ({ obshtina }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const { data, score } = useLocalTaxes(obshtina);

  if (!data || !score || !score.ipi) return null;

  const totalRanked = Object.keys(data.scoresByObshtina).filter(
    (k) => data.scoresByObshtina[k].ipi,
  ).length;

  // Surface only the indicators the município actually has data for.
  type Row = {
    key: IpiIndicatorKey;
    meta: LocalTaxIndicatorMeta;
    value: IpiPerIndicator;
  };
  const ipiRows: Row[] = data.indicators
    .map((meta) => {
      const value = score.ipi?.[meta.key];
      return value ? { key: meta.key, meta, value } : null;
    })
    .filter((row): row is Row => row != null);

  if (ipiRows.length === 0) return null;

  const naredba: NaredbaBlock | undefined = score.naredba;
  const tbo = naredba?.tboResidential;
  const tboBasisLabel = tbo ? data.tboBasisLabels[tbo.basis] : undefined;

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Coins className="size-4 text-primary" />
        <h2 className="text-sm font-semibold flex-1">
          {t("my_area_local_taxes_title")}
        </h2>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {data.latestYear}
        </span>
      </div>

      <ul className="space-y-2">
        {ipiRows.map(({ key, meta, value }) => {
          const color = colorForRank(value.nationalRank, totalRanked);
          return (
            <li
              key={key}
              className="flex items-center gap-3 text-sm border-b border-dashed border-border/40 pb-2 last:border-0 last:pb-0"
            >
              <span className="flex-1 min-w-0 truncate">
                {meta.label[lang]}
              </span>
              <span
                className="font-semibold tabular-nums shrink-0"
                style={{ color }}
              >
                {formatValue(value.latestValue, meta.unit, lang)}
              </span>
              <span className="text-[11px] text-muted-foreground tabular-nums shrink-0 w-16 text-right">
                {lang === "bg"
                  ? `№${value.nationalRank}/${totalRanked}`
                  : `#${value.nationalRank}/${totalRanked}`}
              </span>
            </li>
          );
        })}
      </ul>

      {tbo && tboBasisLabel ? (
        <div className="mt-3 rounded border bg-muted/30 p-2 text-xs">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">
            {t("my_area_local_taxes_garbage")}
          </div>
          <div className="flex items-baseline gap-2">
            {tbo.rate != null ? (
              <span className="font-semibold tabular-nums">
                {formatValue(tbo.rate, tbo.unit ?? "‰", lang)}
              </span>
            ) : null}
            <span className="text-muted-foreground">
              {lang === "bg" ? "(основа: " : "(basis: "}
              {tboBasisLabel[lang]})
            </span>
          </div>
        </div>
      ) : null}

      {naredba?.touristTax || naredba?.dogTax ? (
        <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
          {naredba.touristTax ? (
            <div className="rounded border p-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">
                {t("my_area_local_taxes_tourist")}
              </div>
              <div className="font-semibold tabular-nums">
                {formatValue(
                  naredba.touristTax.value,
                  naredba.touristTax.unit,
                  lang,
                )}
              </div>
            </div>
          ) : null}
          {naredba.dogTax ? (
            <div className="rounded border p-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">
                {t("my_area_local_taxes_dog")}
              </div>
              <div className="font-semibold tabular-nums">
                {formatValue(naredba.dogTax.value, naredba.dogTax.unit, lang)}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <a
        href={naredba?.url ?? data.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[10px] text-muted-foreground underline mt-3 inline-block"
      >
        {naredba?.url ? t("my_area_local_taxes_naredba_link") : data.source}
      </a>
    </Card>
  );
};
