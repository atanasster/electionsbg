// Енергетика (energy) tools — the physical-system layer beside the БЕХ
// procurement pack, over the committed data/energy/ files:
//
//   generationMix     /energy/generation.json — the electricity generation mix
//                     by fuel, net electricity trade and CO2 intensity
//   electricityPrices /energy/prices.json      — household electricity price,
//                     Bulgaria vs the EU average + RO/GR/HU/HR peers
//   gasPrices         /energy/gas_prices.json  — household natural-gas price,
//                     Bulgaria vs the EU average + RO/GR/HU/HR peers
//
// Mirrors the defense/culture tools' Envelope shape; every fact goes through
// ctx.lang and the tool never computes prose numbers — narrate() reads env.facts.
// Types come from the dependency-free src/data/energy/types module (the ai/ ↔
// @/data alias boundary is lint-enforced; that module has no React deps).

import { fetchData } from "./dataClient";
import type { Envelope, ToolArgs, ToolContext } from "./types";
import type {
  EnergyGeneration,
  EnergyPrices,
  PowerPlantsFile,
} from "../../src/data/energy/types";
import {
  ENERGY_FUELS,
  RENEWABLE_KEYS,
  latestCommonPrice,
} from "../../src/data/energy/types";

// "Откъде идва токът?" — the latest-year generation mix, net export and carbon
// intensity. BG is a nuclear-heavy NET EXPORTER on a decarbonising path.
export const generationMix = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const data = await fetchData<EnergyGeneration>("/energy/generation.json");
  const y = data.years[data.years.length - 1];

  const segs = ENERGY_FUELS.map((fLabel) => ({
    ...fLabel,
    twh: y.byFuel[fLabel.key] ?? 0,
  })).filter((s) => s.twh > 0);
  const sum = segs.reduce((a, s) => a + s.twh, 0) || 1;
  // Reconcile against the reported Total Generation when present (it equals the
  // fuel-breakdown sum while FUEL_KEY is complete; fall back to the sum otherwise).
  const denom = y.totalGen && y.totalGen > 0 ? y.totalGen : sum;
  const pct = (k: string) => Math.round(((y.byFuel[k] ?? 0) / denom) * 100);
  const renewPct = Math.round(
    (RENEWABLE_KEYS.reduce((a, k) => a + (y.byFuel[k] ?? 0), 0) / denom) * 100,
  );
  const net = y.netImports ?? 0;
  const exporter = net < 0;

  return {
    tool: "generationMix",
    domain: "indicators",
    kind: "series",
    title: bg
      ? `Производство на ток по източник (${y.year})`
      : `Electricity generation by source (${y.year})`,
    subtitle: bg
      ? `Общо ${y.totalGen ?? "—"} TWh · източник: Ember (CC BY 4.0)`
      : `Total ${y.totalGen ?? "—"} TWh · source: Ember (CC BY 4.0)`,
    categories: segs.map((s) => (bg ? s.bg : s.en)),
    series: [
      {
        key: "twh",
        label: bg ? "Производство (TWh)" : "Generation (TWh)",
        points: segs.map((s) => ({ x: bg ? s.bg : s.en, y: s.twh })),
      },
    ],
    viz: "bar",
    facts: {
      latest_year: y.year,
      total_twh: y.totalGen ?? "—",
      nuclear_pct: `${pct("nuclear")}%`,
      coal_pct: `${pct("coal")}%`,
      renewables_pct: `${renewPct}%`,
      net_trade_twh: `${Math.abs(net).toFixed(1)} TWh`,
      net_trade_dir: exporter
        ? bg
          ? "нетен износ"
          : "net export"
        : bg
          ? "нетен внос"
          : "net import",
      co2_intensity:
        y.co2Intensity != null ? `${Math.round(y.co2Intensity)} gCO₂/kWh` : "—",
    },
    provenance: ["energy/generation.json"],
  };
};

// Neighbour peers shown alongside BG + the EU average on the price charts.
const PEER_META = [
  { key: "RO", bg: "Румъния", en: "Romania" },
  { key: "GR", bg: "Гърция", en: "Greece" },
  { key: "HU", bg: "Унгария", en: "Hungary" },
  { key: "HR", bg: "Хърватия", en: "Croatia" },
] as const;

// Shared builder for the two bi-annual household-price series (electricity, gas).
// BG + the EU average anchor the grounded facts; the RO/GR/HU/HR peers ride along
// as extra chart lines (present-only). The facts are BG-vs-EU so the assistant
// never narrates an ungrounded peer number.
const energyPriceEnvelope = (
  data: EnergyPrices,
  bg: boolean,
  cfg: {
    tool: string;
    titleBg: string;
    titleEn: string;
    subBg: string;
    subEn: string;
    provenance: string;
  },
): Envelope => {
  // Compare on the latest period present in BOTH series (EU27 can lag BG).
  const cmp = latestCommonPrice(data);
  const eur = (v: number) => `€${v.toFixed(3)}/kWh`;
  const lines = [
    { key: "bg", label: bg ? "България" : "Bulgaria", pts: data.series.BG },
    {
      key: "eu",
      label: bg ? "ЕС (средно)" : "EU average",
      pts: data.series.EU27,
    },
    ...PEER_META.flatMap((p) => {
      const pts = data.series[p.key];
      return pts && pts.length
        ? [{ key: p.key.toLowerCase(), label: bg ? p.bg : p.en, pts }]
        : [];
    }),
  ];

  return {
    tool: cfg.tool,
    domain: "indicators",
    kind: "series",
    title: bg ? cfg.titleBg : cfg.titleEn,
    subtitle: bg ? cfg.subBg : cfg.subEn,
    categories: data.series.BG.map((p) => p.period),
    series: lines.map((l) => ({
      key: l.key,
      label: l.label,
      points: l.pts.map((p) => ({ x: p.period, y: p.value })),
    })),
    viz: "line",
    facts: {
      period: cmp?.period ?? "—",
      bg_price: cmp ? eur(cmp.bg) : "—",
      eu_price: cmp ? eur(cmp.eu) : "—",
      pct_of_eu: cmp ? `${cmp.pctOfEu}%` : "—",
    },
    provenance: [cfg.provenance],
  };
};

// "Колко струва токът в България спрямо ЕС?" — the household electricity price
// path, BG vs the EU average + peers. BG is among the LOWEST in the EU.
export const electricityPrices = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const data = await fetchData<EnergyPrices>("/energy/prices.json");
  return energyPriceEnvelope(data, ctx.lang === "bg", {
    tool: "electricityPrices",
    titleBg: "Цена на тока за домакинствата — България и ЕС",
    titleEn: "Household electricity price — Bulgaria vs the EU",
    subBg: "С всички данъци, EUR/kWh · източник: Eurostat (nrg_pc_204)",
    subEn: "All taxes, EUR/kWh · source: Eurostat (nrg_pc_204)",
    provenance: "energy/prices.json",
  });
};

// "Колко струва природният газ за домакинствата?" — the household natural-gas
// price path, BG vs the EU average + peers. Like electricity, BG gas is ~half the
// EU average (though few BG households are on piped gas).
export const gasPrices = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const data = await fetchData<EnergyPrices>("/energy/gas_prices.json");
  return energyPriceEnvelope(data, ctx.lang === "bg", {
    tool: "gasPrices",
    titleBg: "Цена на природния газ за домакинствата — България и ЕС",
    titleEn: "Household natural-gas price — Bulgaria vs the EU",
    subBg: "С всички данъци, EUR/kWh · източник: Eurostat (nrg_pc_202)",
    subEn: "All taxes, EUR/kWh · source: Eurostat (nrg_pc_202)",
    provenance: "energy/gas_prices.json",
  });
};

// "Кои електроцентрали има в България?" — the plant fleet, foregrounding the coal
// plants and their ownership (state vs the private/opaque fleet). The physical
// companion to the state procurement pack, which lists only state awarders.
export const powerPlants = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const data = await fetchData<PowerPlantsFile>("/energy/plants.json");
  const coal = data.plants
    .filter((p) => p.fuel === "coal")
    .sort((a, b) => (b.capacityMw ?? 0) - (a.capacityMw ?? 0));
  const totalMw = data.plants.reduce((a, p) => a + (p.capacityMw ?? 0), 0);
  const stateMw = data.plants
    .filter((p) => p.ownership === "state" || p.ownership === "jv")
    .reduce((a, p) => a + (p.capacityMw ?? 0), 0);
  const coalState = coal.filter(
    (p) => p.ownership === "state" || p.ownership === "jv",
  ).length;

  return {
    tool: "powerPlants",
    domain: "indicators",
    kind: "series",
    title: bg ? "Въглищни централи в България" : "Bulgaria's coal power plants",
    subtitle: bg
      ? `Инсталирана мощност по централа · изход от въглищата до ${data.coalExitYear} г.`
      : `Installed capacity by plant · coal exit by ${data.coalExitYear}`,
    categories: coal.map((p) => (bg ? p.name.bg : p.name.en)),
    series: [
      {
        key: "mw",
        label: bg ? "Мощност (MW)" : "Capacity (MW)",
        points: coal.map((p) => ({
          x: bg ? p.name.bg : p.name.en,
          y: p.capacityMw,
        })),
      },
    ],
    viz: "bar",
    facts: {
      total_gw: `${(totalMw / 1000).toFixed(1)} GW`,
      state_share: `${Math.round((stateMw / totalMw) * 100)}%`,
      coal_plants: coal.length,
      coal_state: coalState,
      coal_private: coal.length - coalState,
      coal_exit: data.coalExitYear,
    },
    provenance: ["energy/plants.json"],
  };
};
