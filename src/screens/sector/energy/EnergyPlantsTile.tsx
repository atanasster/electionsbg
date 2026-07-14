// Asset-level power-plant tracker for /sector/energy — every significant plant
// that generates the country's electricity, who owns it (state / JV / private),
// its capacity and its retirement year. The physical companion to the БЕХ
// procurement pack (state awarders only) and the national Ember mix (no per-plant
// detail): it answers "we only see 2 state coal plants — but there are 6, and the
// private ones are where the ownership opacity lives". Data: curated from Global
// Energy Monitor + the contracts corpus.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { usePowerPlants } from "@/data/energy/usePowerPlants";
import type {
  PlantFuel,
  PlantOwnership,
  PowerPlant,
} from "@/data/energy/types";

const FUEL_ORDER: PlantFuel[] = [
  "nuclear",
  "coal",
  "hydro",
  "gas",
  "wind",
  "solar",
];
const FUEL_LABEL: Record<PlantFuel, { bg: string; en: string; color: string }> =
  {
    nuclear: { bg: "Ядрена", en: "Nuclear", color: "#b07d2f" },
    coal: { bg: "Въглища", en: "Coal", color: "#6b5544" },
    hydro: { bg: "ВЕЦ", en: "Hydro", color: "#3f6a8a" },
    gas: { bg: "Газ", en: "Gas", color: "#c9702f" },
    wind: { bg: "Вятърна", en: "Wind", color: "#4a9b8f" },
    solar: { bg: "Слънчева", en: "Solar", color: "#d9a441" },
  };

const OWNERSHIP: Record<
  PlantOwnership,
  { bg: string; en: string; color: string }
> = {
  state: { bg: "държавна", en: "state", color: "#3a7a5e" },
  jv: { bg: "смесена", en: "JV", color: "#b07d2f" },
  private: { bg: "частна", en: "private", color: "#8a8f98" },
  municipal: { bg: "общинска", en: "municipal", color: "#3f6a8a" },
};

const PlantRow: FC<{ plant: PowerPlant; max: number; bg: boolean }> = ({
  plant,
  max,
  bg,
}) => {
  const own = OWNERSHIP[plant.ownership];
  const name = bg ? plant.name.bg : plant.name.en;
  const to = plant.eik
    ? `${plant.isAwarder ? "/awarder/" : "/company/"}${plant.eik}`
    : null;
  const mw = plant.capacityMw;
  return (
    <div className="flex items-center gap-2 py-0.5 text-sm">
      <div className="w-[40%] min-w-0 truncate" title={name}>
        {to ? (
          <Link to={to} className="text-primary hover:underline">
            {name}
          </Link>
        ) : (
          name
        )}
      </div>
      <span
        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium"
        style={{ color: own.color, backgroundColor: `${own.color}22` }}
      >
        {bg ? own.bg : own.en}
      </span>
      <div className="relative h-3 flex-1 overflow-hidden rounded bg-muted/40">
        {mw != null && (
          <div
            className="absolute inset-y-0 left-0 rounded"
            style={{
              width: `${Math.max(2, (mw / max) * 100)}%`,
              backgroundColor: FUEL_LABEL[plant.fuel].color,
            }}
          />
        )}
      </div>
      {plant.status === "planned" && (
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {bg ? "планирана" : "planned"}
        </span>
      )}
      {plant.retire && (
        <span
          className="shrink-0 text-[10px] text-[#c14b57]"
          title={bg ? "планиран извод от експлоатация" : "planned retirement"}
        >
          {bg ? `закрива ${plant.retire}` : `closes ${plant.retire}`}
        </span>
      )}
      <div className="w-20 shrink-0 whitespace-nowrap text-right tabular-nums text-muted-foreground">
        {mw != null ? `${mw.toLocaleString()} MW` : "—"}
      </div>
    </div>
  );
};

export const EnergyPlantsTile: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const { data } = usePowerPlants();
  if (!data) return null;

  const plants = data.plants;
  const max = Math.max(...plants.map((p) => p.capacityMw ?? 0)) || 1;
  const totalMw = plants.reduce((a, p) => a + (p.capacityMw ?? 0), 0);
  // state + JV (partial-state) count as state-linked capacity.
  const stateMw = plants
    .filter((p) => p.ownership === "state" || p.ownership === "jv")
    .reduce((a, p) => a + (p.capacityMw ?? 0), 0);
  const coalPlants = plants.filter((p) => p.fuel === "coal");
  const statePct = totalMw > 0 ? Math.round((stateMw / totalMw) * 100) : 0;

  return (
    <Card className="md:col-span-2">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          {bg ? "Електроцентрали" : "Power plants"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        {/* fleet summary */}
        <div className="mb-3 grid grid-cols-3 gap-3">
          <div>
            <div className="text-lg font-semibold tabular-nums">
              ~{(totalMw / 1000).toFixed(1)} GW
            </div>
            <div className="text-xs text-muted-foreground">
              {bg ? "Обща инсталирана мощност" : "Total installed capacity"}
            </div>
          </div>
          <div>
            <div className="text-lg font-semibold tabular-nums">
              {statePct}%
            </div>
            <div className="text-xs text-muted-foreground">
              {bg ? "държавна/смесена" : "state / JV"}
            </div>
          </div>
          <div>
            <div className="text-lg font-semibold tabular-nums">
              {coalPlants.length}
            </div>
            <div className="text-xs text-muted-foreground">
              {bg
                ? `въглищни ТЕЦ · закриване до ${data.coalExitYear}`
                : `coal plants · closure by ${data.coalExitYear}`}
            </div>
          </div>
        </div>

        {/* plants grouped by fuel */}
        <div className="space-y-2">
          {FUEL_ORDER.map((fuel) => {
            const rows = plants
              .filter((p) => p.fuel === fuel)
              .sort((a, b) => (b.capacityMw ?? 0) - (a.capacityMw ?? 0));
            if (rows.length === 0) return null;
            const fl = FUEL_LABEL[fuel];
            return (
              <div key={fuel}>
                <div className="mb-0.5 flex items-center gap-1.5 text-xs font-medium">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-sm"
                    style={{ backgroundColor: fl.color }}
                  />
                  {bg ? fl.bg : fl.en}
                </div>
                {rows.map((p) => (
                  <PlantRow key={p.id} plant={p} max={max} bg={bg} />
                ))}
              </div>
            );
          })}
        </div>

        <div className="mt-3 text-[11px] text-muted-foreground">
          {bg ? "Източник: " : "Source: "}
          Global Energy Monitor +{" "}
          {bg ? "регистър на договорите" : "contracts corpus"}
        </div>
      </CardContent>
    </Card>
  );
};
