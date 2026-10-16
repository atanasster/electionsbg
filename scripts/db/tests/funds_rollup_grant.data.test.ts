// The awarder-funds-rollup ?basis=grant arm against the real corpus
// (transport-hub-v1 D6 / A11). The route test (functions/) only sees SQL text, so a
// column bound to the wrong field — total_eur returned as grantEur — would pass
// there; this re-derives each field from fund_projects independently.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { allRows, dbReachable, end } from "../lib/pg";
import { TRANSPORT_SECTOR_EIKS } from "../../../src/lib/transportReferenceData";
import { reportSkip } from "../../lib/report_skip";

const require = createRequire(import.meta.url);
const { DB_ROUTES } = require("../../../functions/db_routes.js") as {
  DB_ROUTES: Record<
    string,
    (
      dbRows: typeof allRows,
      q: Record<string, string>,
    ) => Promise<{ body: { basis?: string; operators: Row[] } }>
  >;
};

interface Row {
  eik: string;
  grantEur: number;
  totalEur: number;
  paidEur: number;
  projectCount: number;
}

const haveDb = await dbReachable();
const skip = !haveDb ? "Postgres unreachable" : false;
reportSkip(import.meta.url, skip);

afterAll(async () => {
  await end();
});

test.skipIf(skip)(
  "every field re-derives from fund_projects, and grant never exceeds the project total",
  async () => {
    const { body } = await DB_ROUTES["awarder-funds-rollup"](allRows, {
      eiks: TRANSPORT_SECTOR_EIKS.join(","),
      basis: "grant",
    });
    assert.equal(body.basis, "grant");
    assert.ok(body.operators.length > 0, "no transport beneficiary in fund_projects"); // prettier-ignore
    const truth = await allRows<{
      eik: string;
      grant: number;
      total: number;
      paid: number;
      n: number;
    }>(
      `SELECT beneficiary_eik AS eik, round(sum(grant_eur))::float8 AS grant,
              round(sum(total_eur))::float8 AS total, round(sum(paid_eur))::float8 AS paid,
              count(*)::int AS n
         FROM fund_projects WHERE beneficiary_eik = ANY($1) GROUP BY 1`,
      [TRANSPORT_SECTOR_EIKS],
    );
    const byEik = new Map(truth.map((t) => [t.eik, t]));
    for (const r of body.operators) {
      const t = byEik.get(r.eik);
      assert.ok(t, `${r.eik} not in fund_projects`);
      assert.equal(r.grantEur, t.grant, `${r.eik} grantEur`);
      assert.equal(r.totalEur, t.total, `${r.eik} totalEur`);
      assert.equal(r.paidEur, t.paid, `${r.eik} paidEur`);
      assert.equal(r.projectCount, t.n, `${r.eik} projectCount`);
      assert.ok(r.grantEur <= r.totalEur + 1, `${r.eik}: grant above the project total`); // prettier-ignore
    }
    // Non-vacuity: the two bases genuinely differ for НКЖИ, or this arm is pointless.
    const nkzhi = body.operators.find((r) => r.eik === "130823243");
    assert.ok(nkzhi && nkzhi.grantEur < nkzhi.totalEur * 0.9, "НКЖИ grant ≈ total — the basis split no longer discriminates"); // prettier-ignore
  },
);
