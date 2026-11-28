// The two engine corrections /sector/health stands on.
//
//   pnpm run test:data
//
// D3 — a joint_kind='framework' row (087) is ceiling/N: an equal split of a
// framework CEILING, not money spent. On МЗ (000695317) the 34 such rows were
// €1,311.3M against €1,527.1M of real contracts (2026-11-20), so a headline
// that sums them nearly doubles the ministry. 061's p_ex_framework and the
// three `awarder-group-*` routes' exFramework switch take them out and report
// them on their own line; this pins that the two figures PARTITION the window
// (nothing lost, nothing counted twice) and that the default is unchanged.
//
// A4 — the supplier list must group by EIK, never by name. Софарма files under
// 103267194 with at least four spellings; a name-grouped list would rank one
// company as four. The gate asserts EIK-uniqueness on the health set's supplier
// list AND that the name variance it protects against is really there — an
// assertion over one spelling would pass on a name-grouped implementation too.
import { describe, test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";
import { HEALTH_SECTOR_EIKS } from "@/lib/healthReferenceData";
import type { GroupModelPayload } from "@/lib/awarderModel";
import { reportSkip } from "../../lib/report_skip";

const MZ = "000695317";
const SOPHARMA = "103267194";

const reachable = async (): Promise<string | false> => {
  try {
    await allRows("SELECT 1");
    const [t] = await allRows<{ ok: boolean; arg4: boolean }>(
      `SELECT to_regclass('public.contracts') IS NOT NULL AS ok,
              EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'awarder_group_model'
                       AND pronargs = 4) AS arg4`,
    );
    if (!t?.ok) return "contracts is absent (run pnpm run db:load:pg)";
    return t.arg4
      ? false
      : "awarder_group_model() predates p_ex_framework — 061 has no applier, so apply it by hand: " +
          "pnpm exec tsx scripts/db/apply_functions.ts 061_awarder_group_model.sql";
  } catch {
    return "Postgres unreachable";
  }
};
const skip = await reachable();
reportSkip(import.meta.url, skip);

afterAll(async () => {
  await end();
});

const model = async (
  eiks: readonly string[],
  ex: boolean,
): Promise<GroupModelPayload> => {
  const [r] = await allRows<{ j: GroupModelPayload }>(
    `SELECT awarder_group_model($1::text[], NULL, NULL, $2) AS j`,
    [eiks, ex],
  );
  return r.j;
};

describe.skipIf(!!skip)("D3 — framework ceilings on their own line", () => {
  test("МЗ carries framework rows at all (else the rest is vacuous)", async () => {
    const m = await model([MZ], false);
    assert.ok(
      (m.frameworkCount ?? 0) > 0 && (m.frameworkEur ?? 0) > 0,
      "no framework rows on МЗ — the 087 tagging or the 061 projection is gone",
    );
  });

  test("the default still sums them in — every existing caller is unchanged", async () => {
    const m = await model([MZ], false);
    const [raw] = await allRows<{ eur: number; n: number }>(
      `SELECT round(sum(amount_eur))::float8 AS eur, count(*)::int AS n
         FROM contracts WHERE awarder_eik = $1 AND tag = 'contract'`,
      [MZ],
    );
    assert.equal(m.exFramework, false);
    assert.equal(m.totalEur, raw.eur);
    assert.equal(m.contractCount, raw.n);
  });

  test("exFramework partitions the window: excluded + framework = default", async () => {
    const all = await model(HEALTH_SECTOR_EIKS, false);
    const ex = await model(HEALTH_SECTOR_EIKS, true);
    assert.equal(ex.exFramework, true);
    assert.equal(
      ex.frameworkEur,
      all.frameworkEur,
      "the framework line moved with the switch",
    );
    assert.equal(
      ex.contractCount + (ex.frameworkCount ?? 0),
      all.contractCount,
    );
    // Each total is ROUNDed once, so the partition holds to ±1 €.
    assert.ok(
      Math.abs(ex.totalEur + (ex.frameworkEur ?? 0) - all.totalEur) <= 1,
      `${ex.totalEur} + ${ex.frameworkEur} ≠ ${all.totalEur}`,
    );
    // The switch reached the breakdowns, not only the head.
    const yearSum = ex.byYear.reduce((a, y) => a + y.totalEur, 0);
    assert.ok(yearSum <= ex.totalEur + ex.byYear.length);
    const unitSum = ex.byUnit.reduce((a, u) => a + u.totalEur, 0);
    assert.ok(Math.abs(unitSum - ex.totalEur) <= ex.byUnit.length);
    const cpvSum = ex.byCpv.reduce((a, c) => a + c.totalEur, 0);
    assert.ok(Math.abs(cpvSum - ex.totalEur) <= ex.byCpv.length);
    // …and the supplier list: the excluded basis must hold strictly less.
    const supEx = ex.suppliers.reduce((a, s) => a + s.totalEur, 0);
    const supAll = all.suppliers.reduce((a, s) => a + s.totalEur, 0);
    assert.ok(supEx < supAll, "framework rows still reach the supplier list");
  });
});

describe.skipIf(!!skip)("A4 — the supplier list is keyed by EIK", () => {
  test("no EIK appears twice in the health set's supplier list", async () => {
    const m = await model(HEALTH_SECTOR_EIKS, true);
    const eiks = m.suppliers.map((s) => s.eik);
    assert.ok(eiks.length > 0, "empty supplier list");
    assert.equal(new Set(eiks).size, eiks.length);
  });

  test("Софарма is one row though it files under several names", async () => {
    const [v] = await allRows<{ n: number }>(
      `SELECT count(DISTINCT contractor_name)::int AS n FROM contracts
        WHERE contractor_eik = $1 AND awarder_eik = ANY($2::text[])
          AND tag = 'contract'`,
      [SOPHARMA, HEALTH_SECTOR_EIKS],
    );
    // Non-vacuity: the spelling variance this guards against must exist.
    assert.ok(
      v.n >= 2,
      `Софарма has ${v.n} spelling(s) in the health set — pick another witness`,
    );
    const m = await model(HEALTH_SECTOR_EIKS, true);
    assert.equal(m.suppliers.filter((s) => s.eik === SOPHARMA).length, 1);
  });
});
