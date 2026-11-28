// The national ↔ local merge tier (cluster.ts `unionNationalLocal`) reached the person
// layer.
//
// Before that tier, a councillor or mayor who later stood for or sat in parliament was
// TWO public people — two /person pages, and Bridge B then refused their Commerce-Registry
// companies because two `person` rows shared the fold. Measured 2026-11-23: 490 such pairs,
// 73 left after the first resolve with the tier.
//
// ⚠️ It runs against LOCAL Postgres only (`pinLocalDatabase`) and SKIPS with its own reason
// on a corpus no resolve has rebuilt since the tier shipped — "the layer predates the rule"
// must never read as "the rule is enforced".
//
//   pnpm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end, pinLocalDatabase } from "../lib/pg";
import { reportSkip } from "../../lib/report_skip";

pinLocalDatabase();

// Folds that were split before the tier and must be ONE active person after it.
// Джипов is the case that found the defect; Фандъкова is the highest-profile one and the
// only one that joins through the Sofia-city key.
const CANARIES = ["dzhipo nikolov dzhipov", "yordanka asenova fandakova"];

// The class the tier exists to collapse: same 3-part fold, both active; one side holds an
// mp/candidate role in a МИР, the other ONLY local roles in an община of the same oblast,
// for the same party. Mirrors `oblastKeyFor` (Sofia city is its own key; PDV-00 is PDV).
const RESIDUAL_SQL = `
  WITH nat AS (
    SELECT DISTINCT p.person_id, p.name_fold, pr.party,
           CASE WHEN pr.place_code IN ('S23','S24','S25') THEN 'SOFIA_CITY'
                WHEN pr.place_code = 'PDV-00' THEN 'PDV' ELSE pr.place_code END AS ob
      FROM person p JOIN person_role pr USING (person_id)
     WHERE p.status = 'active' AND p.name_parts = 3
       AND pr.source IN ('mp','candidate') AND pr.place_kind = 'mir' AND pr.party IS NOT NULL),
  loc AS (
    SELECT DISTINCT p.person_id, p.name_fold, pr.party,
           CASE WHEN pr.place_code = 'SFO_CITY' OR pr.place_code ~ '^S2[345]' THEN 'SOFIA_CITY'
                ELSE left(pr.place_code, 3) END AS ob
      FROM person p JOIN person_role pr USING (person_id)
     WHERE p.status = 'active' AND p.name_parts = 3
       AND pr.source = 'local' AND pr.place_kind = 'obshtina' AND pr.party IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM person_role x
                        WHERE x.person_id = p.person_id AND x.source IN ('mp','candidate')))
  SELECT count(DISTINCT (n.person_id, l.person_id))::int AS n
    FROM nat n JOIN loc l USING (name_fold, party, ob)
   WHERE l.person_id <> n.person_id`;

// What is left is what the tier refuses on purpose: contested keys, mass names, a
// component that would take two partners. 73 on the first resolve; the ceiling leaves room
// for corpus growth while staying far below the 490 a layer WITHOUT the tier shows, so a
// tier that silently stopped firing cannot pass.
const RESIDUAL_MAX = 150;
const PRE_TIER_FLOOR = 400;

const activeCount = async (fold: string): Promise<number> => {
  const [r] = await allRows<{ n: number }>(
    `SELECT count(*)::int AS n FROM person WHERE status = 'active' AND name_fold = $1`,
    [fold],
  );
  return r.n;
};

const state = await (async (): Promise<string | false> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      `SELECT to_regclass('public.person_role') IS NOT NULL AS ok`,
    );
    if (!t?.ok) return "Postgres unreachable / no person layer";
    const counts = await Promise.all(CANARIES.map(activeCount));
    if (counts.some((c) => c === 0))
      return "a canary person is absent from this corpus";
    if (counts.every((c) => c > 1))
      return "person layer predates the national↔local tier — run db:resolve:persons";
    return false;
  } catch {
    return "Postgres unreachable / no person layer";
  }
})();
reportSkip(import.meta.url, state);

afterAll(async () => {
  await end();
});

test.skipIf(state)("every canary is ONE active person", async () => {
  for (const f of CANARIES) assert.equal(await activeCount(f), 1, f);
});

test.skipIf(state)(
  "Bridge B now attaches Джипов's companies — the symptom that found the defect",
  async () => {
    const rows = await allRows<{ ref: string }>(
      `SELECT pr.ref FROM person p JOIN person_role pr USING (person_id)
        WHERE p.status = 'active' AND p.name_fold = 'dzhipo nikolov dzhipov'
          AND pr.source = 'tr'`,
    );
    const eiks = new Set(rows.map((r) => r.ref));
    assert.ok(eiks.has("116011316"), "МАТ ООД");
    assert.ok(eiks.has("206034748"), "МАТ 2020 ЕООД");
  },
);

test.skipIf(state)(
  "the split class collapsed — and is far below the pre-tier count",
  async () => {
    const [r] = await allRows<{ n: number }>(RESIDUAL_SQL);
    process.stderr.write(`national↔local residual pairs: ${r.n}\n`);
    assert.ok(
      r.n <= RESIDUAL_MAX,
      `${r.n} national/local pairs still split (max ${RESIDUAL_MAX}; ${PRE_TIER_FLOOR}+ means the tier is not firing)`,
    );
  },
);

test.skipIf(state)("Sofia CITY never joins Sofia PROVINCE", async () => {
  // A Столична община term and a Софийска област МИР on one person, with no Sofia-city
  // МИР to explain it, is the exact wrong merge `oblastKeyFor` exists to prevent.
  const [r] = await allRows<{ n: number }>(
    `SELECT count(*)::int AS n FROM person p
        WHERE p.status = 'active'
          AND EXISTS (SELECT 1 FROM person_role x WHERE x.person_id = p.person_id
                       AND x.source = 'local' AND x.place_code = 'SFO_CITY')
          AND EXISTS (SELECT 1 FROM person_role x WHERE x.person_id = p.person_id
                       AND x.place_kind = 'mir' AND x.place_code = 'SFO')
          AND NOT EXISTS (SELECT 1 FROM person_role x WHERE x.person_id = p.person_id
                       AND x.place_kind = 'mir' AND x.place_code IN ('S23','S24','S25'))`,
  );
  assert.equal(r.n, 0);
});

test.skipIf(state)(
  "the retired local slugs redirect to the merged person",
  async () => {
    const rows = await allRows<{ slug: string; target_slug: string }>(
      `SELECT slug, target_slug FROM person_slug_retired
        WHERE slug IN ('mp-5202-2', 'mp-5249-2')`,
    );
    const by = new Map(rows.map((r) => [r.slug, r.target_slug]));
    assert.equal(by.get("mp-5202-2"), "mp-5202");
    assert.equal(by.get("mp-5249-2"), "mp-5249");
  },
);
