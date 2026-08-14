// RULE 1 of the sector members search: EVERY row must LAND. A member offered as a
// search result whose `/awarder/:eik` page renders „Няма фирма с ЕИК … в базата." is
// a dead end, and `membersIndex.test.ts` has stated that rule in its header since it
// was written while asserting only the link's SHAPE — which is how one shipped.
//
// `SectorMember.noAwarderPage` is the opt-out. This gate is what keeps it honest, and
// it asserts BOTH directions on purpose:
//
//   · an UNFLAGGED member whose page dead-ends  → a search result going nowhere;
//   · a FLAGGED member whose page is fine       → an institution hidden from search
//     for no reason, which nobody would ever notice.
//
// The second direction is what makes the flag SELF-RETIRING. Търговище carries it
// only because it has never awarded a contract; the day it awards one,
// `institution_identity()` starts resolving and this test fails until the flag comes
// off. That is the whole reason the flag is gated against the live corpus rather
// than against a hand-kept list.

import { test, describe, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";
import { SECTOR_DASHBOARDS } from "@/screens/sector/sectorDashboards";

const reachable = async (): Promise<boolean> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.contracts') IS NOT NULL AS ok",
    );
    return !!t?.ok;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb ? false : "Postgres unreachable / contracts table absent";

afterAll(async () => {
  await end();
});

/** Everything `/awarder/:eik` needs to render something rather than the not-found
 *  branch. `institution_identity()` (migration 020) returns NULL exactly when the
 *  EIK has no buy-side footprint AND no `fund_beneficiaries` row; `tr_companies` is
 *  the other arm, and an областна администрация — a БУЛСТАТ registration — has no
 *  row there, which is why one can be missing from all three at once. */
const LANDS_SQL = `
  SELECT
    m.eik,
    (institution_identity(m.eik) IS NOT NULL)                                AS institution,
    EXISTS (SELECT 1 FROM tr_companies t WHERE t.uic = m.eik)                AS tr,
    EXISTS (SELECT 1 FROM contracts c WHERE c.awarder_eik = m.eik)           AS awarder,
    EXISTS (SELECT 1 FROM contracts c WHERE c.contractor_eik = m.eik)        AS contractor
  FROM unnest($1::text[]) AS m(eik)`;

describe.skipIf(skip)("sector members — every search row lands", () => {
  const members = Object.entries(SECTOR_DASHBOARDS).flatMap(([sector, cfg]) =>
    cfg.members.map((m) => ({ sector, ...m })),
  );

  test("the noAwarderPage flag matches the corpus, in both directions", async () => {
    // Guard against the assertion going vacuous if SECTOR_DASHBOARDS is ever
    // restructured — an empty member list would satisfy every check below.
    assert.ok(
      members.length > 100,
      `only ${members.length} members enumerated`,
    );

    const rows = await allRows<{
      eik: string;
      institution: boolean;
      tr: boolean;
      awarder: boolean;
      contractor: boolean;
    }>(LANDS_SQL, [members.map((m) => m.eik)]);
    const byEik = new Map(rows.map((r) => [r.eik, r]));

    const deadEnds: string[] = [];
    const pointlessFlags: string[] = [];
    for (const m of members) {
      const r = byEik.get(m.eik);
      if (!r) continue;
      const lands = r.institution || r.tr || r.awarder || r.contractor;
      if (!lands && !m.noAwarderPage)
        deadEnds.push(
          `${m.sector}/${m.eik} ${m.name.bg} — no institution, no ТР row, no ` +
            `contracts either side: /awarder/${m.eik} dead-ends, so it must ` +
            `carry noAwarderPage or come out of the roster`,
        );
      if (lands && m.noAwarderPage)
        pointlessFlags.push(
          `${m.sector}/${m.eik} ${m.name.bg} — the awarder page resolves now, ` +
            `so noAwarderPage hides a live institution from search: remove it`,
        );
    }
    assert.deepEqual(deadEnds, [], "members whose awarder page dead-ends");
    assert.deepEqual(pointlessFlags, [], "members flagged but servable");
  });

  test("Търговище is the flagged one, and it is flagged for the stated reason", async () => {
    // Pinned because this is the case the flag was introduced for. If the reason
    // stops holding, the test above is what fails first — this one keeps the
    // WHY attached to the EIK so a future reader does not have to infer it.
    const TGV = "125043455";
    assert.ok(
      SECTOR_DASHBOARDS.regional.members.some(
        (m) => m.eik === TGV && m.noAwarderPage,
      ),
      "Търговище must be in the regional roster and flagged",
    );
    const [r] = await allRows<{ awarder: boolean; contractor: boolean }>(
      LANDS_SQL,
      [[TGV]],
    );
    assert.equal(
      r.awarder,
      false,
      "Търговище has awarded a contract — see above",
    );
    assert.equal(r.contractor, false);
  });
});
