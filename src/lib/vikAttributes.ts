// ВиК (water) procurement classification — the buyer-specific bit of the water
// sector pack. Like НОИ/НЗОК/ВСС the water operators have no bespoke geometry:
// the model IS the generic per-category / per-supplier / per-year awarder model,
// so this file is a classifier (CPV division → water operating function) plus a
// thin wrapper over `buildAwarderModel`, with the labels kept local. See
// docs/plans/water-view-v1.md §4/§4.6.

import type { ProcurementContract } from "@/data/dataTypes";
import {
  buildAwarderModel,
  buildAwarderModelFromAggregates,
  type GroupModelPayload,
  isSpendRow,
  type AwarderModel,
  type AwarderCategoryAgg,
  type SectorClassifier,
} from "./awarderModel";

export type VikCategory =
  | "construction" // ВиК строителство / реконструкция на мрежи и корита
  | "supply" // водоснабдяване (доставка на вода, тръби за водопровод)
  | "sewerage" // канализация и пречистване (ПСОВ)
  | "materials" // тръби, помпи, арматура, разходомери
  | "energy" // електроенергия (помпени станции)
  | "other";

export type VikCategoryAgg = AwarderCategoryAgg<VikCategory>;
export type VikModel = AwarderModel<VikCategory>;

const startsWithAny = (s: string, prefixes: string[]) =>
  prefixes.some((p) => s.startsWith(p));

/** CPV division/prefix → water operating function. Order of checks matters:
 *  sewage-treatment CPVs (9042/9043) are tested before the broad "45"
 *  construction bucket so ПСОВ works don't all sink into construction; and
 *  electricity-distribution 6531* is tested before the broad "65" supply bucket
 *  so pump-station power lands in energy, not water supply. */
export const categoryOfCpv = (cpv: string | undefined): VikCategory => {
  const c = String(cpv ?? "").replace(/\s/g, "");
  if (!c) return "other";
  // Electricity (incl. 6531* distribution) before the broad "65" supply check.
  if (c.startsWith("6531") || c.startsWith("093")) return "energy";
  if (startsWithAny(c, ["9042", "9043", "9048", "90721", "90640", "90641"]))
    return "sewerage";
  if (
    startsWithAny(c, [
      "45231",
      "45232",
      "45233", // (mostly roads, but ВиК jobs occasionally miscoded here)
      "45240",
      "45246",
      "45247",
      "45252",
      "45255",
    ])
  )
    return "construction";
  if (startsWithAny(c, ["65", "41"])) return "supply";
  if (
    startsWithAny(c, [
      "4416",
      "4413",
      "42122", // pumps
      "42131", // valves
      "38421", // flow meters
      "38550", // meters
    ])
  )
    return "materials";
  if (c.startsWith("45")) return "construction";
  return "other";
};

const CATEGORY_LABEL: Record<VikCategory, { bg: string; en: string }> = {
  construction: { bg: "Строителство на ВиК мрежи", en: "Network construction" },
  supply: { bg: "Водоснабдяване", en: "Water supply" },
  sewerage: { bg: "Канализация и пречистване", en: "Sewerage & treatment" },
  materials: { bg: "Тръби, помпи и разходомери", en: "Pipes, pumps & meters" },
  energy: { bg: "Електроенергия", en: "Electricity" },
  other: { bg: "Друго", en: "Other" },
};

export const categoryLabel = (id: VikCategory, lang: string): string =>
  (lang === "bg" ? CATEGORY_LABEL[id]?.bg : CATEGORY_LABEL[id]?.en) ?? id;

const vikClassifier: SectorClassifier<VikCategory> = {
  categoryOf: (c: ProcurementContract) => categoryOfCpv(c.cpv),
  order: ["construction", "supply", "sewerage", "materials", "energy"],
  sink: "other",
};

/** Build the ВиК model. Only tag='contract' rows carry money (awards/amendments
 *  would double-count), matching the awarder rollup the host page shows. */
export const buildVikModel = (rows: ProcurementContract[]): VikModel =>
  buildAwarderModel(
    rows.filter((c) => isSpendRow(c, true)),
    vikClassifier,
  );

/** Same model, folded from the server's group aggregates (awarder-group-model)
 *  instead of raw rows — the tag='contract' filter lives in SQL there. */
export const buildVikModelFromAggregates = (p: GroupModelPayload): VikModel =>
  buildAwarderModelFromAggregates(p, vikClassifier);
