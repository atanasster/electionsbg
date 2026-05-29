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

import React, { FC } from "react";
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

// Split a unit like "EUR/нощ (конв. от BGN)" into the canonical euro
// suffix ("€/нощ") and any trailing parenthesised qualifier the caller
// might want to render separately ("конв. от BGN"). Backend stores the
// `EUR/` form so JSON readers from other contexts can parse a plain
// ASCII unit; the tile collapses to the project's `€` convention.
const splitUnit = (
  unit: string,
): { core: string; qualifier: string | null } => {
  const qMatch = unit.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  const core = (qMatch ? qMatch[1] : unit).trim();
  const qualifier = qMatch ? qMatch[2].trim() : null;
  // Normalise the literal "EUR" prefix the backend emits to the project's
  // euro sign. "EUR/нощ" → "€/нощ"; "EUR" alone → "€".
  const normalised = core.replace(/^EUR(?=\/)/, "€").replace(/^EUR$/, "€");
  return { core: normalised, qualifier };
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
  // units like "€/kW" / "€/нощ" / "€/година" stay glued to the number
  // and follow the same ordering. Non-currency units (‰, %) are
  // suffix-only in both locales.
  const { core } = splitUnit(unit);
  if (core === "€") return lang === "bg" ? `${fixed} €` : `€${fixed}`;
  if (core.startsWith("€/"))
    return lang === "bg" ? `${fixed} ${core}` : `€${fixed}${core.slice(1)}`;
  return `${fixed} ${core}`;
};

// Render qualifier when present — e.g. "(конв. от BGN)" on a tourist tax
// rate originally published in lev that we converted at the fixed
// adoption rate. Surfaces as a small muted note so users see we did the
// math, not the município.
const renderQualifier = (unit: string, lang: "bg" | "en"): React.ReactNode => {
  const { qualifier } = splitUnit(unit);
  if (!qualifier) return null;
  // Translate the conversion qualifier; pass anything else through.
  const text =
    qualifier === "конв. от BGN"
      ? lang === "bg"
        ? "(конв. от BGN)"
        : "(conv. from BGN)"
      : `(${qualifier})`;
  return (
    <span className="text-[10px] text-muted-foreground ml-1"> {text}</span>
  );
};

export const MyAreaLocalTaxesTile: FC<Props> = ({ obshtina }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const { data, score } = useLocalTaxes(obshtina);

  if (!data || !score || !score.ipi) return null;

  // Surface only the indicators the município actually has data for.
  type Row = {
    key: IpiIndicatorKey;
    meta: LocalTaxIndicatorMeta;
    value: IpiPerIndicator;
    rankTotal: number;
  };
  const ipiRows: Row[] = data.indicators
    .map((meta) => {
      const value = score.ipi?.[meta.key];
      if (!value) return null;
      // Per-indicator denominator comes from the slim index — varies if
      // some indicators have missing data for a subset of municípios.
      const rankTotal = data.rankTotals[meta.key] ?? 0;
      return { key: meta.key, meta, value, rankTotal };
    })
    .filter((row): row is Row => row != null);

  if (ipiRows.length === 0) return null;

  const naredba: NaredbaBlock | undefined = score.naredba;
  const tbo = naredba?.tboResidential;
  const tboBasisLabel = tbo ? data.tboBasisLabels[tbo.basis] : undefined;

  return (
    <Card id="myarea-local-taxes" className="p-4 scroll-mt-24">
      <div className="flex items-center gap-2 mb-3">
        <Coins className="size-4 text-primary" />
        <h2 className="text-sm font-semibold flex-1">
          {t("my_area_local_taxes_title")}
        </h2>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {data.latestYear}
        </span>
      </div>

      <ul className="space-y-0.5">
        {ipiRows.map(({ key, meta, value, rankTotal }) => {
          const color = colorForRank(value.nationalRank, rankTotal);
          // Show the row's own year when it lags behind the tile-level
          // latestYear. ИПИ paused patent_tax_taxi after 2023 even as
          // the other four indicators kept ticking; without this hint
          // the user reads the taxi rate under a "2025" tile header.
          const yearTag =
            value.latestYear !== data.latestYear
              ? ` (${value.latestYear})`
              : "";
          return (
            <li
              key={key}
              className="flex items-center gap-3 text-xs border-b border-dashed border-border/40 py-1 last:border-0"
            >
              <span className="flex-1 min-w-0 truncate">
                {meta.label[lang]}
                {yearTag}
              </span>
              <span
                className="font-semibold tabular-nums shrink-0"
                style={{ color }}
              >
                {formatValue(value.latestValue, meta.unit, lang)}
              </span>
              <span className="text-[10px] text-muted-foreground tabular-nums shrink-0 w-14 text-right">
                {lang === "bg"
                  ? `№${value.nationalRank}/${rankTotal}`
                  : `#${value.nationalRank}/${rankTotal}`}
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
                {renderQualifier(naredba.touristTax.unit, lang)}
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
                {renderQualifier(naredba.dogTax.unit, lang)}
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
