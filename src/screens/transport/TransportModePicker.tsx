// The labelled ?mode picker beside a page's content (never over the map — O11).
// „Целият сектор" clears the param.

import { FC } from "react";
import { isBg } from "@/i18n";
import { useTranslation } from "react-i18next";
import { PackSelect } from "@/screens/components/procurement/PackSelect";
import {
  TRANSPORT_UNIVERSES,
  transportUniverseLabel,
  type TransportUniverse,
} from "@/lib/transportReferenceData";
import { useTransportMode } from "./transportMode";

type Value = TransportUniverse | "all";

export const TransportModePicker: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  const { mode, setMode } = useTransportMode();
  const label = bg ? "Вид транспорт" : "Transport mode";
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      <span>{label}</span>
      <PackSelect<Value>
        value={mode ?? "all"}
        onChange={(v) => setMode(v === "all" ? null : v)}
        ariaLabel={label}
        align="start"
        options={[
          { value: "all", label: bg ? "Целият сектор" : "The whole sector" },
          ...TRANSPORT_UNIVERSES.map((u) => ({
            value: u as Value,
            label: transportUniverseLabel(u, lang),
          })),
        ]}
      />
    </label>
  );
};
