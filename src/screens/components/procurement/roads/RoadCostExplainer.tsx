// „Какво влияе на цената на километър" — the static explainer beside the €/km
// tiles: why a unit cost is not comparable across work types and terrain, and
// the rough international reference levels (ROAD_EUR_PER_KM).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { ROAD_EUR_PER_KM, eurPerKmMln } from "@/lib/roadBenchmarks";

export const RoadCostExplainer: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const { rocks, bgLo, bgHi, ro, gr } = ROAD_EUR_PER_KM;
  const km = (v: number) => eurPerKmMln(v, lang);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          {lang === "bg"
            ? "Какво влияе на цената на километър"
            : "What drives cost per kilometre"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 text-sm text-muted-foreground">
        {lang === "bg" ? (
          <>
            <p>
              Цената на километър не е сравнима между различни видове работа и
              терен. Ново строителство на автомагистрала, основен ремонт на път
              III клас и съоръжения (мостове, тунели) се различават многократно
              — тунелните участъци достигат десетки милиони на километър. Затова
              сравняваме всеки участък спрямо вътрешен еталон за същия клас път
              и вид работа, а не директно с други държави.
            </p>
            <p className="mt-2 text-xs">
              За груб ориентир (не пряко сравнение): ново строителство на
              магистрала в България е средно около €{km(bgLo)}–{km(bgHi)}{" "}
              млн/км, в Румъния ~€{km(ro)} млн/км, в Гърция ~€{km(gr)} млн/км;
              базата на Световната банка (ROCKS) дава ~€{km(rocks)} млн/км за
              двулентов път без съоръжения.
            </p>
          </>
        ) : (
          <>
            <p>
              Cost per kilometre is not comparable across work types or terrain.
              New motorway construction, major rehabilitation of a class III
              road and structures (bridges, tunnels) differ by an order of
              magnitude — tunnel sections reach tens of millions per kilometre.
              Each segment is therefore benchmarked against an internal
              reference class for the same road class and work type, not
              directly against other countries.
            </p>
            <p className="mt-2 text-xs">
              As a rough, non-comparable benchmark: new motorway construction
              averages ~€{km(bgLo)}–{km(bgHi)}M/km in Bulgaria, ~€{km(ro)}M/km
              in Romania, ~€{km(gr)}M/km in Greece; the World Bank ROCKS
              database gives ~€{km(rocks)}M/km for a two-lane road excluding
              structures.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
};
