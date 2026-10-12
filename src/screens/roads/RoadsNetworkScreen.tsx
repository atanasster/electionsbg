// /sector/roads/network — the motorway map and the km-coverage strip.
//
// ?corridor=<id> seeds the map's focused corridor (the hub's evidence rail links
// here with it). The map is controlled, so the URL is the state: clicking a
// corridor writes it back, and a shared link reopens on the same corridor. An
// id the model does not know is ignored rather than drawn as an empty focus.

import { FC, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { isBg } from "@/i18n";
import { RoadNetworkCard } from "@/screens/components/procurement/roads/RoadNetworkCard";
import { RoadChainageStripTile } from "@/screens/components/procurement/roads/RoadChainageStripTile";
import type { RoadsModel } from "@/lib/roadAttributes";
import { RoadsPageFrame } from "./RoadsPageFrame";

const NetworkBody: FC<{ model: RoadsModel }> = ({ model }) => {
  const { i18n } = useTranslation();
  const bg = isBg(i18n.language);
  const pct = (v: number) =>
    new Intl.NumberFormat(bg ? "bg-BG" : "en-GB", {
      maximumFractionDigits: 1,
    }).format(v * 100) + "%";
  const [params, setParams] = useSearchParams();
  const raw = params.get("corridor");
  const focus =
    raw && model.corridors.some((c) => c.corridor === raw) ? raw : null;
  const setFocus = useCallback(
    (c: string | null) =>
      setParams(
        (p) => {
          const next = new URLSearchParams(p);
          if (c) next.set("corridor", c);
          else next.delete("corridor");
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );
  return (
    <>
      <p className="text-sm text-muted-foreground">
        {bg
          ? `${pct(model.refCoverageEur)} от стойността в избрания период е по договори с назован път — само те са на картата; останалото са областни и мрежови поръчки без единен коридор.`
          : `${pct(model.refCoverageEur)} of the value in the selected window is in contracts that name a road — only those are on the map; the rest are regional and network-wide lots with no single corridor.`}
      </p>
      <RoadNetworkCard
        corridors={model.corridors}
        focusCorridor={focus}
        onFocusCorridor={setFocus}
      />
      <RoadChainageStripTile rows={model.rows} />
    </>
  );
};

export const RoadsNetworkScreen: FC = () => (
  <RoadsPageFrame
    title={{ bg: "Пътната мрежа", en: "The road network" }}
    description={{
      bg: "Магистралите и републиканските пътища на карта по вложени средства и конкуренция, и покритието по километри на всяка магистрала — по договорите на АПИ и НКСИП.",
      en: "Bulgaria's motorways and national roads mapped by money spent and competition, with kilometre coverage along each motorway — from АПИ and НКСИП contracts.",
    }}
  >
    {(model) => <NetworkBody model={model} />}
  </RoadsPageFrame>
);
