// Отбрана (defense / МО) procurement classification — the buyer-specific bit of
// the defense sector pack. Like НОИ/НЗОК/ВСС/Води the МО group has no bespoke
// geometry: the model IS the generic per-category / per-supplier / per-year
// awarder model, so this file is a classifier (CPV division → defense operating
// function) plus a thin wrapper over `buildAwarderModel`, labels kept local.
// See docs/plans/defense-pack-v1.md §Part-2/§Part-11.
//
// Category order is grounded in the МО group's real CPV mix (corpus 2026-07-09,
// by €): 33 medical €484M (mostly ВМА) · 50 maintenance €279M (the sustainment
// story) · 09 fuels €206M · 34 vehicles €112M · 45 construction €98M · 35 arms
// €57M · 18 clothing €31M · IT/comms ~€46M. ~38% of value carries no CPV → sink.

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

export type DefenseCategory =
  | "maintenance" // 50 — ремонт и поддръжка (авиация, техника, кораби) — sustainment
  | "arms" // 35 — оръжие, боеприпаси, военна техника
  | "vehicles" // 34 — транспортна и летателна техника
  | "fuel" // 09 — горива и енергия
  | "health" // 33 — медицина и лекарства (ВМА)
  | "construction" // 45 — строителство и инфраструктура
  | "it_comms" // 72/48/32/30 — ИТ, комуникации, електроника
  | "supplies" // 18/55/15 — облекло, храна, материали
  | "other";

export type DefenseCategoryAgg = AwarderCategoryAgg<DefenseCategory>;
export type DefenseModel = AwarderModel<DefenseCategory>;

const startsWithAny = (s: string, prefixes: string[]) =>
  prefixes.some((p) => s.startsWith(p));

/** CPV division → defense operating function, on the two-digit division only.
 *  38 (precision/optical/radar) is folded into `arms` with 35; transport-service
 *  divisions (60/63) are not vehicles — they fall through to `other`. */
export const categoryOfCpv = (cpv: string | undefined): DefenseCategory => {
  const c = String(cpv ?? "").replace(/\s/g, "");
  if (!c) return "other";
  const div = c.slice(0, 2);
  // Repair & maintenance services (50) — the aviation/vehicle sustainment story.
  if (div === "50") return "maintenance";
  // Weapons, munitions, military equipment (35); 38 = precision/optical/radar.
  if (div === "35" || div === "38") return "arms";
  // Transport equipment incl. aircraft (34).
  if (div === "34") return "vehicles";
  // Fuels & energy (09).
  if (div === "09") return "fuel";
  // Medical equipment & pharmaceuticals (33) — mostly ВМА.
  if (div === "33") return "health";
  // Construction (45).
  if (div === "45") return "construction";
  // IT, software, comms, electronics.
  if (startsWithAny(div, ["72", "48", "32", "30"])) return "it_comms";
  // Clothing (18), catering (55), food (15) — day-to-day supplies.
  if (startsWithAny(div, ["18", "55", "15", "39"])) return "supplies";
  return "other";
};

const CATEGORY_LABEL: Record<DefenseCategory, { bg: string; en: string }> = {
  maintenance: { bg: "Ремонт и поддръжка", en: "Repair & maintenance" },
  arms: { bg: "Оръжие и военна техника", en: "Weapons & military equipment" },
  vehicles: {
    bg: "Транспортна и летателна техника",
    en: "Vehicles & aircraft",
  },
  fuel: { bg: "Горива и енергия", en: "Fuel & energy" },
  health: { bg: "Медицина и лекарства (ВМА)", en: "Medical & drugs (ВМА)" },
  construction: { bg: "Строителство", en: "Construction" },
  it_comms: { bg: "ИТ и комуникации", en: "IT & comms" },
  supplies: {
    bg: "Облекло, храна и материали",
    en: "Clothing, food & supplies",
  },
  other: { bg: "Друго", en: "Other" },
};

export const categoryLabel = (id: DefenseCategory, lang: string): string =>
  (lang === "bg" ? CATEGORY_LABEL[id]?.bg : CATEGORY_LABEL[id]?.en) ?? id;

/** The CPV divisions each category is built from — for deep-linking a category to
 *  `/procurement/contracts?cpv=<divs>` (the browse ORs the prefixes), reproducing
 *  the tile's split EXACTLY. Must mirror `categoryOfCpv` above. `other` (the
 *  no-CPV sink) has no divisions, so it isn't deep-linkable. */
const CATEGORY_CPV_DIVS: Record<DefenseCategory, string[]> = {
  maintenance: ["50"],
  arms: ["35", "38"],
  vehicles: ["34"],
  fuel: ["09"],
  health: ["33"],
  construction: ["45"],
  it_comms: ["72", "48", "32", "30"],
  supplies: ["18", "55", "15", "39"],
  other: [],
};

export const categoryCpvDivs = (id: DefenseCategory): string[] =>
  CATEGORY_CPV_DIVS[id] ?? [];

const defenseClassifier: SectorClassifier<DefenseCategory> = {
  categoryOf: (c: ProcurementContract) => categoryOfCpv(c.cpv),
  order: [
    "maintenance",
    "arms",
    "vehicles",
    "fuel",
    "health",
    "construction",
    "it_comms",
    "supplies",
  ],
  sink: "other",
};

/** Build the defense model. Only tag='contract' rows carry money (awards/
 *  amendments would double-count), matching the awarder rollup the host shows. */
export const buildDefenseModel = (rows: ProcurementContract[]): DefenseModel =>
  buildAwarderModel(
    rows.filter((c) => isSpendRow(c, true)),
    defenseClassifier,
  );

/** Same model, folded from the server's group aggregates (awarder-group-model)
 *  instead of raw rows — the tag='contract' filter lives in SQL there. */
export const buildDefenseModelFromAggregates = (
  p: GroupModelPayload,
): DefenseModel => buildAwarderModelFromAggregates(p, defenseClassifier);
