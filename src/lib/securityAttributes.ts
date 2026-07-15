// Полиция / МВР procurement classification — the buyer-specific bit of the МВР
// sector pack. Like the МО pack the МВР group has no bespoke geometry: the model
// IS the generic per-category / per-supplier / per-year awarder model, so this
// file is a classifier (CPV division → policing operating function) plus a thin
// wrapper over `buildAwarderModel`, labels kept local. Mirrors defenseAttributes.ts.
// See docs/plans/police-mvr-view-v1.md §7/§7b.
//
// Category order is grounded in what МВР actually buys: vehicles (patrol cars —
// the most-scrutinised line), fuel, IT & surveillance electronics, security &
// tactical equipment (arms, ammo, radar/optical border-tech), health (the
// Медицински институт confound, like ВМА), construction (buildings, border
// works), uniforms/food/supplies, repair & maintenance. Contracts with no CPV
// fall to the "other" sink.

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

export type SecurityCategory =
  | "vehicles" // 34 — патрулни автомобили, транспортна техника (the scandal line)
  | "fuel" // 09 — горива и енергия
  | "it_surveillance" // 72/48/32/30 — ИТ, комуникации, видеонаблюдение, електроника
  | "security_equip" // 35/38 — оръжие, боеприпаси, тактическо, радари/оптика (граница)
  | "health" // 33 — медицина и лекарства (Медицински институт) — the confound
  | "construction" // 45 — строителство, сгради, гранична инфраструктура
  | "supplies" // 18/55/15 — униформи, храна, материали
  | "maintenance" // 50 — ремонт и поддръжка
  | "other";

export type SecurityCategoryAgg = AwarderCategoryAgg<SecurityCategory>;
export type SecurityModel = AwarderModel<SecurityCategory>;

const startsWithAny = (s: string, prefixes: string[]) =>
  prefixes.some((p) => s.startsWith(p));

/** CPV division → policing operating function, on the two-digit division only. */
export const categoryOfCpv = (cpv: string | undefined): SecurityCategory => {
  const c = String(cpv ?? "").replace(/\s/g, "");
  if (!c) return "other";
  const div = c.slice(0, 2);
  // Transport equipment incl. patrol vehicles (34).
  if (div === "34") return "vehicles";
  // Fuels & energy (09).
  if (div === "09") return "fuel";
  // IT, software, comms, electronics, surveillance.
  if (startsWithAny(div, ["72", "48", "32", "30"])) return "it_surveillance";
  // Weapons, munitions (35); 38 = precision/optical/radar (border surveillance).
  if (div === "35" || div === "38") return "security_equip";
  // Medical equipment & pharmaceuticals (33) — the Медицински институт.
  if (div === "33") return "health";
  // Construction (45).
  if (div === "45") return "construction";
  // Clothing/uniforms (18), catering (55), food (15), furniture (39).
  if (startsWithAny(div, ["18", "55", "15", "39"])) return "supplies";
  // Repair & maintenance services (50).
  if (div === "50") return "maintenance";
  return "other";
};

const CATEGORY_LABEL: Record<SecurityCategory, { bg: string; en: string }> = {
  vehicles: { bg: "Автомобили и техника", en: "Vehicles & equipment" },
  fuel: { bg: "Горива и енергия", en: "Fuel & energy" },
  it_surveillance: {
    bg: "ИТ и видеонаблюдение",
    en: "IT & surveillance",
  },
  security_equip: {
    bg: "Оръжие и тактическо оборудване",
    en: "Weapons & tactical equipment",
  },
  health: {
    bg: "Медицина (Мед. институт)",
    en: "Medical (Medical Institute)",
  },
  construction: { bg: "Строителство", en: "Construction" },
  supplies: { bg: "Униформи, храна и материали", en: "Uniforms, food & supplies" }, // prettier-ignore
  maintenance: { bg: "Ремонт и поддръжка", en: "Repair & maintenance" },
  other: { bg: "Друго", en: "Other" },
};

export const categoryLabel = (id: SecurityCategory, lang: string): string =>
  (lang === "bg" ? CATEGORY_LABEL[id]?.bg : CATEGORY_LABEL[id]?.en) ?? id;

/** The CPV divisions each category is built from — for deep-linking a category to
 *  `/procurement/contracts?cpv=<divs>` (the browse ORs the prefixes), reproducing
 *  the tile's split EXACTLY. Must mirror `categoryOfCpv` above. `other` (the
 *  no-CPV sink) has no divisions, so it isn't deep-linkable. */
const CATEGORY_CPV_DIVS: Record<SecurityCategory, string[]> = {
  vehicles: ["34"],
  fuel: ["09"],
  it_surveillance: ["72", "48", "32", "30"],
  security_equip: ["35", "38"],
  health: ["33"],
  construction: ["45"],
  supplies: ["18", "55", "15", "39"],
  maintenance: ["50"],
  other: [],
};

export const categoryCpvDivs = (id: SecurityCategory): string[] =>
  CATEGORY_CPV_DIVS[id] ?? [];

const securityClassifier: SectorClassifier<SecurityCategory> = {
  categoryOf: (c: ProcurementContract) => categoryOfCpv(c.cpv),
  order: [
    "vehicles",
    "fuel",
    "it_surveillance",
    "security_equip",
    "health",
    "construction",
    "supplies",
    "maintenance",
  ],
  sink: "other",
};

/** Build the police model. Only tag='contract' rows carry money (awards/
 *  amendments would double-count), matching the awarder rollup the host shows. */
export const buildSecurityModel = (
  rows: ProcurementContract[],
): SecurityModel =>
  buildAwarderModel(
    rows.filter((c) => isSpendRow(c, true)),
    securityClassifier,
  );

/** Same model, folded from the server's group aggregates (awarder-group-model)
 *  instead of raw rows — the tag='contract' filter lives in SQL there. */
export const buildSecurityModelFromAggregates = (
  p: GroupModelPayload,
): SecurityModel => buildAwarderModelFromAggregates(p, securityClassifier);
