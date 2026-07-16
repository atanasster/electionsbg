// Dependency-free reference data for the Агенция „Митници" (Customs) revenue
// pack. Like vssReferenceData / vikReferenceData, this is imported by BOTH the
// pack tiles and the nav/prerender surfaces, so it carries no react-query.
//
// Митници is a COLLECTOR, not a spender: the pack is revenue-first (акцизи,
// ДДС при внос, мита, глоби) from data/budget/revenue_breakdown/customs/*.json;
// the small ЗОП buy-side already sits on the generic awarder page below.

export const CUSTOMS_EIK = "000627597";
export const CUSTOMS_AWARDER_PATH = `/awarder/${CUSTOMS_EIK}`;

// Customs revenue-breakdown files on disk (newest first). The composition bar
// works for every year; the excise PRODUCT split (diesel/petrol/…/tobacco/
// alcohol) is only populated for 2025 — older files carry `excise_fuels` only.
export const CUSTOMS_YEARS = [2025, 2024, 2023, 2022] as const;
export const CUSTOMS_LATEST_YEAR = CUSTOMS_YEARS[0];

// The four top-level collection lines (children of `total_collected`), in draw
// order (biggest first). Colours are the validated composition ramp (see
// REVENUE_RAMP); `fines` is the muted residual.
export type CustomsLineId =
  | "excise_total"
  | "import_vat_total"
  | "customs_duties_total"
  | "fines_total";

export const CUSTOMS_LINES: {
  id: CustomsLineId;
  bg: string;
  en: string;
}[] = [
  { id: "excise_total", bg: "Акцизи", en: "Excise" },
  { id: "import_vat_total", bg: "ДДС при внос", en: "Import VAT" },
  { id: "customs_duties_total", bg: "Мита", en: "Customs duties" },
  // The 2025 breakdown file omits fines_total, so customsLineEur returns 0 and
  // RevenueCompositionBar's `s.eur > 0` filter drops the segment — graceful.
  { id: "fines_total", bg: "Глоби и лихви", en: "Fines & interest" },
];

// Validated categorical ramp — run through the dataviz skill's palette validator
// (`validate_palette.js "#2563eb,#ea580c,#0d9488,#7c3aed,#dc2626" --mode light`
// → ALL CHECKS PASS; the validator ships with the dataviz skill, not the repo).
// CVD floor further covered by the legend labels + the 2px inter-segment gap.
// Theme-invariant, matching the existing packs' single-ramp convention. The
// residual/"other" slot is the intentional muted gray, not a categorical hue.
export const REVENUE_RAMP = [
  "#2563eb", // blue-600
  "#ea580c", // orange-600
  "#0d9488", // teal-600
  "#7c3aed", // violet-600
  "#dc2626", // red-600
] as const;
export const REVENUE_RESIDUAL = "var(--muted-foreground)";

export const CUSTOMS_LINE_COLOR: Record<CustomsLineId, string> = {
  excise_total: REVENUE_RAMP[0],
  import_vat_total: REVENUE_RAMP[1],
  customs_duties_total: REVENUE_RAMP[2],
  fines_total: REVENUE_RESIDUAL,
};

// Excise product split (2025 only). `excise_fuels` is a parent of the five fuel
// leaves; the tile shows the top-level split (fuels / tobacco / alcohol) and
// leaves the fuel sub-breakdown to the footnote.
export type ExciseProductId =
  | "excise_fuels"
  | "excise_tobacco"
  | "excise_alcohol";

export const EXCISE_PRODUCTS: {
  id: ExciseProductId;
  bg: string;
  en: string;
  color: string;
}[] = [
  { id: "excise_fuels", bg: "Горива", en: "Fuels", color: REVENUE_RAMP[0] },
  { id: "excise_tobacco", bg: "Тютюн", en: "Tobacco", color: REVENUE_RAMP[3] },
  {
    id: "excise_alcohol",
    bg: "Алкохол",
    en: "Alcohol",
    color: REVENUE_RAMP[2],
  },
];

export const customsLineLabel = (id: CustomsLineId, lang: string): string => {
  const l = CUSTOMS_LINES.find((x) => x.id === id);
  return l ? (lang === "bg" ? l.bg : l.en) : id;
};

// Excise-warehouse register — the categories derived from the CN commodity
// codes (see scripts/customs/excise_register.ts). Colours reuse the composition
// ramp so the pack reads as one system.
export type ExciseCategory = "energy" | "tobacco" | "alcohol" | "other";

export const EXCISE_CATEGORIES: {
  id: ExciseCategory;
  bg: string;
  en: string;
  color: string;
}[] = [
  {
    id: "energy",
    bg: "Горива и енергия",
    en: "Fuels & energy",
    color: REVENUE_RAMP[0],
  },
  { id: "tobacco", bg: "Тютюн", en: "Tobacco", color: REVENUE_RAMP[3] },
  { id: "alcohol", bg: "Алкохол", en: "Alcohol", color: REVENUE_RAMP[2] },
  { id: "other", bg: "Друго", en: "Other", color: REVENUE_RESIDUAL },
];

export const exciseCategoryLabel = (
  id: ExciseCategory,
  lang: string,
): string => {
  const c = EXCISE_CATEGORIES.find((x) => x.id === id);
  return c ? (lang === "bg" ? c.bg : c.en) : id;
};

export const exciseCategoryColor = (id: ExciseCategory): string =>
  EXCISE_CATEGORIES.find((x) => x.id === id)?.color ?? REVENUE_RESIDUAL;

export const EXCISE_REGISTER_PATH = "/customs/warehouses";

// Shape of data/customs/excise_register.json — the single source of truth for
// the register, imported by the data hook (useCustoms) AND the AI tool
// (ai/tools/fiscal.ts) so a field rename can't drift a reader. The ingest
// (scripts/customs/excise_register.ts) re-declares the same shape because
// scripts/ is a separate build context; keep the two in sync.
export interface ExciseOperator {
  eik: string;
  name: string;
  categories: ExciseCategory[];
  warehouses: number;
  active: boolean;
  procurementEur: number;
  contractCount: number;
}

export interface ExciseRegisterFile {
  generatedAt: string;
  source: { publisher: string; register: string; url: string };
  totalOperators: number;
  activeOperators: number;
  operators: ExciseOperator[];
}

// One geolocated active warehouse for the /customs/warehouses count map, served
// from Postgres (excise_warehouses_map, schema 072). The ingest
// (scripts/customs/excise_register.ts) emits the same shape into
// data/customs/excise_warehouses.json; keep the two in sync.
export interface ExciseWarehousePoint {
  eik: string;
  name: string; // operator name
  category: ExciseCategory;
  place: string | null; // display settlement, e.g. "гр. Бургас"
  oblast: string | null;
  loc: [number, number]; // [lng, lat]
}

export interface ExciseWarehouseMap {
  warehouses: ExciseWarehousePoint[];
}
