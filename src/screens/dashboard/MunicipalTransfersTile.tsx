// Per-region (oblast) tile showing the state→municipal transfer envelope:
// Article 53 of the State Budget Law sets out how much each община gets from
// the central budget, split into five categories. This tile surfaces that
// for the oblast currently in view on the region dashboard.
//
// Source: data/budget/municipal_transfers/oblasts/{code}.json — one shard
// per oblast, multi-year. The tile fetches a single small file (~5-15 KB)
// regardless of how many years it surfaces.
//
// For Sofia voting districts (S23/S24/S25) we redirect to the SOF shard
// (Столична община) since the budget allocates to Sofia city as one entity,
// not per MIR. The surrounding Sofia region (SFO) is its own oblast.

import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Building2, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { Link } from "@/ux/Link";
import { SOFIA_REGIONS } from "@/data/dataTypes";
import { useMunicipalTransfersForOblast } from "@/data/budget/useBudget";
import type { MunicipalTransfersOblastShardYear } from "@/data/budget/types";

const compactEur = (v: number): string => {
  if (v >= 1_000_000_000) return `€${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `€${(v / 1_000_000).toFixed(0)}M`;
  if (v >= 1_000) return `€${(v / 1_000).toFixed(0)}k`;
  return `€${v.toLocaleString("en-US")}`;
};

// Map a dashboard regionCode to the oblast shard's key. Sofia MIRs all map
// to SOF (Столична община). "32" (abroad) has no budget data → null.
const resolveOblastCode = (regionCode: string): string | null => {
  if (regionCode === "32") return null;
  if (SOFIA_REGIONS.includes(regionCode)) return "SOF";
  return regionCode;
};

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

export const MunicipalTransfersTile: FC<{ regionCode: string }> = ({
  regionCode,
}) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith("bg") ? "bg" : "en";
  const [perMuniOpen, setPerMuniOpen] = useState(false);
  const oblastCode = resolveOblastCode(regionCode);
  const { data: shard, isLoading } = useMunicipalTransfersForOblast(
    oblastCode ?? undefined,
  );

  // Latest year with data — the headline figure. Years are ascending in the
  // shard, so the last entry is the most recent.
  const latest: MunicipalTransfersOblastShardYear | null = useMemo(() => {
    if (!shard || shard.years.length === 0) return null;
    return shard.years[shard.years.length - 1];
  }, [shard]);

  const prior: MunicipalTransfersOblastShardYear | null = useMemo(() => {
    if (!shard || shard.years.length < 2) return null;
    return shard.years[shard.years.length - 2];
  }, [shard]);

  const yearlyTotals = useMemo(
    () =>
      shard
        ? shard.years.map((y) => ({
            year: y.fiscalYear,
            eur: y.oblastTotals.total.amountEur,
          }))
        : [],
    [shard],
  );
  const maxYearlyEur = yearlyTotals.reduce(
    (m, y) => (y.eur > m ? y.eur : m),
    0,
  );

  if (!oblastCode || isLoading || !shard || !latest) return null;

  const totalEur = latest.oblastTotals.total.amountEur;
  const priorEur = prior?.oblastTotals.total.amountEur ?? null;
  const yoyDelta =
    priorEur != null && priorEur > 0
      ? ((totalEur - priorEur) / priorEur) * 100
      : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <Building2 className="h-4 w-4" />
          {t("municipal_transfers_tile_title")}
          <span className="text-xs text-muted-foreground font-normal ml-1">
            {latest.fiscalYear}
            {lang === "bg" ? " г." : ""}
          </span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {t("municipal_transfers_tile_intro")}
        </p>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        {/* Headline: oblast total + YoY delta */}
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
          <span className="text-xs text-muted-foreground">
            ·{" "}
            {t("municipal_transfers_muni_count", {
              count: latest.municipalities.length,
            })}
          </span>
        </div>

        {/* Transfer-type tiles for the oblast */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {TRANSFER_TYPES.map(({ code, i18nKey, colour }) => {
            const money = latest.oblastTotals[code];
            const eur = money.amountEur;
            const pct = totalEur > 0 ? (eur / totalEur) * 100 : 0;
            return (
              <div
                key={code}
                className="rounded border bg-card p-2 text-xs"
                title={
                  money
                    ? `€${Math.round(money.amountEur).toLocaleString("bg-BG")}`
                    : undefined
                }
              >
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

        {/* Multi-year trend — oblast total across all years in the shard. */}
        {yearlyTotals.length > 1 && (
          <div>
            <div className="text-xs font-medium mb-1">
              {t("municipality_transfers_trend")}
            </div>
            <div className="space-y-0.5">
              {yearlyTotals.map((p) => {
                const widthPct =
                  maxYearlyEur > 0 ? (p.eur / maxYearlyEur) * 100 : 0;
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
                      {compactEur(p.eur)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Per-municipality list — already sorted desc by builder. */}
        <div>
          <button
            type="button"
            onClick={() => setPerMuniOpen((v) => !v)}
            aria-expanded={perMuniOpen}
            className="flex items-center gap-1 text-xs font-medium mb-1 hover:underline"
          >
            {t("municipal_transfers_per_muni")}
            <ChevronDown
              className={cn(
                "h-3 w-3 transition-transform",
                !perMuniOpen && "-rotate-90",
              )}
            />
          </button>
          <div className={cn("space-y-0.5", !perMuniOpen && "hidden")}>
            {latest.municipalities.map((m) => {
              const eur = m.total?.amountEur ?? 0;
              const pct = totalEur > 0 ? (eur / totalEur) * 100 : 0;
              const maxEur = latest.municipalities[0]?.total?.amountEur ?? 0;
              const widthPct = maxEur > 0 ? (eur / maxEur) * 100 : 0;
              const name = lang === "bg" ? m.nameBg : m.nameEn;
              return (
                <div
                  key={m.ekatte + m.obshtinaCode}
                  className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-3 rounded px-2 py-1 text-xs hover:bg-muted/50"
                >
                  <Link
                    to={`/settlement/${m.obshtinaCode}`}
                    underline={false}
                    className="truncate hover:underline"
                  >
                    {name}
                  </Link>
                  <span className="tabular-nums font-medium">
                    {compactEur(eur)}
                  </span>
                  <span className="tabular-nums text-muted-foreground w-12 text-right">
                    {pct >= 0.5 ? `${pct.toFixed(1)}%` : ""}
                  </span>
                  <div
                    className="col-span-3 h-0.5 rounded-full bg-rose-200/60"
                    style={{ width: `${widthPct}%` }}
                  />
                </div>
              );
            })}
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground">
          {t("municipal_transfers_tile_caveat")}
        </p>
      </CardContent>
    </Card>
  );
};
