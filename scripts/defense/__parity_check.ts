// Parity: for every consolidated sector pack, the model built from RAW rows
// (buildXxxModel, the old fan-out path) must equal the one folded from the
// group-model aggregates (buildXxxModelFromAggregates, the new server path) —
// checked both whole-corpus AND over a half-open [from,to) window (the seam where
// the SQL date guard must match TS scopeByWindow).
//   npx tsx scripts/defense/__parity_check.ts
import { allRows } from "../db/lib/pg";
import { scopeByWindow } from "@/data/procurement/useAwarderContracts";
import type { ProcurementContract } from "@/data/dataTypes";
import type { AwarderModel, GroupModelPayload } from "@/lib/awarderModel";
import {
  buildDefenseModel,
  buildDefenseModelFromAggregates,
} from "@/lib/defenseAttributes";
import { MOD_EIK, DEFENSE_ALIAS_EIKS } from "@/lib/defenseReferenceData";
import {
  buildVikModel,
  buildVikModelFromAggregates,
} from "@/lib/vikAttributes";
import { VIK_HOLDING_EIK, VIK_HOLDING_SUB_EIKS } from "@/lib/vikReferenceData";
import {
  buildVssModel,
  buildVssModelFromAggregates,
  VSS_EIK,
} from "@/lib/vssAttributes";
import { VSS_ALIAS_EIKS } from "@/lib/vssReferenceData";
import {
  buildNoiModel,
  buildNoiModelFromAggregates,
  NOI_EIK,
} from "@/lib/noiAttributes";
import {
  buildNzokModel,
  buildNzokModelFromAggregates,
  NZOK_EIK,
} from "@/lib/nzokAttributes";
import {
  buildKulturaModel,
  buildKulturaModelFromAggregates,
  KULTURA_EIK,
} from "@/lib/kulturaAttributes";

type Build = (rows: ProcurementContract[]) => AwarderModel<string>;
type Fold = (p: GroupModelPayload) => AwarderModel<string>;
const PACKS: { name: string; eiks: string[]; build: Build; fold: Fold }[] = [
  {
    name: "Defense",
    eiks: [MOD_EIK, ...DEFENSE_ALIAS_EIKS],
    build: buildDefenseModel,
    fold: buildDefenseModelFromAggregates,
  },
  {
    name: "Vik",
    eiks: [VIK_HOLDING_EIK, ...VIK_HOLDING_SUB_EIKS],
    build: buildVikModel,
    fold: buildVikModelFromAggregates,
  },
  {
    name: "Vss",
    eiks: [VSS_EIK, ...VSS_ALIAS_EIKS],
    build: buildVssModel,
    fold: buildVssModelFromAggregates,
  },
  {
    name: "Noi",
    eiks: [NOI_EIK],
    build: buildNoiModel,
    fold: buildNoiModelFromAggregates,
  },
  {
    name: "Nzok",
    eiks: [NZOK_EIK],
    build: buildNzokModel,
    fold: buildNzokModelFromAggregates,
  },
  {
    name: "Kultura",
    eiks: [KULTURA_EIK],
    build: buildKulturaModel,
    fold: buildKulturaModelFromAggregates,
  },
];

// One windowed case exercising the half-open [from,to) seam (a full calendar year).
const WINDOW = { from: "2024-01-01", to: "2025-01-01" };

const compare = (
  label: string,
  rm: AwarderModel<string>,
  am: AwarderModel<string>,
  eikCount: number,
): number => {
  let f = 0;
  const near = (a: number, b: number, tol: number, l: string) => {
    if (Math.abs(a - b) > tol) {
      f++;
      console.log(
        `  ${label} MISMATCH ${l}: raw=${a} agg=${b} Δ=${Math.abs(a - b).toFixed(2)}`,
      );
    }
  };
  const eq = (a: unknown, b: unknown, l: string) => {
    if (a !== b) {
      f++;
      console.log(
        `  ${label} MISMATCH ${l}: raw=${JSON.stringify(a)} agg=${JSON.stringify(b)}`,
      );
    }
  };
  const TOL = 5;
  near(rm.totalEur, am.totalEur, eikCount * 2 + 2, "totalEur");
  eq(rm.contractCount, am.contractCount, "contractCount");
  eq(rm.bidKnownN, am.bidKnownN, "bidKnownN");
  eq(rm.singleBidN, am.singleBidN, "singleBidN");
  near(
    rm.singleBidShare ?? -1,
    am.singleBidShare ?? -1,
    1e-9,
    "singleBidShare",
  );
  near(rm.directShare, am.directShare, 1e-3, "directShare");
  eq(rm.supplierCount, am.supplierCount, "supplierCount");
  eq(rm.minYear, am.minYear, "minYear");
  eq(rm.maxYear, am.maxYear, "maxYear");
  eq(
    rm.categories.map((c) => c.id).join(","),
    am.categories.map((c) => c.id).join(","),
    "category order",
  );
  for (const rc of rm.categories) {
    const ac = am.categories.find((c) => c.id === rc.id);
    if (!ac) {
      f++;
      console.log(`  ${label} MISSING cat ${rc.id}`);
      continue;
    }
    near(rc.totalEur, ac.totalEur, TOL * 30, `cat[${rc.id}].totalEur`);
    eq(rc.contractCount, ac.contractCount, `cat[${rc.id}].contractCount`);
    eq(rc.supplierCount, ac.supplierCount, `cat[${rc.id}].supplierCount`);
    eq(
      rc.topSupplier?.eik ?? null,
      ac.topSupplier?.eik ?? null,
      `cat[${rc.id}].topSupplier`,
    );
  }
  eq(rm.suppliers.length, am.suppliers.length, "suppliers.length");
  for (let i = 0; i < 20 && rm.suppliers[i] && am.suppliers[i]; i++) {
    eq(rm.suppliers[i].eik, am.suppliers[i].eik, `suppliers[${i}].eik`);
    near(
      rm.suppliers[i].totalEur,
      am.suppliers[i].totalEur,
      TOL,
      `suppliers[${i}].€`,
    );
    eq(
      rm.suppliers[i].category,
      am.suppliers[i].category,
      `suppliers[${i}].category`,
    );
  }
  eq(rm.years.length, am.years.length, "years.length");
  return f;
};

let totalFails = 0;
for (const pack of PACKS) {
  const raw = (await allRows(
    `SELECT tag, date, contractor_eik AS "contractorEik", contractor_name AS "contractorName",
            amount_eur AS "amountEur", cpv, procurement_method AS "procurementMethod",
            number_of_tenderers AS "numberOfTenderers"
     FROM contracts WHERE awarder_eik = ANY($1)`,
    [pack.eiks],
  )) as ProcurementContract[];

  // Whole corpus.
  const [{ r: pAll }] = (await allRows(
    `SELECT awarder_group_model($1, NULL, NULL) AS r`,
    [pack.eiks],
  )) as { r: GroupModelPayload }[];
  const fAll = compare(
    `${pack.name}/all`,
    pack.build(raw),
    pack.fold(pAll),
    pack.eiks.length,
  );

  // Windowed [from,to) — SQL date guard vs TS scopeByWindow.
  const [{ r: pWin }] = (await allRows(
    `SELECT awarder_group_model($1, $2, $3) AS r`,
    [pack.eiks, WINDOW.from, WINDOW.to],
  )) as { r: GroupModelPayload }[];
  const fWin = compare(
    `${pack.name}/2024`,
    pack.build(scopeByWindow(raw, WINDOW.from, WINDOW.to)),
    pack.fold(pWin),
    pack.eiks.length,
  );

  const rm = pack.build(raw);
  console.log(
    `${fAll + fWin === 0 ? "OK  " : "FAIL"} ${pack.name}  (${pack.eiks.length} eik, ${rm.contractCount} contracts all · window ${fWin === 0 ? "ok" : "FAIL"})`,
  );
  totalFails += fAll + fWin;
}
console.log(
  totalFails === 0
    ? "\nALL PACKS PARITY OK (whole-corpus + windowed)"
    : `\n${totalFails} MISMATCHES`,
);
process.exit(totalFails === 0 ? 0 : 1);
