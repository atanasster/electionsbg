// A consortium MEMBER must not be served as "no procurement" — and must not gain a euro.
//
// WHY: migration 087 moves a joint (обединение / ДЗЗД) award's whole value onto ONE carrier
// row and ZEROES the member rows, so a three-firm consortium is counted once. Correct — but
// `company_procurement` (011) and `person_procurement` (024) then used `contract_count`, which
// carries that same member exclusion, as their EXISTENCE test. A firm whose ONLY procurement is
// consortium membership scored 0 on contract/award/amendment and returned NULL, so its page
// showed no procurement at all while `conshd`/`conslist` a few lines above had already computed
// the participation.
//
// Measured 2026-09-21: 1,172 companies are member-only (1,101 of them NULLed by that guard, the
// other 71 carrying amendment rows), party to €7.48bn of joint awards across 1,048 consortia;
// 731 person name folds are in the same state. The worked example is МЛГ ЕООД (113581389), a
// named party to a €69.2m АПИ guardrail framework whose own page rendered nothing.
//
// THE ASSERTION THAT MATTERS MOST IS #2: `totalEur` is still 0. Everything else here is
// cosmetic beside it — the one way this change could do real harm is by letting the joint value
// into a sum, which would re-create exactly the triple count 087 exists to prevent.
//
// Auto-skips when Postgres is down or the corpus holds no consortium members — like the other
// *.data.test.ts gates.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, dbReachable, withClient, end } from "../lib/pg";
import { reportSkip } from "../../lib/report_skip";

// The reference company: МЛГ ЕООД, member of `obed-3653b19cc364` on УНП 00044-2022-0028
// (АПИ, „ограничителни системи за пътища"). Two member rows at €0 against a joint
// €69,185,496.51, and no solo contract anywhere in the corpus.
const MEMBER_ONLY_EIK = "113581389";

const SCHEMA_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "schema",
  "pg",
);

const haveDb = await dbReachable();
const memberRows =
  haveDb &&
  Number(
    (
      await allRows<{ n: string }>(
        "SELECT count(*) n FROM contracts WHERE consortium_role = 'member'",
      ).catch(() => [{ n: "0" }])
    )[0]?.n ?? 0,
  ) > 0;
const skip = !haveDb
  ? "Postgres unreachable"
  : !memberRows
    ? "contracts corpus holds no consortium member rows"
    : false;
reportSkip(import.meta.url, skip);

afterAll(async () => {
  await end();
});

test.skipIf(skip)("a member-only company is served, not NULLed", async () => {
  const [r] = await allRows<{
    is_null: boolean;
    consortium_count: number | null;
    consortium_eur: number | null;
    conslist: number | null;
  }>(
    `SELECT p IS NULL                            AS is_null,
              (p->>'consortiumCount')::int         AS consortium_count,
              (p->>'consortiumEur')::float8        AS consortium_eur,
              jsonb_array_length(p->'consortiumContracts') AS conslist
         FROM (SELECT company_procurement($1) p) q`,
    [MEMBER_ONLY_EIK],
  );
  assert.equal(
    r?.is_null,
    false,
    `company_procurement('${MEMBER_ONLY_EIK}') returned NULL — the member-only guard is not ` +
      `applied to this database. Run: npx tsx scripts/db/apply_functions.ts ` +
      `011_company_api.sql 024_person_api.sql`,
  );
  assert.ok(
    (r?.consortium_count ?? 0) > 0,
    "the payload is served but carries no consortium participation",
  );
  assert.ok(
    (r?.consortium_eur ?? 0) > 0,
    "consortiumEur is zero — the joint value did not survive into the payload",
  );
  assert.equal(
    r?.conslist,
    r?.consortium_count,
    "consortiumContracts and consortiumCount disagree about how many joint contracts there are",
  );
});

test.skipIf(skip)(
  "serving a member gains NO money — totalEur stays solo-only",
  async () => {
    // The invariant the whole change rests on. `consortiumEur` is the FULL contract value and
    // the per-member share is not public, so folding it into `totalEur` would count one award
    // once per member — for the reference company, three times.
    const [r] = await allRows<{
      total_eur: number;
      contract_count: number;
      consortium_eur: number;
      joint_eur: number;
    }>(
      `SELECT (p->>'totalEur')::float8      AS total_eur,
              (p->>'contractCount')::int    AS contract_count,
              (p->>'consortiumEur')::float8 AS consortium_eur,
              (SELECT COALESCE(SUM(consortium_full_eur), 0)
                 FROM contracts
                WHERE contractor_eik = $1 AND consortium_role = 'member') AS joint_eur
         FROM (SELECT company_procurement($1) p) q`,
      [MEMBER_ONLY_EIK],
    );
    assert.equal(
      r?.total_eur,
      0,
      `totalEur is ${r?.total_eur} for a company with no solo contracts — the joint value has ` +
        "leaked into the headline sum, which triple-counts the award across its members",
    );
    assert.equal(
      r?.contract_count,
      0,
      "contractCount counted member rows — it must keep the 087 exclusion",
    );
    assert.equal(
      Number(r?.consortium_eur),
      Number(r?.joint_eur),
      "consortiumEur disagrees with SUM(consortium_full_eur) over the member rows",
    );
  },
);

test.skipIf(skip)(
  "no member-only company anywhere is still served as NULL",
  async () => {
    // Corpus-wide, not a sample: the defect is a whole population, and a one-EIK assertion
    // passes on an implementation that special-cases nothing but happens to work for МЛГ.
    const [r] = await allRows<{ member_only: string; still_null: string }>(
      `WITH per AS (
         SELECT contractor_eik,
                count(*) FILTER (WHERE tag = 'contract'
                                   AND consortium_role IS DISTINCT FROM 'member') AS own_rows,
                count(*) FILTER (WHERE consortium_role = 'member')                AS mem
           FROM contracts
          WHERE contractor_eik NOT LIKE 'obed-%'
          GROUP BY 1)
       SELECT count(*)                                                        AS member_only,
              count(*) FILTER (WHERE company_procurement(contractor_eik) IS NULL) AS still_null
         FROM per WHERE own_rows = 0 AND mem > 0`,
    );
    assert.ok(
      Number(r?.member_only ?? 0) > 0,
      "no member-only companies found — the gate would be vacuous",
    );
    assert.equal(
      Number(r?.still_null),
      0,
      `${r?.still_null} of ${r?.member_only} member-only companies still return NULL`,
    );
  },
);

test.skipIf(skip)(
  "no member-only company gained money corpus-wide",
  async () => {
    // The population form of the invariant above. A company with zero solo contract rows must
    // report totalEur = 0 and contractCount = 0 no matter how large its participation.
    const [r] = await allRows<{ leaked: string; counted: string }>(
      `WITH per AS (
         SELECT contractor_eik,
                count(*) FILTER (WHERE tag = 'contract'
                                   AND consortium_role IS DISTINCT FROM 'member') AS own_rows,
                count(*) FILTER (WHERE consortium_role = 'member')                AS mem
           FROM contracts
          WHERE contractor_eik NOT LIKE 'obed-%'
          GROUP BY 1),
       p AS (SELECT contractor_eik, company_procurement(contractor_eik) AS j
               FROM per WHERE own_rows = 0 AND mem > 0)
       SELECT count(*) FILTER (WHERE (j->>'totalEur')::float8 <> 0)   AS leaked,
              count(*) FILTER (WHERE (j->>'contractCount')::int <> 0) AS counted
         FROM p`,
    );
    assert.equal(
      Number(r?.leaked),
      0,
      `${r?.leaked} member-only companies report a non-zero totalEur — joint value in a headline sum`,
    );
    assert.equal(
      Number(r?.counted),
      0,
      `${r?.counted} member-only companies report a non-zero contractCount`,
    );
  },
);

test.skipIf(skip)("the person half carries the same guard", async () => {
  // 024 is the twin of 011 and rides a DIFFERENT loader (`db:load:tr:pg`, a REFRESH_EXCLUSIONS
  // member), so it is the half that silently stays on the old body after a contracts publish.
  const [r] = await allRows<{ folds: string; served: string }>(
    `WITH per AS (
       SELECT contractor_eik,
              count(*) FILTER (WHERE tag = 'contract'
                                 AND consortium_role IS DISTINCT FROM 'member') AS own_rows,
              count(*) FILTER (WHERE tag IN ('award','contractAmendment'))       AS other_rows,
              count(*) FILTER (WHERE consortium_role = 'member')                 AS mem
         FROM contracts GROUP BY 1),
     folds AS (
       SELECT o.name_fold, min(o.name) AS a_name,
              sum(p.own_rows) own_rows, sum(p.other_rows) other_rows, sum(p.mem) mem
         FROM tr_officers o JOIN per p ON p.contractor_eik = o.uic
        GROUP BY 1),
     pick AS (
       SELECT a_name FROM folds
        WHERE own_rows = 0 AND other_rows = 0 AND mem > 0
        LIMIT 50)
     SELECT count(*) AS folds,
            count(*) FILTER (WHERE person_procurement(a_name, NULL, NULL) IS NOT NULL) AS served
       FROM pick`,
  );
  assert.ok(
    Number(r?.folds ?? 0) > 0,
    "no member-only person folds found — the gate would be vacuous",
  );
  assert.equal(
    Number(r?.served),
    Number(r?.folds),
    `${Number(r?.folds) - Number(r?.served)} of ${r?.folds} member-only person folds still ` +
      "return NULL — apply 024_person_api.sql (it rides db:load:tr:pg, not db:load:pg)",
  );
});

test.skipIf(skip)(
  "the guard still discriminates (mutation check)",
  async () => {
    // Without this, every assertion above is satisfiable by a database where the guard was
    // never applied but the corpus happens to have no member-only companies — and, worse, by
    // a future body that returns non-NULL for everything. Re-create the function from its OWN
    // deployed definition with the conjunct removed, inside a rolled-back transaction, and
    // require the reference company to go back to NULL.
    await withClient(async (c) => {
      await c.query("BEGIN");
      try {
        const {
          rows: [{ def }],
        } = await c.query<{ def: string }>(
          "SELECT pg_get_functiondef('company_procurement(text,text,text)'::regprocedure) AS def",
        );
        const needle = /\s*AND\s+conshd\.consortium_count\s*=\s*0/i;
        assert.match(
          def,
          needle,
          "the deployed company_procurement body does not contain the consortium conjunct — " +
            "this database is running the pre-fix function",
        );
        await c.query(def.replace(needle, ""));
        const {
          rows: [m],
        } = await c.query<{ is_null: boolean }>(
          "SELECT company_procurement($1) IS NULL AS is_null",
          [MEMBER_ONLY_EIK],
        );
        assert.equal(
          m?.is_null,
          true,
          "removing the conjunct did NOT restore the NULL — the assertions above are not " +
            "actually testing this guard",
        );
      } finally {
        await c.query("ROLLBACK").catch(() => {});
      }
    });
  },
);

// Static, needs no corpus: the two files hold ONE rule and are applied by two different
// loaders, so nothing but this check stops them diverging on a machine where only one ran.
test("011 and 024 carry the identical NULL guard", () => {
  const guard =
    /WHEN\s+hd\.contract_count\s*=\s*0\s+AND\s+hd\.award_count\s*=\s*0\s+AND\s+hd\.amendment_count\s*=\s*0\s+AND\s+conshd\.consortium_count\s*=\s*0\s+THEN\s+NULL/i;
  for (const f of ["011_company_api.sql", "024_person_api.sql"]) {
    const sql = readFileSync(path.join(SCHEMA_DIR, f), "utf8");
    assert.match(
      sql,
      guard,
      `${f} does not carry the member-only NULL guard in its canonical form. The two files ` +
        "hold one rule; a change to either must be made in both (they have different appliers " +
        "— 011 rides db:load:pg, 024 rides db:load:tr:pg).",
    );
  }
});
