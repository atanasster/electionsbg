// Geographic-footprint tile for the DB company page. Shows WHERE a contractor
// wins — the distribution of its contract value across the buyers' oblasti (the
// "operates statewide vs one region / home-region capture" signal). Fed by
// company_geography() (PG), which joins contracts to the resolved awarder_seats
// table (98% of contract value has a resolved oblast). See 021_awarder_seats.sql.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { MapPin } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";

interface GeoOblast {
  oblast: string;
  eur: number;
  count: number;
}
export interface CompanyGeography {
  procurement: GeoOblast[];
  unknownEur: number;
  unknownCount: number;
  homeSeat: string | null;
}

const SHOWN = 8;

export const CompanyGeographyTile: FC<{ data: CompanyGeography }> = ({
  data,
}) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const nf = new Intl.NumberFormat(lang === "bg" ? "bg-BG" : "en-GB");
  const fmtPct = (frac: number): string =>
    (frac * 100).toLocaleString(lang === "bg" ? "bg-BG" : "en-GB", {
      maximumFractionDigits: frac >= 0.1 ? 0 : 1,
    }) + "%";

  const oblasti = data.procurement ?? [];
  if (oblasti.length === 0) return null;

  const knownEur = oblasti.reduce((s, o) => s + o.eur, 0);
  const total = knownEur + (data.unknownEur || 0);
  if (total <= 0) return null;
  const max = oblasti[0].eur || 1;
  const rows = oblasti.slice(0, SHOWN);
  const rest = oblasti.length - SHOWN;
  const top = oblasti[0];
  const topShare = knownEur > 0 ? top.eur / knownEur : 0;

  const lead =
    oblasti.length === 1
      ? t("company_geo_lead_one", {
          oblast: top.oblast,
          defaultValue: "Работи само в област {{oblast}}.",
        })
      : topShare >= 0.8
        ? t("company_geo_lead_conc", {
            share: fmtPct(topShare),
            oblast: top.oblast,
            defaultValue: "{{share}} от поръчките са в област {{oblast}}.",
          })
        : t("company_geo_lead_spread", {
            count: oblasti.length,
            defaultValue: "Печели поръчки в {{count}} области.",
          });

  return (
    <Card className="my-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <MapPin className="h-4 w-4" />
          {t("company_geo_title") || "Географски отпечатък"}
          <span className="text-xs text-muted-foreground font-normal ml-1">
            {t("company_geo_subtitle") ||
              "Къде печели поръчки — по седалище на възложителя"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <p className="text-sm text-muted-foreground">{lead}</p>
        {data.homeSeat && (
          <p className="text-xs text-muted-foreground">
            {t("company_geo_home") || "Седалище"}: {data.homeSeat}
          </p>
        )}
        <div className="space-y-1.5">
          {rows.map((o) => (
            <div key={o.oblast} className="space-y-0.5">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate max-w-[60%]">{o.oblast}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatEurCompact(o.eur, lang)} ·{" "}
                  {fmtPct(knownEur > 0 ? o.eur / knownEur : 0)}
                </span>
              </div>
              <div className="flex h-2 w-full overflow-hidden rounded bg-muted">
                <div
                  className="h-full bg-primary/70"
                  style={{ width: `${Math.min(100, (o.eur / max) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
        {(rest > 0 || data.unknownEur > 0) && (
          <p className="text-xs text-muted-foreground/80">
            {rest > 0
              ? `+ ${nf.format(rest)} ${t("company_geo_more_oblasti") || "области"}`
              : ""}
            {rest > 0 && data.unknownEur > 0 ? " · " : ""}
            {data.unknownEur > 0
              ? `${t("company_geo_unknown") || "неизвестно седалище"}: ${formatEurCompact(
                  data.unknownEur,
                  lang,
                )}`
              : ""}
          </p>
        )}
      </CardContent>
    </Card>
  );
};
