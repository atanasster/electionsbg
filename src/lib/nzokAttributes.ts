// НЗОК procurement classification — the buyer-specific bit of the health sector
// pack. Like НОИ, НЗОК has no bespoke geometry (no corridors / chainage): its
// model IS the generic per-category / per-supplier / per-year awarder model, so
// this file is a classifier (CPV division → НЗОК operating function) plus a thin
// wrapper over `buildAwarderModel`. Labels + the CPV→function map live in
// nzokBenchmarks; all aggregation lives in awarderModel.

import type { ProcurementContract } from "@/data/dataTypes";
import { categoryOfCpv, NZOK_EIK, type NzokCategory } from "./nzokBenchmarks";
import {
  buildAwarderModel,
  buildAwarderModelFromAggregates,
  type GroupModelPayload,
  isSpendRow,
  type AwarderModel,
  type AwarderCategoryAgg,
  type SectorClassifier,
} from "./awarderModel";

export { NZOK_EIK };

// Public shapes the tiles import — thin aliases over the generic model.
export type NzokCategoryAgg = AwarderCategoryAgg<NzokCategory>;
export type NzokModel = AwarderModel<NzokCategory>;

// НЗОК classifier: category by CPV division; "other" sinks to the bottom, the
// rest sort by € (biggest function first — the IT backbone leads).
const nzokClassifier: SectorClassifier<NzokCategory> = {
  categoryOf: (c: ProcurementContract) => categoryOfCpv(c.cpv),
  sink: "other",
};

/** Build the НЗОК model. Only tag='contract' rows carry money (awards/amendments
 *  would double-count), matching the awarder rollup the host page shows. */
export const buildNzokModel = (rows: ProcurementContract[]): NzokModel =>
  buildAwarderModel(
    rows.filter((c) => isSpendRow(c, true)),
    nzokClassifier,
  );

/** Same model, folded from the server's group aggregates (awarder-group-model)
 *  instead of raw rows — the tag='contract' filter lives in SQL there. */
export const buildNzokModelFromAggregates = (p: GroupModelPayload): NzokModel =>
  buildAwarderModelFromAggregates(p, nzokClassifier);
