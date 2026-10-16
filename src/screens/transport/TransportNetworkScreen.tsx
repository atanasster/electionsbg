// /sector/transport/network — the project map: the railway sections, stations,
// ports and airports the contract TITLES name (migration 076). Plan:
// docs/plans/transport-hub-v1.md §3 (#map).
//
// ?mode=<universe> filters the bodies the map draws — the hub's rail / ports /
// aviation tiles link here with it. Validated on read: an unknown value is
// ignored and the whole sector is drawn, never an empty map.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { isBg } from "@/i18n";
import { transportUniverseLabel } from "@/lib/transportReferenceData";
import { TransportPageFrame } from "./TransportPageFrame";
import { TransportModePicker } from "./TransportModePicker";
import { useTransportMode } from "./transportMode";
import { TransportProjectMap } from "./TransportProjectMap";

export const TransportNetworkScreen: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  const { mode, eiks } = useTransportMode();
  return (
    <TransportPageFrame
      title={{
        bg: "Транспортната мрежа на карта",
        en: "The transport network on a map",
      }}
      description={{
        bg: "Жп участъците, гарите, пристанищата и летищата, назовани в договорите на държавния транспорт — по вложени средства и по дела на договорите с една оферта.",
        en: "The railway sections, stations, ports and airports named in the state transport bodies' contracts — by money spent and by the share of single-bidder contracts.",
      }}
      scoped
      controls={<TransportModePicker />}
      ready={[mode]}
    >
      <p className="text-sm text-muted-foreground">
        {mode
          ? bg
            ? `Картата показва договорите на структурите от вида „${transportUniverseLabel(mode, lang)}“.`
            : `The map shows the contracts of the ${transportUniverseLabel(mode, lang)} bodies.`
          : bg
            ? "Картата показва договорите на всички структури в сектора. Изберете вид транспорт, за да видите само неговите."
            : "The map shows the contracts of every body in the sector. Pick a mode to see only its own."}
      </p>
      <section id="map" className="scroll-mt-24">
        <TransportProjectMap eiks={eiks} />
      </section>
    </TransportPageFrame>
  );
};
