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

// A person whose portfolio actually EXERCISES 024's (ocid, contract_id) dedupe: 91 raw
// member rows across 23 consortia that two or more of his companies both sit in, folding
// to 47 joint contracts (measured 2026-09-21). The МЛГ subject has no such group, so it
// cannot distinguish a deduped count from a multiplied one.
const DEDUPE_PERSON = "Камен Симеонов Пешов";

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

// ⚠️ A SECOND, NARROWER SKIP for the T2 annex arm. `procurement_annexes` (114) is filled by
// `db:load:annexes:pg` from the GITIGNORED ЦАИС annex cache, so a fresh clone has the table
// and no rows. Without this, four T2 tests fail with messages blaming the carrier lookup
// ("the (ocid, contract_id) lookup is probably matching nothing") on a database that simply
// has no annexes to find — a misdiagnosis that costs whoever reads it an afternoon.
const annexRows =
  !skip &&
  Number(
    (
      await allRows<{ n: string }>(
        "SELECT count(*) n FROM procurement_annexes",
      ).catch(() => [{ n: "0" }])
    )[0]?.n ?? 0,
  ) > 0;
const skipAnnex = skip
  ? skip
  : !annexRows
    ? "procurement_annexes is empty — run db:load:annexes:pg (its input is the gitignored ЦАИС annex cache)"
    : false;

/**
 * Walk a payload's `consortiumContracts` and check every row's carrier INDEPENDENTLY of the
 * one the function picked: the right carrier is the row sharing BOTH `ocid` and `contract_id`
 * with the member row, and the group must hold exactly one. Shared by the company and person
 * arms — 024 computes its headline from `carannex` DIRECTLY rather than from the list, so a
 * broken `LEFT JOIN carannex` there would leave every listed row with a null carrier and the
 * headline still right. Nothing else would move.
 */
const assertCarrierRows = async (
  rows: { key: string; carrierKey: string; annexCount: number }[],
  where: string,
) => {
  assert.ok(rows.length > 0, `${where}: no consortium contracts listed`);
  for (const row of rows) {
    assert.ok(
      row.carrierKey,
      `${where}: a joint contract has no carrierKey — the (ocid, contract_id) lookup found ` +
        "no carrier, which should be impossible for a row 087 marked as a member",
    );
    const [c] = await allRows<{
      role: string | null;
      n: string;
      same_ocid: boolean;
      same_cid: boolean;
      carriers_in_group: string;
    }>(
      `SELECT car.consortium_role AS role,
              (SELECT count(*) FROM procurement_annexes a
                WHERE a.contract_key = car.key) AS n,
              (car.ocid = mem.ocid) AS same_ocid,
              (COALESCE(car.contract_id, '') = COALESCE(mem.contract_id, '')) AS same_cid,
              (SELECT count(*) FROM contracts x
                WHERE x.ocid = mem.ocid
                  AND COALESCE(x.contract_id, '') = COALESCE(mem.contract_id, '')
                  AND x.tag = 'contract'
                  AND x.consortium_role = 'carrier') AS carriers_in_group
         FROM contracts car, contracts mem
        WHERE car.key = $1 AND mem.key = $2`,
      [row.carrierKey, row.key],
    );
    assert.equal(
      Number(c?.carriers_in_group),
      1,
      `${where}: (ocid, contract_id) carries ${c?.carriers_in_group} carrier rows — the pick ` +
        "is arbitrary, so the checks below no longer identify a unique carrier",
    );
    assert.equal(
      c?.role,
      "carrier",
      `${where}: ${row.carrierKey} is not a carrier row`,
    );
    assert.equal(
      c?.same_ocid,
      true,
      `${where}: carrier ${row.carrierKey} has a different ocid than member ${row.key}`,
    );
    assert.equal(
      c?.same_cid,
      true,
      `${where}: carrier ${row.carrierKey} has a different contract_id than member ` +
        `${row.key} — the lookup matched on ocid alone and picked another consortium`,
    );
    assert.equal(
      row.annexCount,
      Number(c?.n),
      `${where}: annexCount ${row.annexCount} disagrees with the carrier's own ${c?.n}`,
    );
  }
};

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
    const [r] = await allRows<{ leaked: string; counted: string; n: string }>(
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
              count(*) FILTER (WHERE (j->>'contractCount')::int <> 0) AS counted,
              count(*)                                               AS n
         FROM p`,
    );
    // Non-vacuity: two zeroes over an EMPTY population prove nothing.
    assert.ok(
      Number(r?.n ?? 0) > 0,
      "no member-only companies to check — the assertions below are vacuous",
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

// T2's carrier resolution is the SECOND rule living in both files, and its copies are not
// mechanically linked either: 011 aliases the member row `b` and 024 aliases it `p`, so no
// single regex covers both bodies and a reviewer diffing them has to do it by eye. These
// three properties are what make the lookup a lookup rather than a choice — the equality on
// `contract_id` (without it another consortium's contract answers), the `carrier` role
// filter, and the deterministic `ORDER BY c.key` before `LIMIT 1`.
test("011 and 024 both resolve the carrier the same way", () => {
  for (const [f, alias] of [
    ["011_company_api.sql", "b"],
    ["024_person_api.sql", "p"],
  ] as const) {
    const sql = readFileSync(path.join(SCHEMA_DIR, f), "utf8");
    for (const [what, re] of [
      [
        "the contract_id equality",
        new RegExp(
          `COALESCE\\(c\\.contract_id,\\s*''\\)\\s*=\\s*COALESCE\\(${alias}\\.contract_id,\\s*''\\)`,
        ),
      ],
      ["the ocid equality", new RegExp(`c\\.ocid\\s*=\\s*${alias}\\.ocid`)],
      ["the carrier role filter", /c\.consortium_role\s*=\s*'carrier'/],
      ["a deterministic ORDER BY before LIMIT 1", /ORDER BY c\.key\s+LIMIT 1/],
    ] as const) {
      assert.match(
        sql,
        re,
        `${f} is missing ${what} in its carrier lookup. Both files hold the same rule and ` +
          "are applied by different loaders; a change to either must be made in both.",
      );
    }
    // Non-vacuity: the alias is what makes each regex file-specific, so prove the OTHER
    // file's alias does not also match. Without this, an over-broad pattern would pass on
    // both files and the gate would stop being able to tell them apart.
    const otherAlias = alias === "b" ? "p" : "b";
    assert.doesNotMatch(
      sql,
      new RegExp(
        `COALESCE\\(c\\.contract_id,\\s*''\\)\\s*=\\s*COALESCE\\(${otherAlias}\\.contract_id,\\s*''\\)`,
      ),
      `${f} matches the OTHER file's member-row alias (${otherAlias}) — the patterns above ` +
        "are not actually distinguishing the two bodies",
    );
  }
});

// ── T2: the annex trail, which lives on the CARRIER row ──────────────────────────────────
//
// `procurement_annexes` resolves against `contracts.key`, and 087 moves the money — and with
// it the amendments — onto the carrier. So a member page could not reach the annexes that
// moved its own contract: for МЛГ ЕООД the five on РД-37-45 / РД-37-42, which took the pair
// from 42,598,403 to 93,065,069.67 BGN (+118%), all hang off `obed-*` keys.

test.skipIf(skip)(
  "member rows carry no annexes of their own — the premise",
  async () => {
    // If this ever stops being true the carrier lookup below is solving a problem that no
    // longer exists, and `annexCount` would start double-counting against `amendmentCount`.
    const [r] = await allRows<{ n: string }>(
      `SELECT count(*) n
         FROM procurement_annexes a
         JOIN contracts c ON c.key = a.contract_key
        WHERE c.consortium_role = 'member'`,
    );
    assert.equal(
      Number(r?.n),
      0,
      `${r?.n} annexes now resolve to consortium MEMBER rows — the carrier-only assumption ` +
        "behind consortiumAnnexCount no longer holds",
    );

    // 011's `consannex` sums over EVERY member row of the EIK with no dedupe (unlike 024,
    // which sums over the already-deduped `partic`). That is correct only while no EIK holds
    // two member rows inside one (ocid, contract_id) group; if one ever did, its carrier's
    // annexes would be counted twice, the joint contract would be listed twice, and
    // `total == sum(listed)` would STILL hold — so nothing else here could see it.
    const [d] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM (
         SELECT 1 FROM contracts
          WHERE tag = 'contract' AND consortium_role = 'member'
          GROUP BY contractor_eik, ocid, COALESCE(contract_id, '')
         HAVING count(*) > 1) x`,
    );
    assert.equal(
      Number(d?.n),
      0,
      `${d?.n} (eik, ocid, contract_id) groups hold more than one member row — 011's ` +
        "consannex double-counts their carrier's annexes; it needs 024's DISTINCT ON dedupe",
    );

    // And the uniqueness the per-row carrier check rests on: `(ocid, contract_id)` must carry
    // at most ONE carrier, or the `ORDER BY c.key LIMIT 1` pick is a choice rather than a
    // lookup and the ocid+contract_id assertions below stop identifying a unique row.
    const [u] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM (
         SELECT 1 FROM contracts
          WHERE tag = 'contract' AND consortium_role = 'carrier'
          GROUP BY ocid, COALESCE(contract_id, '')
         HAVING count(*) > 1) x`,
    );
    assert.equal(
      Number(u?.n),
      0,
      `${u?.n} (ocid, contract_id) groups carry more than one carrier row — 087 changed, and ` +
        "the carrier lookup is now arbitrary within the group",
    );
  },
);

test.skipIf(skipAnnex)(
  "each joint contract reports its carrier's annexes",
  async () => {
    const [r] = await allRows<{
      total: number;
      n: number;
      listed: number;
      rows: { key: string; carrierKey: string; annexCount: number }[];
    }>(
      `SELECT (p->>'consortiumAnnexCount')::int AS total,
              (p->>'consortiumCount')::int      AS n,
              jsonb_array_length(p->'consortiumContracts') AS listed,
              (p->'consortiumContracts')        AS rows
         FROM (SELECT company_procurement($1) p) q`,
      [MEMBER_ONLY_EIK],
    );
    await assertCarrierRows(r?.rows ?? [], "company");

    // Equality holds ONLY while the list is untruncated: `conslist` is LIMIT 25 and the
    // headline is unbounded, so asserting it unconditionally is false for any firm with more
    // joint contracts than that — 835013079 reports 44 against 25 listed. Pin that the
    // reference company is still in the untruncated case rather than silently weakening.
    assert.equal(
      r?.listed,
      r?.n,
      "the reference company's consortium list is now truncated — the equality below no " +
        "longer holds for it; pick a smaller reference company",
    );
    assert.equal(
      r?.total,
      (r?.rows ?? []).reduce((a, b) => a + b.annexCount, 0),
      "consortiumAnnexCount is not the sum of the listed contracts' annexes",
    );
  },
);

test.skipIf(skipAnnex)(
  "the carrier's annexes are NOT folded into the member's own amendmentCount",
  async () => {
    // Two different claims: "this firm's contract was amended N times" (the carrier's trail)
    // vs "this firm filed N amendments" (its own contractAmendment rows). The reference
    // company has 5 of the first and 0 of the second; merging them would publish the carrier's
    // amendment history as the member's own filing history.
    const [r] = await allRows<{ annexes: number; amendments: number }>(
      `SELECT (p->>'consortiumAnnexCount')::int AS annexes,
              (p->>'amendmentCount')::int       AS amendments
         FROM (SELECT company_procurement($1) p) q`,
      [MEMBER_ONLY_EIK],
    );
    assert.ok(
      (r?.annexes ?? 0) > 0,
      "the reference company reports no carrier annexes — the lookup regressed",
    );
    assert.equal(
      r?.amendments,
      0,
      "amendmentCount is non-zero for a company with no contractAmendment rows — the " +
        "carrier's annex trail has leaked into the member's own count",
    );
  },
);

test.skipIf(skipAnnex)(
  "the contract_id half of the carrier predicate is load-bearing (mutation check)",
  async () => {
    // Without this, an ocid-ONLY carrier lookup passes every assertion above: it still
    // returns a carrier row, with a plausible annexCount, and the per-row checks would agree
    // with whatever it chose. The reference OCID carries THREE carrier rows, so stripping
    // `contract_id` from the DEPLOYED body inside a rolled-back transaction must MOVE the
    // answer. The assertion is `notEqual` rather than a literal on purpose: which of the
    // three carriers the mutated `ORDER BY c.key LIMIT 1` lands on is a property of the
    // corpus's key ordering, not of the rule, so pinning a number here would be a gate
    // that fails on an unrelated re-ingest.
    await withClient(async (c) => {
      await c.query("BEGIN");
      try {
        const {
          rows: [{ def }],
        } = await c.query<{ def: string }>(
          "SELECT pg_get_functiondef('company_procurement(text,text,text)'::regprocedure) AS def",
        );
        const needle =
          /\s*AND\s+COALESCE\(c\.contract_id,\s*''\)\s*=\s*COALESCE\(b\.contract_id,\s*''\)/;
        assert.match(
          def,
          needle,
          "the deployed body does not join the carrier on contract_id — an ocid-only lookup " +
            "can return a DIFFERENT consortium's contract and its annexes",
        );
        const {
          rows: [before],
        } = await c.query<{ n: number }>(
          "SELECT (company_procurement($1)->>'consortiumAnnexCount')::int AS n",
          [MEMBER_ONLY_EIK],
        );
        await c.query(def.replace(needle, ""));
        const {
          rows: [after],
        } = await c.query<{ n: number }>(
          "SELECT (company_procurement($1)->>'consortiumAnnexCount')::int AS n",
          [MEMBER_ONLY_EIK],
        );
        assert.notEqual(
          after?.n,
          before?.n,
          `dropping the contract_id conjunct left consortiumAnnexCount at ${before?.n}. The ` +
            "reference company no longer discriminates between the carriers on its ocid, so " +
            "nothing here can catch an ocid-only regression — pick a reference whose ocid " +
            "carries several carrier rows.",
        );
      } finally {
        await c.query("ROLLBACK").catch(() => {});
      }
    });
  },
);

test.skipIf(skipAnnex)(
  "the headline annex count is UNBOUNDED, not the listed 25",
  async () => {
    // `conslist` is LIMIT 25 by design, so a headline summed from the list would under-report
    // exactly the firms with the most joint work — and no assertion on the reference company
    // (2 joint contracts) can see that. Measured 2026-09-21 on the corpus's busiest member.
    const [r] = await allRows<{
      eik: string;
      total: number;
      listed: number;
      n: number;
      listed_sum: number;
    }>(
      `WITH victim AS (
         SELECT contractor_eik AS eik FROM contracts
          WHERE consortium_role = 'member' AND contractor_eik NOT LIKE 'obed-%'
          GROUP BY 1 ORDER BY count(*) DESC, contractor_eik LIMIT 1)
       SELECT v.eik,
              (p->>'consortiumAnnexCount')::int AS total,
              jsonb_array_length(p->'consortiumContracts') AS listed,
              (p->>'consortiumCount')::int AS n,
              (SELECT COALESCE(SUM((e->>'annexCount')::int), 0)
                 FROM jsonb_array_elements(p->'consortiumContracts') e) AS listed_sum
         FROM victim v, LATERAL (SELECT company_procurement(v.eik) p) q`,
    );
    assert.ok(
      Number(r?.n) > Number(r?.listed),
      `${r?.eik} lists all ${r?.listed} of its joint contracts, so it cannot demonstrate the ` +
        "cap — no company in the corpus has more than 25 any more",
    );
    assert.ok(
      Number(r?.total) > Number(r?.listed_sum),
      `consortiumAnnexCount (${r?.total}) is not greater than the listed sum ` +
        `(${r?.listed_sum}) for ${r?.eik}, which has ${r?.n} joint contracts against ` +
        `${r?.listed} listed — the headline is being summed from the truncated list`,
    );
  },
);

test.skipIf(skipAnnex)(
  "the person half dedupes a shared consortium before counting its annexes",
  async () => {
    // 024's `partic` dedupes by (ocid, contract_id) so two of a person's companies in the
    // SAME consortium count that joint contract ONCE, and `carannex` is built FROM `partic`
    // so the annex count inherits it. The subject must actually exercise that: Георги
    // Манолов's folds have no multi-company group, so he cannot tell a deduped count from a
    // multiplied one. Камен Симеонов Пешов does — 91 raw member rows fold to 47 joint
    // contracts across 23 shared groups (measured 2026-09-21).
    const [r] = await allRows<{
      annexes: number;
      n: number;
      listed: number;
      raw_rows: string;
      shared_groups: string;
    }>(
      `SELECT (p->>'consortiumAnnexCount')::int AS annexes,
              (p->>'consortiumCount')::int      AS n,
              jsonb_array_length(p->'consortiumContracts') AS listed,
              (SELECT count(*) FROM contracts c
                 JOIN tr_officers o ON o.uic = c.contractor_eik
                WHERE o.name_fold = translit_bg_latin($1)
                  AND c.consortium_role = 'member')                    AS raw_rows,
              (SELECT count(*) FROM (
                 SELECT 1 FROM contracts c
                   JOIN tr_officers o ON o.uic = c.contractor_eik
                  WHERE o.name_fold = translit_bg_latin($1)
                    AND c.consortium_role = 'member'
                  GROUP BY c.ocid, COALESCE(c.contract_id, '')
                 HAVING count(DISTINCT c.contractor_eik) > 1) g)        AS shared_groups
         FROM (SELECT person_procurement($1, NULL, NULL) p) q`,
      [DEDUPE_PERSON],
    );
    assert.ok(
      Number(r?.shared_groups ?? 0) > 0,
      `${DEDUPE_PERSON} no longer has a consortium two of their companies both sit in, so ` +
        "this test cannot tell a deduped count from a multiplied one — pick another subject",
    );
    assert.ok(
      (r?.annexes ?? 0) > 0,
      "person_procurement reports no carrier annexes — apply 024_person_api.sql",
    );
    assert.ok(
      Number(r?.n) < Number(r?.raw_rows),
      `consortiumCount ${r?.n} is not below the ${r?.raw_rows} raw member rows — the dedupe ` +
        "is not firing, so the annex count is multiplied by the companies in each group",
    );
    assert.equal(
      Number(r?.listed),
      Math.min(Number(r?.n), 25),
      "the person's consortiumContracts list disagrees with consortiumCount (allowing the " +
        "LIMIT 25 cap)",
    );

    // The per-row fields on the PERSON payload, which nothing else covers: 024's headline is
    // computed from `carannex` directly, so a broken `LEFT JOIN carannex ca ON
    // ca.member_key = partic.key` in `conslist` leaves every listed row with a null carrier
    // and the headline still correct.
    const [rows] = await allRows<{
      rows: { key: string; carrierKey: string; annexCount: number }[];
    }>(
      `SELECT (person_procurement($1, NULL, NULL)->'consortiumContracts') AS rows`,
      [DEDUPE_PERSON],
    );
    await assertCarrierRows(rows?.rows ?? [], "person");
  },
);

test.skipIf(skipAnnex)(
  "024's carrier predicate is load-bearing too (mutation check)",
  async () => {
    // 011 gets its own mutation check; 024 needs a SEPARATE one, because the two carry
    // independent copies of the carrier CTE and a fix to one does not reach the other.
    //
    // ⚠️ The signal is PER-ROW, not the headline. Measured 2026-09-21: stripping the
    // conjunct leaves `consortiumAnnexCount` at 29 for every person fold tried — the annex
    // totals of the wrongly-picked carriers happen to coincide — while 3 of 25 listed rows
    // change their `carrierKey`. So an aggregate assertion here would be vacuous and look
    // fine, which is exactly the class of defect these mutation checks exist to catch.
    await withClient(async (c) => {
      await c.query("BEGIN");
      try {
        const {
          rows: [{ def }],
        } = await c.query<{ def: string }>(
          "SELECT pg_get_functiondef('person_procurement(text,text,text)'::regprocedure) AS def",
        );
        const needle =
          /\s*AND\s+COALESCE\(c\.contract_id,\s*''\)\s*=\s*COALESCE\(p\.contract_id,\s*''\)/;
        assert.match(
          def,
          needle,
          "024's deployed body does not join the carrier on contract_id — an ocid-only " +
            "lookup can return another consortium's contract and its annexes",
        );
        const carriers = async () => {
          const { rows } = await c.query<{ k: string; ck: string | null }>(
            `SELECT e->>'key' AS k, e->>'carrierKey' AS ck
               FROM jsonb_array_elements(
                      person_procurement($1, NULL, NULL)->'consortiumContracts') e`,
            [DEDUPE_PERSON],
          );
          return new Map(rows.map((r) => [r.k, r.ck]));
        };
        const before = await carriers();
        await c.query(def.replace(needle, ""));
        const after = await carriers();
        const changed = [...before].filter(
          ([k, v]) => after.get(k) !== v,
        ).length;
        assert.ok(
          changed > 0,
          `dropping the contract_id conjunct changed none of the ${before.size} listed ` +
            `carriers for ${DEDUPE_PERSON}. This subject no longer discriminates, so nothing ` +
            "here can catch an ocid-only regression in 024 — pick a fold whose member rows " +
            "sit on an ocid carrying several carrier rows.",
        );
      } finally {
        await c.query("ROLLBACK").catch(() => {});
      }
    });
  },
);

test.skipIf(skip)(
  "person_procurement stays cheap on the busiest real fold",
  async () => {
    // 011 has a ceiling; `/person/{slug}` is the family walked hardest by crawlers under the
    // 10 s statement_timeout, so 024 needs one too. Measured 2026-09-21 on Огнян Иванов
    // Донев (83 joint contracts): 9,009 buffers with a temp spill, of which T2's annex
    // subquery is ~226 (2.6%) — stripping it measures 8,783 with an IDENTICAL spill, so the
    // spill is `base AS MATERIALIZED` over the portfolio and predates this change.
    //
    // ⚠️ Deliberately NOT the busiest fold overall. That is „Заличено обстоятелство." — the
    // register's deleted-fact placeholder, which pools thousands of unrelated companies and
    // reads 47,733 buffers. It is not a person, every other surface in this repo excludes it
    // by name, and pinning a ceiling to it would measure the placeholder rather than the code.
    const [{ name }] = await allRows<{ name: string }>(
      `SELECT min(o.name) AS name
         FROM contracts c JOIN tr_officers o ON o.uic = c.contractor_eik
        WHERE c.consortium_role = 'member'
          AND o.name_fold <> translit_bg_latin('Заличено обстоятелство.')
        GROUP BY o.name_fold
        ORDER BY count(*) DESC, min(o.name)
        LIMIT 1`,
    );
    const rows = await allRows<{ "QUERY PLAN": string }>(
      `EXPLAIN (ANALYZE, BUFFERS, TIMING OFF) SELECT person_procurement($1, NULL, NULL)`,
      [name],
    );
    const plan = rows.map((r) => r["QUERY PLAN"]).join("\n");
    const buffers = [...plan.matchAll(/shared hit=(\d+)(?: read=(\d+))?/g)]
      .map((m) => Number(m[1]) + Number(m[2] ?? 0))
      .reduce((a, b) => Math.max(a, b), 0);
    assert.ok(
      buffers < 30000,
      `person_procurement('${name}') reads ${buffers} buffers (measured 2026-09-21: ~9,000 ` +
        `on the busiest real fold). The ceiling is generous — blowing it means the carrier ` +
        `lookup stopped being an index scan.\n${plan}`,
    );
  },
);

test.skipIf(skipAnnex)(
  "the annex arm reaches a non-trivial share of member-only companies",
  async () => {
    // Guards against a lookup that silently matches nothing: a LEFT JOIN that never finds a
    // carrier returns annexCount 0 everywhere and every assertion above still passes.
    const [r] = await allRows<{ with_annexes: string; n: string }>(
      `WITH per AS (
         SELECT contractor_eik,
                count(*) FILTER (WHERE tag = 'contract'
                                   AND consortium_role IS DISTINCT FROM 'member') AS own_rows,
                count(*) FILTER (WHERE consortium_role = 'member')                AS mem
           FROM contracts WHERE contractor_eik NOT LIKE 'obed-%' GROUP BY 1),
       p AS (SELECT company_procurement(contractor_eik) j
               FROM per WHERE own_rows = 0 AND mem > 0)
       SELECT count(*) FILTER (WHERE (j->>'consortiumAnnexCount')::int > 0) AS with_annexes,
              count(*) AS n
         FROM p`,
    );
    // Measured 2026-09-21: 387 of 1,172. The floor is deliberately far below that — this
    // asserts the arm WORKS, not that the corpus holds a particular number of annexes.
    assert.ok(
      Number(r?.with_annexes ?? 0) > 50,
      `only ${r?.with_annexes} of ${r?.n} member-only companies resolve any carrier annexes ` +
        "— the (ocid, contract_id) carrier lookup is probably matching nothing",
    );
  },
);

test.skipIf(skip)(
  "the carrier lookup stays cheap on the worst case in the corpus",
  async () => {
    // The lookup is per member row, so its cost scales with how much joint work a firm has.
    // The carrier is resolved ONCE (the `carannex` CTE) and shared by the headline and the
    // per-contract list; doing it twice measured 3,279 buffers here against 2,225 now. Both
    // sides ride index scans (idx_contracts_ocid, then an Index Only Scan on
    // idx_procurement_annexes_contract) — a plan that loses either goes to a seq scan of a
    // 411k-row table on a page a crawler walks under a 10 s statement_timeout.
    const [{ eik }] = await allRows<{ eik: string }>(
      `SELECT contractor_eik AS eik FROM contracts
        WHERE consortium_role = 'member' AND contractor_eik NOT LIKE 'obed-%'
        GROUP BY 1 ORDER BY count(*) DESC, contractor_eik LIMIT 1`,
    );
    const rows = await allRows<{ "QUERY PLAN": string }>(
      `EXPLAIN (ANALYZE, BUFFERS, TIMING OFF) SELECT company_procurement($1)`,
      [eik],
    );
    const plan = rows.map((r) => r["QUERY PLAN"]).join("\n");
    const buffers = [...plan.matchAll(/shared hit=(\d+)(?: read=(\d+))?/g)]
      .map((m) => Number(m[1]) + Number(m[2] ?? 0))
      .reduce((a, b) => Math.max(a, b), 0);
    assert.ok(
      buffers < 8000,
      `company_procurement('${eik}') reads ${buffers} buffers (measured 2026-09-21: ~2,260 ` +
        `on the worst case). The ceiling is generous — blowing it means the carrier lookup ` +
        `stopped being an index scan.\n${plan}`,
    );
    // ⚠️ NO `assert.doesNotMatch(plan, /Seq Scan on contracts/)` HERE, and that is deliberate:
    // it could never fail. `company_procurement` is `LANGUAGE sql` but not inlinable (it is a
    // scalar over a CTE chain), so EXPLAIN of a call to it prints ONE `Result` node and no
    // inner plan at all — verified by disabling every index scan, which took the call to
    // 9.08M buffers and 13.8 s while the regex still found nothing to match. The buffer
    // ceiling above is what actually discriminates.
  },
);
