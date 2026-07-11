// "Пенсии, изплащани в брой" — a genuinely novel map: nobody publishes the
// cash-vs-bank geography of pensions. НОИ pays every pension either to a bank
// account or in cash at a post office; the cash share is a proxy for financial
// exclusion (older, rural, unbanked pensioners). Nationally ~29% is still
// collected in cash, but it ranges from Смолян ~40% down to София-град ~18%.
//
// Amber/orange ramp (higher = more cash-dependent), distinct from the navy
// avg-pension map. The map machinery is the shared <OblastChoropleth>; this tile
// owns the fund-specific framing (the national weighted share + the caption).

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Banknote } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatInt, formatPct } from "@/lib/currency";
import { useNoiPensions } from "@/data/budget/useBudget";
import { useNoiPensionsRegional } from "@/data/budget/useNoiPensionsRegional";
import { OblastChoropleth } from "./OblastChoropleth";
import type { NoiPensionOblastRow } from "@/data/budget/types";

// Module-scope accessor: a stable identity so OblastChoropleth's percentile memo
// actually caches (an inline arrow would change every render, defeating it).
const cashShareOf = (r: NoiPensionOblastRow) => r.cashShare;

// Sequential amber ramp (light → dark): a "financial-exclusion" read, higher =
// more cash-dependent. Dark theme runs muted → bright so the fill reads on the
// navy background; desaturated so no step glares. Single-hue, monotonic
// lightness — colourblind-safe.
const RAMP_LIGHT = [
  "hsl(41 90% 90%)",
  "hsl(39 88% 78%)",
  "hsl(36 86% 64%)",
  "hsl(32 84% 52%)",
  "hsl(27 80% 43%)",
  "hsl(22 74% 34%)",
];
const RAMP_DARK = [
  "hsl(35 22% 32%)",
  "hsl(35 34% 42%)",
  "hsl(35 46% 52%)",
  "hsl(35 56% 60%)",
  "hsl(37 66% 68%)",
  "hsl(40 78% 76%)",
];

export const PensionCashMapTile: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const { data } = useNoiPensions();
  const { year, rows, rowForFeature } = useNoiPensionsRegional(data);

  const withShare = useMemo(
    () =>
      rows.filter(
        (r): r is typeof r & { cashShare: number } => r.cashShare != null,
      ),
    [rows],
  );

  // National cash share = 1 − Σbank/Σpensions (weighted, not a mean of shares).
  const national = useMemo(() => {
    let bank = 0;
    let pens = 0;
    for (const r of rows) {
      if (r.bankPaid != null) bank += r.bankPaid;
      if (r.pensions != null) pens += r.pensions;
    }
    return pens > 0 ? 1 - bank / pens : null;
  }, [rows]);

  const ranked = useMemo(
    () => [...withShare].sort((a, b) => b.cashShare - a.cashShare),
    [withShare],
  );

  if (!data || withShare.length === 0) return null;

  const topRow = ranked[0];
  const bottomRow = ranked[ranked.length - 1];

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Banknote className="h-4 w-4" />
            {bg ? "Пенсии, изплащани в брой" : "Pensions collected in cash"}
          </CardTitle>
          <div className="flex items-center gap-2">
            {national != null && (
              <span className="text-xs font-semibold tabular-nums text-primary">
                {formatPct(national, lang)}{" "}
                <span className="font-normal text-muted-foreground">
                  {bg ? "нац." : "nat."}
                </span>
              </span>
            )}
            {year != null && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {year}
              </span>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <OblastChoropleth
          rows={rows}
          rowForFeature={rowForFeature}
          valueFor={cashShareOf}
          rampLight={RAMP_LIGHT}
          rampDark={RAMP_DARK}
          ariaLabel={
            bg
              ? "Карта на дела пенсии, изплащани в брой, по област"
              : "Cash-collected pensions map by oblast"
          }
          legendFormat={(v) => formatPct(v, lang)}
          noDataLabel={
            <span className="font-medium">{bg ? "Няма данни" : "No data"}</span>
          }
          tooltip={(row) =>
            row.cashShare != null ? (
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">{row.nameBg}</span>
                <span className="tabular-nums">
                  {formatPct(row.cashShare, lang)} {bg ? "в брой" : "in cash"}
                </span>
                {row.cashPaid != null && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatInt(row.cashPaid, lang)}{" "}
                    {bg ? "пенсии в брой" : "cash pensions"}
                  </span>
                )}
              </div>
            ) : (
              <span className="font-medium">
                {bg ? "Няма данни" : "No data"}
              </span>
            )
          }
        />
        <p className="mt-2 text-[11px] text-muted-foreground/80">
          {bg
            ? `Дял на пенсиите, изплащани в брой (не по банков път), по област (НОИ, ${year ?? ""}). Национално около ${national != null ? formatPct(national, lang) : "29%"} се получават в брой — от ${topRow.nameBg} ~${formatPct(topRow.cashShare, lang)} до ${bottomRow.nameBg} ~${formatPct(bottomRow.cashShare, lang)}. По-високият дял е знак за финансово изключване.`
            : `Share of pensions collected in cash (not paid to a bank), by oblast (НОИ, ${year ?? ""}). Nationally about ${national != null ? formatPct(national, lang) : "29%"} is collected in cash — from ${topRow.nameBg} ~${formatPct(topRow.cashShare, lang)} down to ${bottomRow.nameBg} ~${formatPct(bottomRow.cashShare, lang)}. A higher share signals financial exclusion.`}
        </p>
      </CardContent>
    </Card>
  );
};
