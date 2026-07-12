// НОИ (ДОО) procurement classification — the buyer-specific bit of the НОИ
// sector pack. НОИ has no bespoke geometry (no corridors / chainage / €-per-km):
// its model IS the generic per-category / per-supplier / per-year awarder model,
// so this file is now just a classifier (CPV division → НОИ operating function)
// plus a thin wrapper over `buildAwarderModel`. All the aggregation lives in
// awarderModel; the labels and the CPV→function map live in noiBenchmarks.

import type { ProcurementContract } from "@/data/dataTypes";
import { categoryOfCpv, NOI_EIK, type NoiCategory } from "./noiBenchmarks";
import {
  buildAwarderModel,
  buildAwarderModelFromAggregates,
  type GroupModelPayload,
  isSpendRow,
  type AwarderModel,
  type AwarderSupplier,
  type AwarderCategoryAgg,
  type AwarderYear,
  type SectorClassifier,
} from "./awarderModel";

export { NOI_EIK };

// Public shapes the tiles import — thin aliases over the generic model so the
// tile code (NoiSupplier, NoiCategoryAgg, NoiModel …) is unchanged.
export type NoiSupplier = AwarderSupplier<NoiCategory>;
export type NoiCategoryAgg = AwarderCategoryAgg<NoiCategory>;
export type NoiYear = AwarderYear<NoiCategory>;
export type NoiModel = AwarderModel<NoiCategory>;

// НОИ classifier: category by CPV division; "other" sinks to the bottom, the
// rest sort by € (no declared order — biggest function first is the useful read).
const noiClassifier: SectorClassifier<NoiCategory> = {
  categoryOf: (c: ProcurementContract) => categoryOfCpv(c.cpv),
  sink: "other",
};

/** Build the НОИ model. Only tag='contract' rows carry money (awards/amendments
 *  would double-count), matching the awarder rollup the host page shows. */
export const buildNoiModel = (rows: ProcurementContract[]): NoiModel =>
  buildAwarderModel(
    rows.filter((c) => isSpendRow(c, true)),
    noiClassifier,
  );

/** Same model, folded from the server's group aggregates (awarder-group-model)
 *  instead of raw rows — the tag='contract' filter lives in SQL there. */
export const buildNoiModelFromAggregates = (p: GroupModelPayload): NoiModel =>
  buildAwarderModelFromAggregates(p, noiClassifier);
