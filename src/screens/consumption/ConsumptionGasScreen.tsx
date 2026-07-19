// /consumption/gas — "Природен газ", household natural-gas prices in Bulgaria vs
// the EU and the neighbour peers (RO/GR/HU/HR). Eurostat nrg_pc_202 (all taxes,
// 20-199 GJ band, EUR/kWh), bi-annual since 2007. Like electricity, BG household
// gas sits among the cheapest in the EU (~half the average). Thin wrapper over the
// shared EnergyPriceTrendScreen (see also ConsumptionElectricityScreen).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Flame } from "lucide-react";
import { useGasPrices } from "@/data/energy/useEnergyPrices";
import { EnergyPriceTrendScreen } from "./EnergyPriceTrendScreen";

export const ConsumptionGasScreen: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const lang: "bg" | "en" = bg ? "bg" : "en";
  const T = (b: string, e: string) => (bg ? b : e);
  const { data } = useGasPrices();

  return (
    <EnergyPriceTrendScreen
      data={data}
      lang={lang}
      icon={Flame}
      seoTitle={T("Природен газ · Потребление", "Natural gas · Consumption")}
      seoDescription={T(
        "Цената на природния газ за домакинствата в България спрямо ЕС и съседните държави — с всички данъци (EUR/кВтч), Eurostat. България е сред най-ниските в съюза.",
        "Household natural-gas prices in Bulgaria vs the EU and neighbours — all taxes (EUR/kWh), Eurostat. Bulgaria is among the lowest in the union.",
      )}
      breadcrumb={T("Природен газ", "Natural gas")}
      title={T("Природен газ", "Natural gas")}
      sectionTitle={T("Природен газ спрямо ЕС", "Natural gas vs the EU")}
      subtitleBase={T(
        "домакинства · с всички данъци",
        "households · all taxes",
      )}
      statLabel={T("Газ за домакинствата", "Household gas")}
      unitLabel={T("кВтч", "kWh")}
      valueDp={3}
      formatY={(v) => v.toFixed(2)}
      note={
        <>
          {T(
            "Потребителски цени с всички данъци, band 20-199 GJ (Eurostat). Малка част от домакинствата у нас ползват мрежов газ, но цената е сред най-ниските в ЕС.",
            "Consumer prices incl. all taxes, 20-199 GJ band (Eurostat). Only a small share of Bulgarian households use piped gas, but the price is among the lowest in the EU.",
          )}{" "}
          <a
            href={data?.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            {data?.source}
          </a>
        </>
      }
    />
  );
};
