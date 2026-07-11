// Култура (МК) procurement model — a thin wrapper over buildAwarderModel with a
// CPV-division → operating-function classifier. Labels + the CPV map live in
// kulturaReferenceData.ts so the tiles and the classifier can't drift.
// Mirrors lib/vssAttributes.ts.

import {
  categoryOfCpv,
  KULTURA_EIK,
  type KulturaCategory,
} from "./kulturaReferenceData";
import {
  buildAwarderModel,
  isSpendRow,
  type AwarderModel,
  type SectorClassifier,
} from "./awarderModel";
import type { ProcurementContract } from "@/data/dataTypes";

export type KulturaModel = AwarderModel<KulturaCategory>;

// Category by CPV division; "other" sinks to the bottom (uncoded remainder, not
// a spend theme).
const kulturaClassifier: SectorClassifier<KulturaCategory> = {
  categoryOf: (c: ProcurementContract) => categoryOfCpv(c.cpv),
  sink: "other",
};

export const buildKulturaModel = (rows: ProcurementContract[]): KulturaModel =>
  buildAwarderModel(
    rows.filter((c) => isSpendRow(c, true)),
    kulturaClassifier,
  );

export { KULTURA_EIK };
