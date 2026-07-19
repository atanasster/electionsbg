// Dependency-free canonical shapes for the energy data files (data/energy/*.json),
// shared by the React hooks (src/data/energy/*) AND the AI tools (ai/tools/energy.ts,
// which imports this by relative path — the ai/ ↔ @/data alias boundary is
// lint-enforced, so a React-free module is the only safe sharing seam). Mirrors
// src/data/defense/types. Keep field names stable — the ingest scripts write them
// and both the hooks and the tools read them.

export interface EnergyYear {
  year: number;
  byFuel: Record<string, number>;
  totalGen: number | null;
  demand: number | null;
  /** Negative = net exporter. */
  netImports: number | null;
  co2Intensity: number | null; // gCO2/kWh
  totalEmissions: number | null; // mtCO2
}

export interface EnergyGeneration {
  updated: string;
  source: string;
  sourceUrl: string;
  latestYear: number;
  years: EnergyYear[];
}

export interface PricePoint {
  period: string; // e.g. "2025-S2"
  value: number; // EUR/kWh
}

export interface EnergyPrices {
  updated: string;
  source: string;
  sourceUrl: string;
  unit: string;
  latest: string;
  // BG + the EU27 benchmark are always present; the four neighbour peers
  // (RO/GR/HU/HR — GR is Eurostat's EL remapped) are added for the trend chart.
  series: {
    BG: PricePoint[];
    EU27: PricePoint[];
    RO?: PricePoint[];
    GR?: PricePoint[];
    HU?: PricePoint[];
    HR?: PricePoint[];
  };
}

// Canonical fuel key + bilingual label, in the fixed display order (the eye
// learns "nuclear is amber"). The single source of truth shared by the tile
// (which extends each with a colour) and the AI generationMix tool.
export const ENERGY_FUELS: { key: string; bg: string; en: string }[] = [
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

export const RENEWABLE_KEYS = [
  "hydro",
  "solar",
  "wind",
  "bioenergy",
  "otherRenewables",
];

// ── Power-plant fleet (asset-level tracker) ─────────────────────────────────
export type PlantFuel = "nuclear" | "coal" | "hydro" | "gas" | "wind" | "solar";

export type PlantOwnership = "state" | "jv" | "private" | "municipal";

export type PlantStatus = "operating" | "planned" | "retiring";

export interface PowerPlant {
  id: string;
  name: { bg: string; en: string };
  fuel: PlantFuel;
  /** Installed capacity, MW. null for aggregate rows (wind/solar fleets). */
  capacityMw: number | null;
  owner: { bg: string; en: string };
  ownership: PlantOwnership;
  /** Operator EIK — links to its page when it exists in our data. */
  eik?: string;
  /** true → /awarder/:eik (state procurer), false/undefined → /company/:eik. */
  isAwarder?: boolean;
  commissioned?: number;
  /** Planned retirement / phase-out year. */
  retire?: number;
  status: PlantStatus;
  note?: { bg: string; en: string };
}

export interface PowerPlantsFile {
  updated: string;
  source: string;
  sourceUrl: string;
  /** Coal phase-out target year (national strategy). */
  coalExitYear: number;
  plants: PowerPlant[];
}

export interface PriceComparison {
  period: string;
  bg: number; // EUR/kWh
  eu: number; // EUR/kWh
  pctOfEu: number;
}

/** The BG-vs-EU comparison anchored to the latest period present in BOTH series.
 *  EU27 aggregates can lag member-state releases, so picking each series' own last
 *  point would divide two different half-years and mislabel the period. Returns
 *  null only if the series never overlap (should not happen). */
export const latestCommonPrice = (
  data: EnergyPrices,
): PriceComparison | null => {
  const euByPeriod = new Map(data.series.EU27.map((p) => [p.period, p.value]));
  for (let i = data.series.BG.length - 1; i >= 0; i--) {
    const bgp = data.series.BG[i];
    const eu = euByPeriod.get(bgp.period);
    if (eu != null && eu > 0) {
      return {
        period: bgp.period,
        bg: bgp.value,
        eu,
        pctOfEu: Math.round((bgp.value / eu) * 100),
      };
    }
  }
  return null;
};
