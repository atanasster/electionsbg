// Енергетика (energy) tools — the physical-system layer beside the БЕХ
// procurement pack, over the committed data/energy/ files:
//
//   generationMix     /energy/generation.json — the electricity generation mix
//                     by fuel, net electricity trade and CO2 intensity
//   electricityPrices /energy/prices.json      — household electricity price,
//                     Bulgaria vs the EU average
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
} from "../../src/data/energy/types";

// Fixed fuel order + bilingual labels (mirrors the EnergyGenerationTile).
const FUELS: { key: string; bg: string; en: string }[] = [
  { key: "nuclear", bg: "Ядрена", en: "Nuclear" },
  { key: "coal", bg: "Въглища", en: "Coal" },
  { key: "gas", bg: "Газ", en: "Gas" },
  { key: "hydro", bg: "ВЕЦ", en: "Hydro" },
  { key: "solar", bg: "Слънчева", en: "Solar" },
  { key: "wind", bg: "Вятърна", en: "Wind" },
  { key: "bioenergy", bg: "Биомаса", en: "Bioenergy" },
  { key: "otherFossil", bg: "Друго изкопаемо", en: "Other fossil" },
  { key: "otherRenewables", bg: "Друго ВЕИ", en: "Other renewables" },
];
const RENEWABLE_KEYS = [
  "hydro",
  "solar",
  "wind",
  "bioenergy",
  "otherRenewables",
];

// "Откъде идва токът?" — the latest-year generation mix, net export and carbon
// intensity. BG is a nuclear-heavy NET EXPORTER on a decarbonising path.
export const generationMix = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const data = await fetchData<EnergyGeneration>("/energy/generation.json");
  const y = data.years[data.years.length - 1];

  const segs = FUELS.map((fLabel) => ({
    ...fLabel,
    twh: y.byFuel[fLabel.key] ?? 0,
  })).filter((s) => s.twh > 0);
  const sum = segs.reduce((a, s) => a + s.twh, 0) || 1;
  const pct = (k: string) => Math.round(((y.byFuel[k] ?? 0) / sum) * 100);
  const renewPct = Math.round(
    (RENEWABLE_KEYS.reduce((a, k) => a + (y.byFuel[k] ?? 0), 0) / sum) * 100,
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

// "Колко струва токът в България спрямо ЕС?" — the household electricity price
// path, BG vs the EU average. BG is among the LOWEST in the EU.
export const electricityPrices = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const data = await fetchData<EnergyPrices>("/energy/prices.json");
  const bgS = data.series.BG;
  const euS = data.series.EU27;
  const lb = bgS[bgS.length - 1];
  const le = euS[euS.length - 1];
  const pctOfEu = le.value > 0 ? Math.round((lb.value / le.value) * 100) : 0;
  const eur = (v: number) => `€${v.toFixed(3)}/kWh`;

  return {
    tool: "electricityPrices",
    domain: "indicators",
    kind: "series",
    title: bg
      ? "Цена на тока за домакинствата — България и ЕС"
      : "Household electricity price — Bulgaria vs the EU",
    subtitle: bg
      ? "С всички данъци, EUR/kWh · източник: Eurostat (nrg_pc_204)"
      : "All taxes, EUR/kWh · source: Eurostat (nrg_pc_204)",
    categories: bgS.map((p) => p.period),
    series: [
      {
        key: "bg",
        label: bg ? "България" : "Bulgaria",
        points: bgS.map((p) => ({ x: p.period, y: p.value })),
      },
      {
        key: "eu",
        label: bg ? "ЕС (средно)" : "EU average",
        points: euS.map((p) => ({ x: p.period, y: p.value })),
      },
    ],
    viz: "line",
    facts: {
      period: lb.period,
      bg_price: eur(lb.value),
      eu_price: eur(le.value),
      pct_of_eu: `${pctOfEu}%`,
    },
    provenance: ["energy/prices.json"],
  };
};
