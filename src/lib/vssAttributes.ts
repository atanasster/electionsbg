// ВСС procurement classification — the buyer-specific bit of the judiciary
// sector pack. Like НОИ/НЗОК, the ВСС has no bespoke geometry (no corridors /
// chainage): its model IS the generic per-category / per-supplier / per-year
// awarder model, so this file is a classifier (CPV division → judiciary
// operating function) plus a thin wrapper over `buildAwarderModel`. Labels and
// the CPV→function map live in vssReferenceData; all aggregation lives in
// awarderModel.

import type { ProcurementContract } from "@/data/dataTypes";
import { categoryOfCpv, VSS_EIK, type VssCategory } from "./vssReferenceData";
import {
  buildAwarderModel,
  isSpendRow,
  type AwarderModel,
  type AwarderCategoryAgg,
  type SectorClassifier,
} from "./awarderModel";

export { VSS_EIK };

// Public shapes the tiles import — thin aliases over the generic model.
export type VssCategoryAgg = AwarderCategoryAgg<VssCategory>;
export type VssModel = AwarderModel<VssCategory>;

// ВСС classifier: category by CPV division; "other" sinks to the bottom (it is
// mostly the uncoded remainder — ~53 contracts carry no CPV at all), the rest
// sort by € so courthouse construction leads.
const vssClassifier: SectorClassifier<VssCategory> = {
  categoryOf: (c: ProcurementContract) => categoryOfCpv(c.cpv),
  sink: "other",
};

/** Build the ВСС model. Only tag='contract' rows carry money (awards/amendments
 *  would double-count), matching the awarder rollup the host page shows. */
export const buildVssModel = (rows: ProcurementContract[]): VssModel =>
  buildAwarderModel(
    rows.filter((c) => isSpendRow(c, true)),
    vssClassifier,
  );
