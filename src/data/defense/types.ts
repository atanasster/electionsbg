// Canonical shapes of the committed data/defense/*.json files. Kept dependency-
// free (no React / react-query) so BOTH the main-site hooks (useDefenseData.tsx)
// and the separate AI-site tools (ai/tools/defense.ts) can import them without
// dragging the i18n/React stack across the ai/ ↔ @/data boundary — the AI build
// imports these via a relative path (see the eslint no-restricted-imports rule).

// --- %GDP path ---------------------------------------------------------------

export interface GdpSharePoint {
  year: number;
  pct: number;
  estimate?: boolean;
  note?: string;
}
export interface GdpShareFile {
  source: string;
  note: string;
  updated: string;
  targets: {
    wales2: number;
    hagueCore: number;
    hagueTotal: number;
    hagueYear: number;
  };
  series: GdpSharePoint[];
}

// --- equipment / personnel / other split ------------------------------------

export interface CategorySplitPoint {
  year: number;
  equipment: number;
  personnel: number;
  other: number;
  estimate?: boolean;
}
export interface CategorySplitFile {
  source: string;
  note: string;
  updated: string;
  guideline: { equipment: number };
  series: CategorySplitPoint[];
}

// --- arms exports ------------------------------------------------------------

export interface ExportPoint {
  year: number;
  totalEur: number;
  toUkraineEur: number;
  approx?: boolean;
  record?: boolean;
}
export interface ExportsFile {
  source: string;
  note: string;
  updated: string;
  cumulativeSinceInvasionEur: number;
  topDestinations2024: string[];
  series: ExportPoint[];
}

// --- mega-programs -----------------------------------------------------------

export type ProgramDomain = "air" | "land" | "sea" | "industry";
export type ProgramStatus =
  | "planned"
  | "build"
  | "in_progress"
  | "delivery"
  | "delay"
  | "done";

export interface ProgramMilestone {
  year: number;
  label: string;
  kind: "contract" | "delivery" | "planned";
}
export interface DefenseProgram {
  id: string;
  domain: ProgramDomain;
  name: string;
  value: number;
  currency: "USD" | "EUR";
  units: string;
  status: ProgramStatus;
  timeline: ProgramMilestone[];
  flags: string[];
}
export interface ProgramsFile {
  source: string;
  note: string;
  updated: string;
  programs: DefenseProgram[];
}

// --- readiness & budget split ------------------------------------------------

export interface ReadinessFile {
  source: string;
  note: string;
  updated: string;
  personnelVacancyPct: number;
  reserveFillPct: number;
  budgetYear: number;
  personnelEur: number;
  capitalEur: number;
}

// --- aviation sustainment (the signature cross-buyer aggregate) --------------

export interface SustainmentPlatform {
  name: string;
  eur: number;
  contracts: number;
}
export interface AviationSustainmentFile {
  source: string;
  note: string;
  updated: string;
  totalEur: number;
  contractCount: number;
  platforms: SustainmentPlatform[];
}

// --- peer comparison (%GDP vs neighbours + NATO Europe) ----------------------

export interface PeerCountry {
  key: string;
  bg: string;
  en: string;
  series: number[]; // %GDP, aligned to `years`
}
export interface PeersFile {
  source: string;
  note: string;
  updated: string;
  target: number;
  countries: PeerCountry[]; // Bulgaria first
  years: number[];
  /** Bulgaria-only NATO extras (Tables 6 & 7), aligned to `years`. */
  bulgaria?: {
    perCapitaUsd: number[];
    personnelThousands: number[];
  };
}
