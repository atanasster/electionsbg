import { fetchData } from "./dataClient";
import type { ToolDef } from "./types";
type WaterYear = {
  year: number;
  connectedWaterPct: number | null;
  wasteTreatmentPct: number | null;
  rationingPct: number | null;
};
export const WATER_TOOL: ToolDef = {
  name: "waterServices",
  domain: "indicators",
  description: {
    bg: "Национален дял на населението с водоснабдяване, пречистване и воден режим по години.",
    en: "National population shares with water supply, wastewater treatment and rationing by year.",
  },
  params: [],
  examples: [
    {
      bg: "Какъв дял от населението е на воден режим по години?",
      en: "What share of the population has water rationing by year?",
    },
  ],
  run: async (_args, ctx) => {
    const data = await fetchData<{
      years: WaterYear[];
      source: string;
      sourceUrl: string;
    }>("/water/water_stats.json");
    const bg = ctx.lang === "bg";
    return {
      tool: "waterServices",
      domain: "indicators",
      kind: "table",
      viz: "none",
      title: bg
        ? "Водни услуги — дял от населението по години"
        : "Water services — population shares by year",
      subtitle: bg
        ? "Национални годишни данни на НСИ. Не са списък на населени места с режим днес и не измерват загубите по мрежата."
        : "Annual national NSI data. This is not a list of places with rationing today and does not measure network water losses.",
      columns: [
        { key: "year", label: bg ? "Година" : "Year" },
        {
          key: "connectedWaterPct",
          label: bg ? "Водоснабдяване (%)" : "Water supply (%)",
          numeric: true,
        },
        {
          key: "wasteTreatmentPct",
          label: bg ? "Пречистване (%)" : "Wastewater treatment (%)",
          numeric: true,
        },
        {
          key: "rationingPct",
          label: bg ? "Воден режим (%)" : "Water rationing (%)",
          numeric: true,
        },
      ],
      rows: data.years.map((y) => ({
        year: y.year,
        connectedWaterPct: y.connectedWaterPct,
        wasteTreatmentPct: y.wasteTreatmentPct,
        rationingPct: y.rationingPct,
      })),
      facts: {
        unit: "percent of population",
        geography: "Bulgaria",
        latestYear: data.years.length
          ? Math.max(...data.years.map((y) => y.year))
          : "unavailable",
        source: data.source,
        sourceUrl: data.sourceUrl,
      },
      provenance: ["water/water_stats.json"],
    };
  },
};
