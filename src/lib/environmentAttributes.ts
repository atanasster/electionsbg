// Околна среда (МОСВ) procurement classification — the buyer-specific bit of the
// environment sector pack. Like the МО/МВР/transport packs the МОСВ group has no
// bespoke geometry: the model IS the generic per-category / per-supplier / per-year
// awarder model, so this file is a classifier (CPV → environmental function) plus a
// thin wrapper over `buildAwarderModel`. Labels kept local. Mirrors transportAttributes.ts.
//
// ⚠ CPV COVERAGE IS LOW for this group (МОСВ ~46%, ИАОС ~39%, ПУДООС ~33% of € carry a
// CPV — measured 2026-07-16, §0.5). So the „Друго/Other" sink (no-CPV contracts) is the
// LARGEST bucket by design here — the category tile discloses the CPV-known coverage %
// so the reader knows the split covers under half the money.
//
// Division 90 (екологични услуги) is the group's signature, so it is split on the
// 3-digit sub-group (90.4 отпадъчни води / 90.5 отпадъци / 90.6 санитария / 90.7
// екологичен мониторинг) rather than lumped — unlike the transport classifier which
// only needs the 2-digit division.

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

export type EnvCategory =
  | "waste" // 90.5 отпадъци, 90.6 санитария/почистване
  | "water_treatment" // 90.4 отпадъчни води (ПСОВ услуги)
  | "monitoring" // 90.7 екологичен мониторинг/въздух + 38 измервателна апаратура/лаборатория
  | "nature" // 77 залесяване, поддръжка на терени, паркове
  | "construction" // 45 строителство (ПСОВ, депа, сгради, терени)
  | "services" // 71 проектиране/надзор · 72 ИТ · 73 НИРД · 79 бизнес услуги
  | "supplies" // доставки — 09 горива/енергия · 30/31/33 оборудване · 34 МПС · 44 материали · 24 химия
  | "other";

export type EnvCategoryAgg = AwarderCategoryAgg<EnvCategory>;
export type EnvModel = AwarderModel<EnvCategory>;

/** CPV → environmental function. Division 90 is split on its 3-digit sub-group; the
 *  rest classify on the 2-digit division. */
export const categoryOfCpv = (cpv: string | undefined): EnvCategory => {
  const c = String(cpv ?? "").replace(/\s/g, "");
  if (!c) return "other";
  // Division 90 — екологични услуги (the group's signature), split by sub-group.
  if (c.startsWith("904")) return "water_treatment";
  if (c.startsWith("905") || c.startsWith("906")) return "waste";
  if (c.startsWith("907")) return "monitoring";
  const div = c.slice(0, 2);
  // Measuring / lab / monitoring instruments (38) — the air-quality equipment line.
  if (div === "38") return "monitoring";
  // Construction works (45) — ПСОВ, landfills, park/terrain works, buildings.
  if (div === "45") return "construction";
  // Agricultural / forestry / horticultural — nature upkeep, afforestation (77).
  if (div === "77") return "nature";
  // Design & supervision (71), IT (72), R&D (73), business services (79).
  if (div === "71" || div === "72" || div === "73" || div === "79")
    return "services";
  // Supplies — fuel/energy (09), equipment (30/31/33), vehicles (34), materials
  // (44), chemicals (24).
  if (["09", "30", "31", "33", "34", "44", "24"].includes(div))
    return "supplies";
  return "other";
};

const CATEGORY_LABEL: Record<EnvCategory, { bg: string; en: string }> = {
  waste: { bg: "Отпадъци и санитария", en: "Waste & sanitation" },
  water_treatment: {
    bg: "Отпадъчни води (ПСОВ)",
    en: "Wastewater (treatment)",
  },
  monitoring: {
    bg: "Мониторинг и измерване",
    en: "Monitoring & measurement",
  },
  nature: { bg: "Природа и терени", en: "Nature & terrain" },
  construction: { bg: "Строителство", en: "Construction" },
  services: { bg: "Проектиране и услуги", en: "Design & services" },
  supplies: { bg: "Доставки", en: "Supplies" },
  other: { bg: "Друго", en: "Other" },
};

export const categoryLabel = (id: EnvCategory, lang: string): string =>
  (lang === "bg" ? CATEGORY_LABEL[id]?.bg : CATEGORY_LABEL[id]?.en) ?? id;

/** The CPV prefixes each category is built from — for deep-linking a category to
 *  `/procurement/contracts?cpv=<prefixes>` (the browse ORs the prefixes), reproducing
 *  the tile's split EXACTLY. Must mirror `categoryOfCpv` above. `other` (the no-CPV
 *  sink) has no prefixes, so it isn't deep-linkable. */
const CATEGORY_CPV_DIVS: Record<EnvCategory, string[]> = {
  waste: ["905", "906"],
  water_treatment: ["904"],
  monitoring: ["907", "38"],
  nature: ["77"],
  construction: ["45"],
  services: ["71", "72", "73", "79"],
  supplies: ["09", "30", "31", "33", "34", "44", "24"],
  other: [],
};

export const categoryCpvDivs = (id: EnvCategory): string[] =>
  CATEGORY_CPV_DIVS[id] ?? [];

const environmentClassifier: SectorClassifier<EnvCategory> = {
  categoryOf: (c: ProcurementContract) => categoryOfCpv(c.cpv),
  order: [
    "waste",
    "water_treatment",
    "monitoring",
    "nature",
    "construction",
    "services",
    "supplies",
  ],
  sink: "other",
};

/** Build the environment model. Only tag='contract' rows carry money (awards/
 *  amendments would double-count), matching the awarder rollup the host shows. */
export const buildEnvironmentModel = (rows: ProcurementContract[]): EnvModel =>
  buildAwarderModel(
    rows.filter((c) => isSpendRow(c, true)),
    environmentClassifier,
  );

/** Same model, folded from the server's group aggregates (awarder-group-model)
 *  instead of raw rows — the tag='contract' filter lives in SQL there. */
export const buildEnvironmentModelFromAggregates = (
  p: GroupModelPayload,
): EnvModel => buildAwarderModelFromAggregates(p, environmentClassifier);
