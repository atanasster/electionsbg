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

/** ⚠ Adding a member here is a decision about {@link isStateLinked} below — the
 *  "държавна/смесена" share on /sector/energy and in the powerPlants AI tool. */
export type PlantOwnership = "state" | "jv" | "private" | "municipal";

/** ⚠ Adding a member here is a decision about {@link isInstalled} below: it
 *  governs every fleet AGGREGATE (capacity total, state share, coal count) on
 *  /sector/energy and in the powerPlants AI tool. `INSTALLED_BY_STATUS` is
 *  exhaustive over this union, so a new member is a compile error until it is
 *  classified there — that is deliberate, and the reason this union is not
 *  widened casually. */
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

/** Which statuses count as capacity that exists TODAY.
 *
 *  ⚠ An ALLOW-LIST, and exhaustive over {@link PlantStatus} on purpose. A
 *  deny-list (`!== "planned"`) reads the same today and fails the wrong way
 *  tomorrow: widening the union with `"under-construction"` / `"cancelled"` /
 *  `"proposed"` would compile clean and silently count those rows as installed
 *  — the very defect below, reintroduced by a one-word edit. Typed as a total
 *  Record, a new status is a compile error until someone classifies it, and an
 *  unlisted status excluded merely UNDERSTATES, which is visible as a number
 *  that moved rather than invisible as one that is too big. */
const INSTALLED_BY_STATUS: Record<PlantStatus, boolean> = {
  operating: true,
  retiring: true, // generates today; only carries a phase-out date
  planned: false, // not built — see isInstalled
};

/** Does this plant exist TODAY? `planned` rows are listed for context (badged as
 *  such) but must never reach a fleet AGGREGATE — they are not installed
 *  capacity. `retiring` DOES count: those plants generate today and only have a
 *  phase-out date (2 528 MW and 7 share-points of the answer, so an over-eager
 *  "exclude anything with a retirement date" edit would be its own defect).
 *
 *  ⚠ The rule lives here, once, because both consumers had it wrong in the same
 *  way and neither could see the other: the /sector/energy plants tile and the
 *  powerPlants AI tool each summed `capacityMw` over every row, so the single
 *  planned AP1000 (АЕЦ Козлодуй 7/8, 2 300 MW) was reported as installed —
 *  overstating the fleet by 16.9% (15.9 GW against a real 13.6) and the
 *  state/JV share by 7 points, since it is state-owned and inflated numerator
 *  and denominator alike. The plants tile did this directly beneath a tile whose
 *  whole subject is that those units are NOT yet built. */
export const isInstalled = (p: PowerPlant): boolean =>
  INSTALLED_BY_STATUS[p.status];

/** State-linked capacity: wholly state-owned plus JVs with a state stake (НЕК's
 *  27% of Марица изток 3). `municipal` is deliberately NOT included — both
 *  consumers label this "държавна/смесена", which is the state, not local
 *  government. Shared for the same reason as {@link isInstalled}: the predicate
 *  was written three times across two consumers that cannot see each other, so
 *  one `municipal` reclassification would have them publishing different state
 *  shares with every row count still reconciling. */
export const isStateLinked = (p: PowerPlant): boolean =>
  p.ownership === "state" || p.ownership === "jv";

/** Every plant that exists today — the only correct basis for a capacity total,
 *  a state-share denominator or a bar scale. See {@link isInstalled}. */
export const installedPlants = (plants: PowerPlant[]): PowerPlant[] =>
  plants.filter(isInstalled);

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
