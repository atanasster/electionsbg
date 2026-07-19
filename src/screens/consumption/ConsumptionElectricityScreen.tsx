// /consumption/electricity — "Ток", household electricity prices in Bulgaria vs
// the EU and the neighbour peers (RO/GR/HU/HR). Eurostat nrg_pc_204 (all taxes,
// 2500-4999 kWh band, EUR/kWh), bi-annual since 2007. Bulgaria has among the
// LOWEST household electricity prices in the EU. Thin wrapper over the shared
// EnergyPriceTrendScreen (see also ConsumptionGasScreen).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Zap } from "lucide-react";
import { useEnergyPrices } from "@/data/energy/useEnergyPrices";
import { EnergyPriceTrendScreen } from "./EnergyPriceTrendScreen";

export const ConsumptionElectricityScreen: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const lang: "bg" | "en" = bg ? "bg" : "en";
  const T = (b: string, e: string) => (bg ? b : e);
  const { data } = useEnergyPrices();

  return (
    <EnergyPriceTrendScreen
      data={data}
      lang={lang}
      icon={Zap}
      seoTitle={T("Ток · Потребление", "Electricity · Consumption")}
      seoDescription={T(
        "Цената на тока за домакинствата в България спрямо ЕС и съседните държави — с всички данъци (EUR/кВтч), Eurostat. България е сред най-ниските в съюза.",
        "Household electricity prices in Bulgaria vs the EU and neighbours — all taxes (EUR/kWh), Eurostat. Bulgaria is among the lowest in the union.",
      )}
      breadcrumb={T("Ток", "Electricity")}
      title={T("Ток", "Electricity")}
      sectionTitle={T("Ток спрямо ЕС", "Electricity vs the EU")}
      subtitleBase={T(
        "домакинства · с всички данъци",
        "households · all taxes",
      )}
      statLabel={T("Ток за домакинствата", "Household electricity")}
      unitLabel={T("кВтч", "kWh")}
      valueDp={3}
      formatY={(v) => v.toFixed(2)}
      note={
        <>
          {T(
            "Потребителски цени с всички данъци, band 2500-4999 kWh (Eurostat). Токът за българските домакинства е трайно под средното за ЕС — около половината.",
            "Consumer prices incl. all taxes, 2500-4999 kWh band (Eurostat). Bulgarian household electricity is consistently below the EU average — about half.",
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
