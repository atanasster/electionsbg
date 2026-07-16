// The /customs/warehouses register map: one marker per CITY, the badge showing how
// many licensed excise warehouses (данъчни складове) sit there, coloured by that
// count. A register-style "where are the bonded warehouses" view — the deep detail
// lives in the operator table below. Filter by excise-goods category; each warehouse
// in a city's popup links to its operator's /company/:eik page.
//
// The map itself is the shared SectorPointMap (reused from the judiciary court-load
// map); this screen owns the category filter, the count colour bands and the legend.

import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Map as MapIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { cn } from "@/lib/utils";
import {
  SectorPointMap,
  type SectorMapPoint,
} from "@/screens/components/maps/SectorPointMap";
import {
  EXCISE_CATEGORIES,
  exciseCategoryLabel,
  type ExciseCategory,
  type ExciseWarehousePoint,
} from "@/lib/customsReferenceData";

// Sequential single-hue count ramp (blue): more warehouses → darker. Theme-invariant
// and CVD-safe as a single-hue sequence; the legend labels carry the exact bands.
const BANDS: { max: number; color: string; label: string }[] = [
  { max: 1, color: "#93c5fd", label: "1" }, // blue-300
  { max: 3, color: "#60a5fa", label: "2–3" }, // blue-400
  { max: 6, color: "#3b82f6", label: "4–6" }, // blue-500
  { max: 15, color: "#2563eb", label: "7–15" }, // blue-600
  { max: Infinity, color: "#1e40af", label: "> 15" }, // blue-800
];
const bandColor = (count: number) =>
  (BANDS.find((b) => count <= b.max) ?? BANDS[BANDS.length - 1]).color;

const locKey = (loc: [number, number]) => `${loc[0]},${loc[1]}`;

export const ExciseWarehouseMap: FC<{
  warehouses: ExciseWarehousePoint[];
}> = ({ warehouses }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";

  const [hidden, setHidden] = useState<Set<ExciseCategory>>(new Set());

  // Only categories actually present get a toggle chip.
  const presentCats = useMemo(() => {
    const s = new Set(warehouses.map((w) => w.category));
    return EXCISE_CATEGORIES.filter((c) => s.has(c.id));
  }, [warehouses]);

  const points = useMemo<SectorMapPoint[]>(() => {
    const shown = warehouses.filter((w) => !hidden.has(w.category));
    // Count per city AFTER the category filter, so the colour tracks what is drawn.
    const countByCity = new Map<string, number>();
    for (const w of shown)
      countByCity.set(locKey(w.loc), (countByCity.get(locKey(w.loc)) ?? 0) + 1);

    return shown.map((w, i) => {
      const count = countByCity.get(locKey(w.loc)) ?? 1;
      return {
        id: `${w.eik}-${i}`,
        loc: w.loc,
        value: count, // ranks cities by size + picks the marker colour
        color: bandColor(count),
        badge: 1, // each warehouse contributes 1 → marker shows the city count
        title: w.name,
        subtitle: `${exciseCategoryLabel(w.category, lang)}${
          w.place ? ` · ${w.place}` : ""
        }`,
        href: `/company/${w.eik}`,
      };
    });
  }, [warehouses, hidden, lang]);

  if (!warehouses.length) return null;

  const toggleCat = (id: ExciseCategory) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const shownCount = points.length;

  return (
    <Card data-og="customs-warehouse-map">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <MapIcon className="h-4 w-4" />
          {bg ? "Данъчни складове по градове" : "Excise warehouses by city"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        {/* Category filter */}
        {presentCats.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {presentCats.map((c) => {
              const on = !hidden.has(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleCat(c.id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                    on
                      ? "border-primary/40 bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground/60 line-through",
                  )}
                >
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ background: c.color }}
                  />
                  {exciseCategoryLabel(c.id, lang)}
                </button>
              );
            })}
          </div>
        )}

        <SectorPointMap
          points={points}
          groupNoun={bg ? "склада" : "warehouses"}
          openLabel={bg ? "Виж фирмата" : "View company"}
        />

        {/* Legend + caption */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span>{bg ? "Складове в града:" : "Warehouses in the city:"}</span>
          {BANDS.map((b) => (
            <span key={b.label} className="inline-flex items-center gap-1">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: b.color }}
              />
              {b.label}
            </span>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? `Всеки маркер е един град; числото е броят действащи данъчни складове там, а цветът — същият брой. Показани ${shownCount} склада. Градовете с няколко склада се разгръщат в изскачащата карта, а всеки склад води към страницата на оператора. Източник: Агенция „Митници“ (регистър BACIS).`
            : `Each marker is one city; the number is how many active excise warehouses sit there, and the colour tracks that count. Showing ${shownCount} warehouses. Cities with several warehouses page through them in the popup, and each links to its operator's page. Source: Customs Agency (BACIS register).`}
        </p>
      </CardContent>
    </Card>
  );
};
