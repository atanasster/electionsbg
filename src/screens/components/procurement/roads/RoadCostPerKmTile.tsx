// "Цена на километър по коридор" — gated €/km by corridor. Only corridors with
// a defensible unit cost (single-segment physical-works contracts) appear; the
// rest of the corpus is intentionally not unit-costed. Sorted by €/km so the
// most expensive-per-km corridors surface first (the value-for-money story).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Ruler } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import type { CorridorAgg } from "@/lib/roadAttributes";

export const RoadCostPerKmTile: FC<{ corridors: CorridorAgg[] }> = ({
  corridors,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const rows = corridors
    .filter((c) => c.eurPerKmMedian != null && c.eurPerKmN > 0)
    .sort((a, b) => (b.eurPerKmMedian ?? 0) - (a.eurPerKmMedian ?? 0))
    .slice(0, 10);
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((c) => c.eurPerKmMedian ?? 0));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Ruler className="h-4 w-4" />
          {lang === "bg" ? "Цена на километър" : "Cost per kilometre"}
          <span className="text-xs text-muted-foreground font-normal">
            {lang === "bg" ? "по коридор" : "by corridor"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-2">
        {rows.map((c) => (
          <div key={c.corridor} className="flex items-center gap-2 text-xs">
            <span
              className="w-20 shrink-0 truncate font-medium"
              title={c.corridor}
            >
              {c.corridor}
            </span>
            <span className="flex-1 h-2.5 rounded bg-muted overflow-hidden">
              <span
                className="block h-full bg-primary/60"
                style={{
                  width: `${Math.max(3, Math.min(100, ((c.eurPerKmMedian ?? 0) / max) * 100))}%`,
                }}
              />
            </span>
            <span className="w-20 text-right tabular-nums">
              {formatEurCompact(c.eurPerKmMedian ?? 0, lang)}
              <span className="text-muted-foreground">/km</span>
            </span>
            <span className="w-8 text-right tabular-nums text-muted-foreground">
              n={c.eurPerKmN}
            </span>
          </div>
        ))}
        <p className="text-[11px] text-muted-foreground/80 pt-1">
          {lang === "bg"
            ? "Само договори с разчетен участък (км) и физически строителни работи. Останалата част от обема не се остойностява на километър."
            : "Only contracts with a parsed segment (km) and physical works. The rest of the volume is not unit-costed per kilometre."}
        </p>
      </CardContent>
    </Card>
  );
};
