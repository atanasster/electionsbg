// „Защитена територия — Натура 2000 и националните паркове" — the nature leg of the
// outcome story (air ✓, waste ✓, nature). A compact context strip: the % of land under
// protection, where Bulgaria is among the EU's highest — a positive counterpoint to the
// recycling gap. Reads the protectedArea block of data/environment/waste.json (Eurostat
// env_bio4). Context only — designation is not the same as active management.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Trees } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { EuFlag } from "../security/euFlags";
import { useWaste } from "@/data/environment/useWaste";

const GEO_NAME: Record<string, { bg: string; en: string }> = {
  BG: { bg: "България", en: "Bulgaria" },
  RO: { bg: "Румъния", en: "Romania" },
  HR: { bg: "Хърватия", en: "Croatia" },
  HU: { bg: "Унгария", en: "Hungary" },
  EU27_2020: { bg: "ЕС средно", en: "EU average" },
};
const PEERS = ["BG", "HR", "RO", "HU"] as const;

export const EnvironmentNatureTile: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const loc = bg ? "bg-BG" : "en-US";
  const { data } = useWaste();
  const pa = data?.protectedArea;
  if (!pa || pa.byGeo.BG == null) return null;

  const bgVal = pa.byGeo.BG;
  const euVal = pa.byGeo.EU27_2020 ?? null;
  const rows: { geo: string; val: number }[] = PEERS.filter(
    (g) => pa.byGeo[g] != null,
  )
    .map((g) => ({ geo: g as string, val: pa.byGeo[g] }))
    .sort((a, b) => b.val - a.val);
  if (euVal != null) rows.push({ geo: "EU27_2020", val: euVal });
  const max = Math.max(...rows.map((r) => r.val), 1);
  const multiple = euVal && euVal > 0 ? bgVal / euVal : null;

  return (
    <Card id="nature">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Trees className="h-4 w-4" />
          {bg
            ? "Защитена територия — Натура 2000 и паркове"
            : "Protected territory — Natura 2000 & parks"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
            {bgVal.toLocaleString(loc, { maximumFractionDigits: 0 })}%
          </span>
          <span className="text-xs text-muted-foreground">
            {bg
              ? `от територията под защита${pa.latestYear ? ` (${pa.latestYear} г.)` : ""} — сред най-високите в ЕС`
              : `of land under protection${pa.latestYear ? ` (${pa.latestYear})` : ""} — among the EU's highest`}
          </span>
        </div>

        <div className="space-y-1.5">
          {rows.map((r) => {
            const isBg = r.geo === "BG";
            const isEu = r.geo === "EU27_2020";
            return (
              <div key={r.geo} className="flex items-center gap-2">
                <span className="flex w-28 shrink-0 items-center gap-1.5">
                  <EuFlag
                    geo={r.geo}
                    size={11}
                    title={GEO_NAME[r.geo]?.[bg ? "bg" : "en"] ?? r.geo}
                  />
                  <span
                    className={`truncate text-[11px] ${isBg ? "font-semibold text-foreground" : "text-muted-foreground"}`}
                  >
                    {GEO_NAME[r.geo]?.[bg ? "bg" : "en"] ?? r.geo}
                  </span>
                </span>
                <div className="relative h-4 flex-1 overflow-hidden rounded bg-muted/40">
                  <div
                    className={`h-full rounded ${isBg ? "bg-emerald-600" : isEu ? "bg-muted-foreground/30" : "bg-emerald-600/30"}`}
                    style={{ width: `${(r.val / max) * 100}%` }}
                  />
                </div>
                <span
                  className={`w-10 shrink-0 text-right text-[11px] tabular-nums ${isBg ? "font-semibold" : "text-muted-foreground"}`}
                >
                  {r.val.toLocaleString(loc, { maximumFractionDigits: 0 })}%
                </span>
              </div>
            );
          })}
        </div>

        <p className="text-sm leading-snug">
          {bg ? (
            <>
              България опазва{" "}
              <span className="font-semibold tabular-nums">
                {bgVal.toLocaleString(loc, { maximumFractionDigits: 0 })}%
              </span>{" "}
              от територията си (Натура 2000 + национални паркове и резервати)
              {multiple ? (
                <>
                  {" "}
                  — около{" "}
                  <span className="font-semibold tabular-nums">
                    {multiple.toLocaleString(loc, { maximumFractionDigits: 1 })}
                    ×
                  </span>{" "}
                  средното за ЕС
                </>
              ) : null}
              . Обявената защита обаче не значи автоматично добро управление.
            </>
          ) : (
            <>
              Bulgaria protects{" "}
              <span className="font-semibold tabular-nums">
                {bgVal.toLocaleString(loc, { maximumFractionDigits: 0 })}%
              </span>{" "}
              of its territory (Natura 2000 + national parks and reserves)
              {multiple ? (
                <>
                  {" "}
                  — about{" "}
                  <span className="font-semibold tabular-nums">
                    {multiple.toLocaleString(loc, { maximumFractionDigits: 1 })}
                    ×
                  </span>{" "}
                  the EU average
                </>
              ) : null}
              . Designation, though, does not by itself mean good management.
            </>
          )}
        </p>

        <p className="text-[11px] text-muted-foreground/80">
          {bg ? "Източник: " : "Source: "}
          {pa.source}.
        </p>
      </CardContent>
    </Card>
  );
};
