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
  series: { BG: PricePoint[]; EU27: PricePoint[] };
}
