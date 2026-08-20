// The PARITY GATE for `AwarderModel` — the one type this repo builds TWICE.
// docs/plans/consortium-visibility-v1.md T4.
//
//   npm run test:data
//
// `awarder_group_model()` (061) folds a group server-side and
// `buildAwarderModelFromAggregates` shapes its output; `buildAwarderModel` folds
// the identical model from raw contract rows in TypeScript. Every sector page is
// served by the FIRST. The second has no live caller at all — it is the reference
// implementation, and that is precisely why it drifted: 061 excluded €0
// consortium member rows and the self-deal artifact from its supplier view while
// the row fold did not, so the two disagreed about who a group's suppliers even
// ARE. Measured 2026-08-19: 11,331 member rows over 3,215 keys, 1,164 of which
// appear ONLY as members and were published by the row fold as €0 „suppliers".
//
// ⚠ NO ROW COUNT REVEALS THAT CLASS OF BUG. Both producers were internally
// consistent, both reconciled against `contracts`, and the money agreed to the
// euro — only the SUPPLIER SET differed. So the gate has to build the same
// sector both ways and compare, which is what this file does.
//
// It deliberately does NOT live in a per-sector net: what it guards is the
// ENGINE. A sector file would gate one EIK list and leave the shared fold
// unwatched for every other sector.
import { describe, test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";
import { ADMIN_SECTOR_EIKS } from "@/lib/administrationReferenceData";
import {
  buildAwarderModel,
  buildAwarderModelFromAggregates,
  type GroupModelPayload,
} from "@/lib/awarderModel";
import type { ProcurementContract } from "@/data/dataTypes";
import type { SectorClassifier } from "@/lib/awarderModel";

const reachable = async (): Promise<boolean> => {
  try {
    await allRows("SELECT 1");
    const [t] = await allRows<{ ok: boolean }>(
      `SELECT to_regclass('public.contracts') IS NOT NULL
              AND to_regproc('public.awarder_group_model') IS NOT NULL AS ok`,
    );
    return !!t?.ok;
  } catch {
    return false;
  }
};

// `test.skipIf(bool)`, never `test(name, { skip }, fn)` — see the sibling nets.
const noDb = !(await reachable());

afterAll(async () => {
  await end();
});

/** One bucket, so the comparison is about SUPPLIERS rather than about whether two
 *  CPV classifiers agree. */
const ONE: SectorClassifier<"all"> = { categoryOf: () => "all" };

const eikList = (eiks: readonly string[]): string =>
  eiks.map((e) => `'${e.replace(/'/g, "''")}'`).join(", ");

const groupPayload = async (): Promise<GroupModelPayload> => {
  const [r] = await allRows<{ j: GroupModelPayload }>(
    `SELECT awarder_group_model(ARRAY[${eikList(ADMIN_SECTOR_EIKS)}]::text[],
                                NULL, NULL) AS j`,
  );
  return r.j;
};

/** Exactly the fields `buildAwarderModel` reads, and no more.
 *
 *  ⚠ NOT `as ProcurementContract[]`. That type has ~50 fields and the query
 *  projects nine, so a blanket assertion compiles today and silently rots: the
 *  day the fold starts reading `jointKind` or `signingAmountEur`, it would see
 *  `undefined` here while the SQL side sees the real value, and the gate would
 *  compare two models built from different information — the exact „looks equal,
 *  is not" failure it exists to catch, one level up. Naming the fields makes that
 *  a compile error instead. */
type FoldRow = Pick<
  ProcurementContract,
  | "contractorEik"
  | "contractorName"
  | "awarderEik"
  | "amountEur"
  | "numberOfTenderers"
  | "procurementMethod"
  | "consortiumRole"
  | "cpv"
  | "date"
  | "tag"
>;

/** The same rows 061's `base` CTE sees — tag='contract', same EIK set, no window.
 *  Column names are the camelCase ProcurementContract shape the fold expects. */
const groupRows = async (): Promise<FoldRow[]> =>
  await allRows<FoldRow>(
    `SELECT contractor_eik AS "contractorEik",
            procurement_method AS "procurementMethod",
            contractor_name AS "contractorName",
            awarder_eik AS "awarderEik",
            amount_eur AS "amountEur",
            number_of_tenderers AS "numberOfTenderers",
            consortium_role AS "consortiumRole",
            cpv, date, tag
       FROM contracts
      WHERE tag = 'contract'
        AND awarder_eik IN (${eikList(ADMIN_SECTOR_EIKS)})`,
  );

/** ONE snapshot for every arm. Beyond saving six round trips, it is the more
 *  correct shape for a parity assertion: three arms comparing three separately
 *  fetched pairs could in principle observe different corpus states if a load ran
 *  mid-suite, and „they disagreed" would then be a lie about the code. */
let snapshot: Promise<{
  sql: ReturnType<typeof buildAwarderModelFromAggregates<"all">>;
  fold: ReturnType<typeof buildAwarderModel<"all">>;
}> | null = null;
const models = () => {
  snapshot ??= (async () => {
    const [payload, rows] = await Promise.all([groupPayload(), groupRows()]);
    return {
      sql: buildAwarderModelFromAggregates(payload, ONE),
      // The fold reads eight fields off a row (amountEur, awarderEik,
      // consortiumRole, contractorEik, contractorName, date, numberOfTenderers,
      // procurementMethod) and `ONE.categoryOf` reads none — FoldRow projects
      // exactly those, so nothing unprojected can be observed. The cast is only
      // needed because `SectorClassifier.categoryOf` is typed over the full
      // ProcurementContract; the „competition stats agree" arm below is what
      // actually catches a field going missing, at runtime rather than on trust.
      fold: buildAwarderModel(rows as unknown as ProcurementContract[], ONE),
    };
  })();
  return snapshot;
};

describe("awarder_group_model — the two producers agree", () => {
  // THE GATE. Anything that narrows one supplier view and not the other lands
  // here as a set difference, named.
  test.skipIf(noDb)("the supplier SETS are identical", async () => {
    const { sql, fold } = await models();

    // Non-vacuity: two empty sets are trivially equal, and an empty corpus or a
    // mis-typed EIK list would otherwise pass this silently.
    assert.ok(
      sql.suppliers.length > 20,
      `only ${sql.suppliers.length} suppliers — the fixture group is too small to gate anything`,
    );

    const a = new Set(sql.suppliers.map((s) => s.eik));
    const b = new Set(fold.suppliers.map((s) => s.eik));
    const onlySql = [...a].filter((e) => !b.has(e));
    const onlyFold = [...b].filter((e) => !a.has(e));
    assert.deepEqual(
      { onlySql, onlyFold },
      { onlySql: [], onlyFold: [] },
      "the SQL and row folds disagree about who the suppliers are — " +
        "check both narrow the same way (061's sup CTE vs buildAwarderModel's " +
        "supplier block: €0 consortium members and the self-deal artifact)",
    );
    assert.equal(sql.supplierCount, fold.supplierCount);
  });

  // Money is the half that already agreed, so this is a guard against a „fix"
  // to the supplier set that starts dropping rows from the headline too — the
  // narrowing must apply to the SUPPLIER VIEW only.
  test.skipIf(noDb)("the headline money is untouched by it", async () => {
    const { sql, fold } = await models();
    assert.ok(
      Math.abs(sql.totalEur - fold.totalEur) <= 2,
      `totalEur ${sql.totalEur} vs ${fold.totalEur} — the supplier narrowing must ` +
        "not reach the headline (061 keeps member rows in its base CTE)",
    );
    assert.equal(sql.contractCount, fold.contractCount);
  });

  // ⚠ THE ARM THAT CATCHES AN UNPROJECTED FIELD, and it earned its place: the
  // first cut of this file omitted `procurement_method` from the row query, so
  // the fold computed directEur = 0 against SQL's real figure and every other
  // assertion still passed. Comparing the WHOLE CompetitionStats block means a
  // column dropped from the projection fails here instead of silently making the
  // two models incomparable.
  test.skipIf(noDb)("the competition stats agree", async () => {
    const { sql, fold } = await models();
    assert.ok(sql.directEur > 0, "no direct-award € — this arm is vacuous");
    assert.ok(
      Math.abs(sql.directEur - fold.directEur) <= 2,
      `directEur ${sql.directEur} vs ${fold.directEur} — a field the fold reads is ` +
        "probably missing from the row projection",
    );
    assert.equal(sql.bidKnownN, fold.bidKnownN);
    assert.equal(sql.singleBidN, fold.singleBidN);
    assert.equal(sql.singleBidShare, fold.singleBidShare);
  });

  // Per supplier, and banded by €2 because 061 ROUNDs per supplier while the fold
  // sums raw euros — the same tolerance `totalEur` carries.
  test.skipIf(noDb)("consortiumEur agrees per supplier", async () => {
    const { sql, fold } = await models();
    const foldBy = new Map(fold.suppliers.map((s) => [s.eik, s.consortiumEur]));

    // Non-vacuity: if nothing in the fixture group is a consortium, every
    // comparison below is 0 === 0 and the arm proves nothing.
    const withConsortium = sql.suppliers.filter(
      (s) => (s.consortiumEur ?? 0) > 0,
    );
    assert.ok(
      withConsortium.length > 0,
      "no supplier in the group won anything jointly — this arm cannot discriminate",
    );

    for (const s of sql.suppliers) {
      const f = foldBy.get(s.eik);
      assert.ok(
        s.consortiumEur != null && f != null,
        `${s.eik}: consortiumEur is null on one side (sql=${s.consortiumEur}, fold=${f}) — ` +
          "null means „could not tell“, and both producers can tell here",
      );
      assert.ok(
        Math.abs((s.consortiumEur ?? 0) - (f ?? 0)) <= 2,
        `${s.eik}: consortiumEur ${s.consortiumEur} vs ${f}`,
      );
    }
  });

  // Σ consortiumEur must equal what SQL says the carrier rows are worth. This is
  // the arm that fails if 061's FILTER predicate is ever widened to `IS NOT NULL`
  // (which would fold €0 member rows in) or narrowed to the obed- prefix.
  test.skipIf(noDb)("Σ consortiumEur == the group's carrier €", async () => {
    const { sql } = await models();
    const total = sql.suppliers.reduce((a, s) => a + (s.consortiumEur ?? 0), 0);
    const [r] = await allRows<{ eur: number }>(
      `SELECT coalesce(round(sum(amount_eur)), 0)::float8 AS eur
         FROM contracts
        WHERE tag = 'contract'
          AND awarder_eik IN (${eikList(ADMIN_SECTOR_EIKS)})
          AND consortium_role = 'carrier'`,
    );
    assert.ok(r.eur > 0, "the group has no carrier rows — arm is vacuous");
    assert.ok(
      Math.abs(total - r.eur) <= 5,
      `Σ consortiumEur ${total} vs carrier € ${r.eur}`,
    );
  });

  // ⚠ A MIXED supplier — carrier AND solo rows — is why consortiumEur is a € and
  // not a boolean. 162 of them exist corpus-wide holding €1.52bn joint against
  // €0.99bn solo. This pins the SHAPE: any refactor to bool_or/bool_and collapses
  // one of the two figures and fails here.
  test.skipIf(noDb)(
    "a mixed supplier keeps both figures distinct",
    async () => {
      const [r] = await allRows<{
        eik: string;
        carrier: number;
        total: number;
      }>(
        `SELECT contractor_eik AS eik,
              round(sum(amount_eur) FILTER (WHERE consortium_role = 'carrier'))::float8 AS carrier,
              round(sum(amount_eur))::float8 AS total
         FROM contracts
        WHERE tag = 'contract' AND contractor_eik IS NOT NULL
        GROUP BY 1
       HAVING count(*) FILTER (WHERE consortium_role = 'carrier') > 0
          AND count(*) FILTER (WHERE consortium_role IS NULL) > 0
        ORDER BY 2 DESC NULLS LAST
        LIMIT 1`,
      );
      assert.ok(
        r,
        "no supplier holds both carrier and solo rows — see the header",
      );
      assert.ok(
        r.carrier > 0 && r.carrier < r.total,
        `${r.eik}: carrier €${r.carrier} of €${r.total} — a mixed supplier must have ` +
          "0 < consortiumEur < totalEur, or the € has collapsed to a flag",
      );
    },
  );
});
