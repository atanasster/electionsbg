// "Цена на километър по коридор" — gated €/km by corridor. Only corridors with
// a defensible unit cost (single-segment physical-works contracts) appear; the
// rest of the corpus is intentionally not unit-costed. Each corridor's median is
// taken over ONE work class (CorridorAgg.eurPerKmClass) — new build when it has
// enough rows, else repair — and the row says which, so a motorway build median
// never sits unlabelled beside a repair median. Sorted by €/km.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Ruler } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import type { CorridorAgg } from "@/lib/roadAttributes";
import { GROUP_META } from "./roadLabels";
import { UnitCostMethodologyLink } from "@/screens/components/UnitCostMethodologyLink";

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
            <span
              className="w-16 shrink-0 truncate text-[10px] text-muted-foreground"
              title={
                c.eurPerKmClass
                  ? lang === "bg"
                    ? GROUP_META[c.eurPerKmClass].bg
                    : GROUP_META[c.eurPerKmClass].en
                  : undefined
              }
            >
              {c.eurPerKmClass === "build"
                ? lang === "bg"
                  ? "строителство"
                  : "build"
                : lang === "bg"
                  ? "ремонт"
                  : "repair"}
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
            ? "Само договори с разчетен участък (км) и физически строителни работи — без проектиране, надзор, археологически проучвания и допълнителни работи по вече възложен участък. Медианата е по един вид работа: ново строителство и реконструкция, а където те са под 3 договора — ремонт. Останалата част от обема не се остойностява на километър."
            : "Only contracts with a parsed segment (km) and physical works — no design, supervision, archaeological surveys or additional works on an already-awarded section. Each median is over one kind of work: new build and reconstruction, or repair where build has fewer than 3 contracts. The rest of the volume is not unit-costed per kilometre."}
        </p>
        <UnitCostMethodologyLink className="mt-2 inline-block" />
      </CardContent>
    </Card>
  );
};
