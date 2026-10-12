// The motorway-network map card — the roads sector's hero visual, shared by the
// /sector/roads/network page and the (awarder-suppressed) RoadsPack. The focused
// corridor is CONTROLLED by the caller, so a page can seed it from the URL
// (?corridor=) and the map stays a pure view.
//
// data-og: the OG-card anchor (scripts/og/capture-screens.ts).

import { FC, useState } from "react";
import { useTranslation } from "react-i18next";
import { Waypoints, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { PackSelect } from "../PackSelect";
import type { CorridorAgg } from "@/lib/roadAttributes";
import { RoadNetworkMap, type RoadMetric } from "./RoadNetworkMap";

export const RoadNetworkCard: FC<{
  corridors: CorridorAgg[];
  focusCorridor: string | null;
  onFocusCorridor: (c: string | null) => void;
}> = ({ corridors, focusCorridor, onFocusCorridor }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const [mapMetric, setMapMetric] = useState<RoadMetric>("singleBid");

  return (
    <Card data-og="roads-map">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Waypoints className="h-4 w-4" />
            {lang === "bg" ? "Магистрална мрежа" : "Motorway network"}
            {focusCorridor ? (
              <button
                type="button"
                onClick={() => onFocusCorridor(null)}
                aria-label={
                  lang === "bg"
                    ? `Премахни избора на ${focusCorridor}`
                    : `Clear the ${focusCorridor} selection`
                }
                className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
              >
                {focusCorridor}
                <X className="h-3 w-3" />
              </button>
            ) : null}
          </CardTitle>
          <PackSelect
            value={mapMetric}
            onChange={setMapMetric}
            ariaLabel={lang === "bg" ? "Показател на картата" : "Map metric"}
            className="h-8 min-w-0"
            options={[
              {
                value: "singleBid" as RoadMetric,
                label: lang === "bg" ? "Една оферта" : "Single bidder",
              },
              {
                value: "perKm" as RoadMetric,
                label:
                  lang === "bg" ? "Цена на километър" : "Cost per kilometre",
              },
            ]}
          />
        </div>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <RoadNetworkMap
          corridors={corridors}
          metric={mapMetric}
          focusCorridor={focusCorridor}
          onFocusCorridor={onFocusCorridor}
        />
        <p className="text-[11px] text-muted-foreground/80 mt-2">
          {lang === "bg"
            ? "Автомагистрали и финансирани републикански пътища (I и II клас). Дебелината на линията показва вложените средства. Кликни коридор, за да го откроиш на картата."
            : "Motorways and funded republican roads (class I and II). Line thickness reflects € spent. Click a corridor to highlight it on the map."}
        </p>
      </CardContent>
    </Card>
  );
};
