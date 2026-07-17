// Регионално развитие (МРРБ) procurement classification — the buyer-specific bit
// of the regional sector pack. Like the МО/МВР/transport packs the МРРБ group has
// no bespoke geometry: the model IS the generic per-category / per-supplier /
// per-year awarder model, so this file is a classifier (CPV division → МРРБ
// operating function) plus a thin wrapper over `buildAwarderModel`. Labels kept
// local. Mirrors transportAttributes.ts / securityAttributes.ts.
//
// Category order is grounded in what the МРРБ group actually buys: cadastre &
// geodesy IT (the АГКК digital-cadastre programme — software + IT services), public
// construction & благоустройство (45), design/engineering/supervision (71 — the
// ДНСК building-control + МРРБ проектиране core, and geodetic surveying 71.35),
// maintenance (50), administrative/consulting/facility services (the regional-office
// operations of the 27 governors), supplies/materials, fuel & utilities. Contracts
// with no CPV fall to the "other" sink.

import type { ProcurementContract } from "@/data/dataTypes";
import {
  buildAwarderModel,
  buildAwarderModelFromAggregates,
  isSpendRow,
  type AwarderModel,
  type AwarderCategoryAgg,
  type GroupModelPayload,
  type SectorClassifier,
} from "./awarderModel";

export type RegionalCategory =
  | "cadastre_it" // 48/72 — кадастрална/ГИС система, софтуер и ИТ услуги (АГКК)
  | "construction" // 45 — строителство, благоустройство, публична инфраструктура
  | "design_supervision" // 71 — проектиране, инженеринг, геодезия, строителен надзор
  | "maintenance" // 50 — ремонт и поддръжка
  | "admin_services" // 79/75/90/98 — административни, правни, консултантски и стопански услуги
  | "supplies" // 44/30/39/22 — материали, офис, обзавеждане, печат
  | "fuel_utilities" // 09/65 — горива, електроенергия, комунални услуги
  | "other";

export type RegionalCategoryAgg = AwarderCategoryAgg<RegionalCategory>;
export type RegionalModel = AwarderModel<RegionalCategory>;

const startsWithAny = (s: string, prefixes: string[]) =>
  prefixes.some((p) => s.startsWith(p));

/** CPV division → МРРБ operating function, on the two-digit division only. */
export const categoryOfCpv = (cpv: string | undefined): RegionalCategory => {
  const c = String(cpv ?? "").replace(/\s/g, "");
  if (!c) return "other";
  const div = c.slice(0, 2);
  // Cadastre & GIS IT: software packages (48, incl. GIS), IT services (72) — the
  // АГКК digital-cadastre programme + all office IT/telecom/electronics.
  if (startsWithAny(div, ["48", "72", "32", "30"])) return "cadastre_it";
  // Construction works (45) — public works, благоустройство, buildings.
  if (div === "45") return "construction";
  // Architectural, engineering, design, supervision & geodetic surveying (71).
  if (div === "71") return "design_supervision";
  // Repair & maintenance services (50).
  if (div === "50") return "maintenance";
  // Administrative, legal, consulting, cleaning/facility & business services
  // (79 business, 75 public admin, 90 cleaning/environmental, 98 other) — the
  // regional-office operations of the 27 областни администрации.
  if (startsWithAny(div, ["79", "75", "90", "98", "85"]))
    return "admin_services";
  // Construction materials (44), office supplies (30 already caught above → keep
  // furniture 39, printing 22, paper).
  if (startsWithAny(div, ["44", "39", "22", "37"])) return "supplies";
  // Fuels & energy (09), utilities (65 — water/electric distribution).
  if (startsWithAny(div, ["09", "65"])) return "fuel_utilities";
  return "other";
};

const CATEGORY_LABEL: Record<RegionalCategory, { bg: string; en: string }> = {
  cadastre_it: {
    bg: "Кадастър, геодезия и ИТ (АГКК)",
    en: "Cadastre, geodesy & IT (АГКК)",
  },
  construction: {
    bg: "Строителство и благоустройство",
    en: "Construction & public works",
  },
  design_supervision: {
    bg: "Проектиране и строителен надзор",
    en: "Design & construction supervision",
  },
  maintenance: { bg: "Ремонт и поддръжка", en: "Repair & maintenance" },
  admin_services: {
    bg: "Административни и стопански услуги",
    en: "Administrative & facility services",
  },
  supplies: { bg: "Материали и консумативи", en: "Materials & supplies" },
  fuel_utilities: {
    bg: "Горива и комунални услуги",
    en: "Fuel & utilities",
  },
  other: { bg: "Друго", en: "Other" },
};

export const categoryLabel = (id: RegionalCategory, lang: string): string =>
  (lang === "bg" ? CATEGORY_LABEL[id]?.bg : CATEGORY_LABEL[id]?.en) ?? id;

/** The CPV divisions each category is built from — for deep-linking a category to
 *  `/procurement/contracts?cpv=<divs>` (the browse ORs the prefixes), reproducing
 *  the tile's split EXACTLY. Must mirror `categoryOfCpv` above. `other` (the no-CPV
 *  sink) has no divisions, so it isn't deep-linkable. */
const CATEGORY_CPV_DIVS: Record<RegionalCategory, string[]> = {
  cadastre_it: ["48", "72", "32", "30"],
  construction: ["45"],
  design_supervision: ["71"],
  maintenance: ["50"],
  admin_services: ["79", "75", "90", "98", "85"],
  supplies: ["44", "39", "22", "37"],
  fuel_utilities: ["09", "65"],
  other: [],
};

export const categoryCpvDivs = (id: RegionalCategory): string[] =>
  CATEGORY_CPV_DIVS[id] ?? [];

const regionalClassifier: SectorClassifier<RegionalCategory> = {
  categoryOf: (c: ProcurementContract) => categoryOfCpv(c.cpv),
  order: [
    "cadastre_it",
    "construction",
    "design_supervision",
    "maintenance",
    "admin_services",
    "supplies",
    "fuel_utilities",
  ],
  sink: "other",
};

/** Build the regional model. Only tag='contract' rows carry money (awards/
 *  amendments would double-count), matching the awarder rollup the host shows. */
export const buildRegionalModel = (
  rows: ProcurementContract[],
): RegionalModel =>
  buildAwarderModel(
    rows.filter((c) => isSpendRow(c, true)),
    regionalClassifier,
  );

/** Same model, folded from the server's group aggregates (awarder-group-model)
 *  instead of raw rows — the tag='contract' filter lives in SQL there. */
export const buildRegionalModelFromAggregates = (
  p: GroupModelPayload,
): RegionalModel => buildAwarderModelFromAggregates(p, regionalClassifier);
