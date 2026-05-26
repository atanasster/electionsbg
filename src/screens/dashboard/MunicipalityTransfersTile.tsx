// Per-municipality tile showing the single община's state-budget transfer
// envelope across years. Mounted on /settlement/:obshtinaCode pages.
//
// Reuses the per-oblast shard (same one the region dashboard fetches) and
// filters down to a single municipality row. The shard already carries multi-
// year history so the tile can render the YoY delta + a 5-year trend without
// a second round trip.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Building2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useMunicipalTransfersForOblast } from "@/data/budget/useBudget";
import type { MunicipalTransfersOblastShardMuniYear } from "@/data/budget/types";

const compactEur = (v: number): string => {
  if (v >= 1_000_000_000) return `€${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `€${(v / 1_000_000).toFixed(0)}M`;
  if (v >= 1_000) return `€${(v / 1_000).toFixed(0)}k`;
  return `€${v.toLocaleString("en-US")}`;
};

// Derive the oblast 3-letter code from an obshtina code (BLG01 → BLG,
// S2309 → SOF, SOF00 → SOF). Sofia districts (S2XXX) and the Sofia-city
// page's "SOF00" / "SOF" identifiers all map to the SOF shard (Столична
// община is the single municipality of Sofia city).
const oblastFromObshtina = (obshtinaCode: string): string | null => {
  if (/^S2\d{3}$/.test(obshtinaCode)) return "SOF";
  if (/^SOF\d*$/.test(obshtinaCode)) return "SOF";
  const m = obshtinaCode.match(/^([A-Z]{3})\d{2}$/);
  return m ? m[1] : null;
};

// Is this identifier the Sofia capital (Столична община) under any of its
// aliases — voting district (S2309), SOF00 (Sofia-city page), or bare SOF?
// Sofia city is a one-municipality oblast, so any of these resolves to the
// single Столична entry in the SOF shard by ekatte 68134.
const isSofiaCapital = (code: string): boolean =>
  /^S2\d{3}$/.test(code) || /^SOF\d*$/.test(code);

const TRANSFER_TYPES = [
  {
    code: "delegated" as const,
    i18nKey: "municipal_transfer_delegated",
    colour: "#f43f5e",
  },
  {
    code: "equalization" as const,
    i18nKey: "municipal_transfer_equalization",
    colour: "#fb7185",
  },
  {
    code: "winter" as const,
    i18nKey: "municipal_transfer_winter",
    colour: "#fda4af",
  },
  {
    code: "capital" as const,
    i18nKey: "municipal_transfer_capital",
    colour: "#fdba74",
  },
  {
    code: "otherTargeted" as const,
    i18nKey: "municipal_transfer_otherTargeted",
    colour: "#fcd34d",
  },
];

export const MunicipalityTransfersTile: FC<{ municipalityCode: string }> = ({
  municipalityCode,
}) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith("bg") ? "bg" : "en";
  const oblastCode = oblastFromObshtina(municipalityCode);
  const { data: shard, isLoading } = useMunicipalTransfersForOblast(
    oblastCode ?? undefined,
  );

  // Filter to this single municipality across all years. Sofia capital (any
  // of its identifier aliases) resolves to Столична by ekatte 68134; all
  // other municipalities match by obshtina code.
  const sofiaCapital = isSofiaCapital(municipalityCode);
  const seriesByYear: Array<{
    year: number;
    row: MunicipalTransfersOblastShardMuniYear;
  }> = useMemo(() => {
    if (!shard) return [];
    return shard.years
      .map((y) => {
        const row = y.municipalities.find((m) =>
          sofiaCapital
            ? m.ekatte === "68134"
            : m.obshtinaCode === municipalityCode,
        );
        return row ? { year: y.fiscalYear, row } : null;
      })
      .filter(
        (
          x,
        ): x is { year: number; row: MunicipalTransfersOblastShardMuniYear } =>
          x !== null,
      );
  }, [shard, municipalityCode, sofiaCapital]);

  if (!oblastCode || isLoading || !shard) return null;
  if (seriesByYear.length === 0) return null;

  const latest = seriesByYear[seriesByYear.length - 1];
  const prior =
    seriesByYear.length >= 2 ? seriesByYear[seriesByYear.length - 2] : null;
  const totalEur = latest.row.total?.amountEur ?? 0;
  const priorEur = prior?.row.total?.amountEur ?? null;
  const yoyDelta =
    priorEur != null && priorEur > 0
      ? ((totalEur - priorEur) / priorEur) * 100
      : null;

  const maxTotalEur = Math.max(
    ...seriesByYear.map((p) => p.row.total?.amountEur ?? 0),
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <Building2 className="h-4 w-4" />
          {t("municipal_transfers_tile_title")}
          <span className="text-xs text-muted-foreground font-normal ml-1">
            {latest.year}
            {lang === "bg" ? " г." : ""}
          </span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {t("municipality_transfers_tile_intro")}
        </p>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        {/* Headline: total + YoY */}
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="text-2xl font-semibold tabular-nums">
            {compactEur(totalEur)}
          </span>
          {yoyDelta != null && (
            <span
              className={`text-xs tabular-nums ${
                yoyDelta >= 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-rose-600 dark:text-rose-400"
              }`}
            >
              {yoyDelta >= 0 ? "+" : ""}
              {yoyDelta.toFixed(1)}% {t("vs_prior_year")}
            </span>
          )}
        </div>

        {/* Transfer-type tiles for this muni */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {TRANSFER_TYPES.map(({ code, i18nKey, colour }) => {
            const money = latest.row[code];
            const eur = money?.amountEur ?? 0;
            const pct = totalEur > 0 ? (eur / totalEur) * 100 : 0;
            return (
              <div key={code} className="rounded border bg-card p-2 text-xs">
                <div
                  className="h-1 rounded-full mb-1"
                  style={{ backgroundColor: colour }}
                />
                <div className="text-muted-foreground line-clamp-2">
                  {t(i18nKey)}
                </div>
                <div className="font-medium tabular-nums">
                  {compactEur(eur)}
                </div>
                <div className="text-muted-foreground tabular-nums text-[10px]">
                  {pct >= 0.5 ? `${pct.toFixed(1)}%` : ""}
                </div>
              </div>
            );
          })}
        </div>

        {/* Multi-year trend */}
        {seriesByYear.length > 1 && (
          <div>
            <div className="text-xs font-medium mb-1">
              {t("municipality_transfers_trend")}
            </div>
            <div className="space-y-0.5">
              {seriesByYear.map((p) => {
                const eur = p.row.total?.amountEur ?? 0;
                const widthPct =
                  maxTotalEur > 0 ? (eur / maxTotalEur) * 100 : 0;
                return (
                  <div
                    key={p.year}
                    className="grid grid-cols-[auto_1fr_auto] items-baseline gap-3 rounded px-2 py-1 text-xs"
                  >
                    <span className="tabular-nums text-muted-foreground w-10">
                      {p.year}
                    </span>
                    <div
                      className="h-1 rounded-full bg-rose-300/70"
                      style={{ width: `${widthPct}%` }}
                    />
                    <span className="tabular-nums font-medium w-16 text-right">
                      {compactEur(eur)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground">
          {t("municipal_transfers_tile_caveat")}
        </p>
      </CardContent>
    </Card>
  );
};
