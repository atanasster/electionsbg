// company_political_links (migration 158) — the live replacement for the frozen
// parliament/company-connections/{eik}.json shard family that the AI chat's
// `companyConnections` tool read.
//
//   npm run test:data
//
// The claim this file gates is NOT "the function returns rows". It is:
//
//   1. a DIRECT link says the same thing about a person that their own /person profile says
//      (one company, two surfaces, one answer — tr-attribution-basis-v1 §0.2);
//   2. every BRIDGED link's bridge is a fold the Commerce Registry itself says is ONE human,
//      checked against tr_name_fold_people directly rather than trusted from the function;
//   3. the office floor is not a silent coupling — every person_source is pinned here, so a
//      re-ranking in 120 that changes what counts as "in office" goes red;
//   4. the subject-scoped rewrite has not regressed to the whole-corpus scan it replaced.
//
// Requires Postgres + the person layer + a loaded tr_name_fold_people. Auto-skips only when
// Postgres is unreachable; it does NOT skip on an unapplied 158 or an empty guard table —
// those are states it exists to catch.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PoolClient } from "pg";
import { allRows, withClient, end } from "../lib/pg";
import { sumExecutionBuffers } from "../lib/explain_buffers";
import { LOCAL_ROLE_LABEL } from "../../../ai/tools/officeLabel";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const SHARD_DIR = path.join(ROOT, "data/parliament/company-connections");

const one = async <T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T> => (await allRows<T>(sql, params))[0];

const reachable = await allRows("SELECT 1")
  .then(() => true)
  .catch(() => false);
const skip = reachable ? false : "Postgres unreachable";

afterAll(async () => {
  await end();
});

test.skipIf(skip)("158 is applied and both functions answer", async () => {
  const r = await one<{ links: string; office: string }>(
    `SELECT (SELECT count(*) FROM pg_proc WHERE proname = 'company_political_links') AS links,
            (SELECT count(*) FROM pg_proc WHERE proname = 'person_role_is_office')   AS office`,
  );
  assert.equal(
    Number(r.links),
    1,
    "company_political_links is absent — apply 158_company_political_links.sql. " +
      "/api/db/company-connections degrades to null, so the AI tool answers 'no links on " +
      "record' for every company instead of erroring; nothing else reports this.",
  );
  assert.equal(
    Number(r.office),
    1,
    "person_role_is_office is absent — apply 158",
  );

  // An unknown EIK is a SHAPED EMPTY, not NULL. The tool distinguishes "no links" from "route
  // unavailable", and returning NULL here would make a real company with no links read to the
  // consumer exactly like a database that never ran the migration.
  const miss = await one<{ r: Record<string, unknown> }>(
    `SELECT company_political_links('999999999') AS r`,
  );
  assert.ok(miss.r, "an unknown EIK must yield a payload, not NULL");
  assert.equal(miss.r.directCount, 0);
  assert.equal(miss.r.bridgedCount, 0);
  assert.deepEqual(miss.r.direct, []);
});

test.skipIf(skip)(
  "the corpus is populated — every assertion below is vacuous without this",
  async () => {
    // ORDERED FIRST, and load-bearing. Each later test counts VIOLATIONS, and every one of
    // those counts is 0 on an empty person layer or an empty fold table: nothing published,
    // nothing to violate. The floors sit far below today's values (199k gated roles, 456k
    // folds, 1.34M officer rows) so ordinary churn does not trip them.
    const r = await one<{ gated: string; folds: string; officers: string }>(
      `SELECT (SELECT count(*) FROM person_role
                WHERE source IN ('tr','ngo')
                  AND confidence IN ('exact_id','high','manual')) AS gated,
              (SELECT count(*) FROM tr_name_fold_people)          AS folds,
              (SELECT count(*) FROM tr_person_roles)              AS officers`,
    );
    assert.ok(
      Number(r.gated) > 10_000,
      `only ${r.gated} gated tr/ngo roles — run db:resolve:persons. Zero rows means zero ` +
        `violations and this whole file goes green while asserting nothing.`,
    );
    assert.ok(
      Number(r.folds) > 100_000,
      `tr_name_fold_people holds ${r.folds} folds — run db:load:tr-name-fold-people:pg. ` +
        `With it empty every fold reads as unmeasured and the bridged arm publishes nothing.`,
    );
    assert.ok(
      Number(r.officers) > 500_000,
      `only ${r.officers} rows in tr_person_roles — run db:load:tr:pg.`,
    );
  },
);

// ---------------------------------------------------------------------------------------
// 1. The office floor is PINNED, because it is a coupling and not a derivation
// ---------------------------------------------------------------------------------------
// `person_role_is_office` is `role_prominence(...) >= 42`, which is true today only because
// 120's ladder happens to put `historic_mp` (an office) at 42 directly above `ds` (40) and
// `sanctions` (38). Nothing in `role_prominence` DECLARES 42 to be an office boundary — a new
// source slotted at 43 for ranking reasons, or a re-rank of an existing one, would silently
// change who this function calls a person in power. So every source is pinned by hand here.
//
// To extend: add the new key with a deliberate true/false. The exhaustiveness assert below
// makes that mandatory rather than optional.
const OFFICE_BY_SOURCE: Record<string, boolean> = {
  // Posts a person HOLDS.
  mp: true,
  historic_mp: true,
  mep: true,
  president: true,
  official_exec: true,
  official_muni: true,
  public_sector: true,
  diplomat: true,
  magistrate: true,
  regulator: true,
  // Councillors and mayors. The source is labelled „Местни кандидати и съветници" and so mixes
  // in people who merely RAN; `role_prominence` ranks the whole source above the floor, which
  // is the known over-admission here. It is the safe direction for this tool (a losing
  // candidate is at worst an over-inclusive lead, never a withheld office) and the row still
  // names the role, so a reader sees „Общински съветник" rather than an implied office.
  local: true,

  // Facts ABOUT a person, not posts.
  ds: false,
  sanctions: false,
  // Ran; may not have won. The whole point of the floor.
  candidate: false,
  donor: false,
  // Private-sector and professional roles — the thing we are linking FROM, not to.
  tr: false,
  ngo: false,
  concession: false,
  academic: false,
  professional: false,
  media: false,
  honours: false,
  other: false,
};

test.skipIf(skip)(
  "person_role_is_office classifies every person_source, and as pinned here",
  async () => {
    const rows = await allRows<{ key: string; is_office: boolean }>(
      // One representative role per source: for `local` the classification is role-dependent
      // (mayor 50, else 45) and both sides are above the floor, so any role answers for it.
      `SELECT s.key,
              person_role_is_office(s.key, COALESCE(
                (SELECT r.role FROM person_role r WHERE r.source = s.key
                  ORDER BY r.role LIMIT 1), '')) AS is_office
         FROM person_source s ORDER BY s.key`,
    );
    assert.ok(
      rows.length > 5,
      "person_source is empty — the person layer is not loaded",
    );
    const unpinned = rows
      .filter((r) => !(r.key in OFFICE_BY_SOURCE))
      .map((r) => r.key);
    assert.deepEqual(
      unpinned,
      [],
      `person_source gained ${unpinned.join(", ")} and OFFICE_BY_SOURCE in this file does ` +
        `not classify it. Decide deliberately whether it is an OFFICE: an unclassified new ` +
        `source silently joins or leaves the set that companyConnections calls "in power".`,
    );
    const wrong = rows
      .filter((r) => r.is_office !== OFFICE_BY_SOURCE[r.key])
      .map(
        (r) =>
          `${r.key}: is_office=${r.is_office}, pinned=${OFFICE_BY_SOURCE[r.key]}`,
      );
    assert.deepEqual(
      wrong,
      [],
      `role_prominence's ordering has moved a source across the office floor (42):\n  ` +
        wrong.join("\n  ") +
        `\nIf that is intended, change the pin AND read 158's header — the floor is a ` +
        `coupling to 120's ladder, not something derived from it.`,
    );
    // Both sides must be non-empty or the comparison is satisfied by an accident.
    assert.ok(
      rows.some((r) => r.is_office) && rows.some((r) => !r.is_office),
      "the floor put every source on one side — it has stopped discriminating",
    );
  },
);

test.skipIf(skip)(
  "every `local` role has an office label, so no mayor narrates as a candidacy",
  async () => {
    // `officeLabel` overrides the source label for `local` only, and the override map must stay
    // exhaustive over that source: `person_source.label_bg` there is „Местни кандидати и
    // съветници", so an unmapped role renders a sitting mayor as somebody who ran. Both
    // village_mayor (8,301 roles) and rayon_mayor (46) were doing exactly that before the map
    // was extended.
    const roles = await allRows<{ role: string }>(
      `SELECT DISTINCT role FROM person_role WHERE source = 'local' ORDER BY role`,
    );
    assert.ok(
      roles.length > 0,
      "no local roles in the corpus — this assertion is vacuous",
    );
    const missing = roles
      .map((r) => r.role)
      .filter((r) => !(r in LOCAL_ROLE_LABEL));
    assert.deepEqual(
      missing,
      [],
      `ai/tools/officeLabel.ts has no label for local role(s) ${missing.join(", ")} — they ` +
        `narrate as „Местни кандидати и съветници", which claims a candidacy, not an office.`,
    );
  },
);

// ---------------------------------------------------------------------------------------
// 2. A direct link says what the person's own profile says
// ---------------------------------------------------------------------------------------
test.skipIf(skip)(
  "every DIRECT link is a company that person_by_slug also serves for that person",
  async () => {
    // THE anti-drift gate, and the reason this is a function over person_role rather than a
    // table with its own rule. If the two diverge, a reader asking about the COMPANY and a
    // reader asking about the PERSON are told different things about the same pair.
    //
    // ⚠️ TWO OBVIOUS MUTATIONS ARE INERT ON THIS CORPUS — checked, so nobody re-derives that
    // this gate is vacuous. Widening the direct arm's confidence set to include 'medium' and
    // 'review' changes nothing (there are ZERO tr/ngo rows at those confidences), and dropping
    // the person eligibility filter changes nothing either (ZERO gated tr/ngo roles belong to
    // an ineligible person). What DOES prove the assertion discriminates is fabricating the
    // defect it names: make `direct_role` read `r.ref = p_eik OR r.ref = '831646048'` and it
    // fails with 5,200 divergent pairs.
    //
    // ⚠️ THE YARDSTICK IS 082's ACTUAL PAYLOAD, not a restatement of this function's own
    // predicate — rebuilding `person_role … source IN ('tr','ngo') AND confidence IN (…)` on
    // the right-hand side would assert that the query equals itself. And it compares against
    // the UNION of `companies` (source tr) and `ngos` (source ngo), since 082 splits the set
    // that this function returns whole — the partition difference 150's test documents.
    const r = await one<{ n: string; served: string; bad: string | null }>(
      `WITH sample AS (
         -- A deterministic slice of companies that HAVE a direct link, big enough to catch a
         -- systematic divergence and small enough to run in seconds.
         SELECT DISTINCT r.ref AS uic
           FROM person_role r JOIN person p ON p.person_id = r.person_id
          WHERE r.source IN ('tr','ngo') AND r.confidence IN ('exact_id','high','manual')
            AND p.status = 'active' AND p.is_public_figure
          ORDER BY r.ref LIMIT 400
       ),
       fn AS (
         SELECT s.uic, d ->> 'slug' AS slug
           FROM sample s
           CROSS JOIN LATERAL jsonb_array_elements(
                        company_political_links(s.uic, 200) -> 'direct') d
       ),
       profile AS (
         SELECT f.uic, f.slug,
                jsonb_array_elements(
                  COALESCE(pb.r -> 'companies', '[]'::jsonb) ||
                  COALESCE(pb.r -> 'ngos', '[]'::jsonb)) ->> 'eik' AS eik
           FROM (SELECT DISTINCT slug, uic FROM fn) f
           CROSS JOIN LATERAL (SELECT person_by_slug(f.slug) AS r) pb
          WHERE pb.r IS NOT NULL
       )
       SELECT (SELECT count(*) FROM fn) AS served,
              (SELECT count(*) FROM (
                 SELECT DISTINCT uic, slug FROM fn
                 EXCEPT
                 SELECT DISTINCT uic, slug FROM profile WHERE eik = uic) x) AS n,
              (SELECT string_agg(uic || ' / ' || slug, ', ') FROM (
                 SELECT DISTINCT uic, slug FROM fn
                 EXCEPT
                 SELECT DISTINCT uic, slug FROM profile WHERE eik = uic
                 LIMIT 5) y) AS bad`,
    );
    assert.ok(
      Number(r.served) > 100,
      `only ${r.served} direct links served over the sample; the equality below would pass ` +
        `on an empty set`,
    );
    assert.equal(
      Number(r.n),
      0,
      `${r.n} (company, person) direct links are published here but absent from that ` +
        `person's own profile — e.g. ${r.bad}. One pair, two answers.`,
    );
  },
  300_000,
);

// ---------------------------------------------------------------------------------------
// 3. The bridged arm's two guards, checked independently of the function
// ---------------------------------------------------------------------------------------
test.skipIf(skip)(
  "every BRIDGED link runs through a fold the registry says is ONE person",
  async () => {
    // Checked by joining `tr_name_fold_people` DIRECTLY, not by re-reading anything the
    // function returned — the same reason 150's test joins the guard table rather than
    // trusting `person.fold_people_n`: a test that reads the function's own gate agrees with
    // it even when both are wrong.
    //
    // Zero is the passing value in BOTH directions the guard covers: `people_n > 1` is a proven
    // namesake collision, and an ABSENT row is unmeasured, which 148's three-state note says
    // must NOT be treated as unique.
    const r = await one<{
      checked: string;
      bad: string;
      sample: string | null;
    }>(
      `WITH sample AS (
         SELECT DISTINCT t.uic
           FROM tr_person_roles t
           JOIN tr_name_fold_people f ON f.name_fold = t.name_fold AND f.people_n = 1
          ORDER BY t.uic LIMIT 300
       ),
       rows AS (
         SELECT s.uic, b ->> 'bridgeName' AS bridge_name
           FROM sample s
           CROSS JOIN LATERAL jsonb_array_elements(
                        company_political_links(s.uic, 200) -> 'bridged') b
       ),
       judged AS (
         SELECT r.uic, r.bridge_name, f.people_n
           FROM rows r
           LEFT JOIN tr_name_fold_people f
                  ON f.name_fold = translit_bg_latin(r.bridge_name)
       )
       SELECT (SELECT count(*) FROM judged) AS checked,
              (SELECT count(*) FROM judged WHERE people_n IS DISTINCT FROM 1) AS bad,
              (SELECT string_agg(uic || ' via ' || bridge_name, ', ')
                 FROM (SELECT * FROM judged WHERE people_n IS DISTINCT FROM 1 LIMIT 5) z)
              AS sample`,
    );
    assert.ok(
      Number(r.checked) > 50,
      `only ${r.checked} bridged rows over the sample; this assertion cannot discriminate`,
    );
    assert.equal(
      Number(r.bad),
      0,
      `${r.bad} bridged links run through a fold that is shared or unmeasured — e.g. ` +
        `${r.sample}. That is the namesake claim the whole person layer stopped making.`,
    );
  },
  300_000,
);

test.skipIf(skip)(
  "the bridge cap is enforced, reported, and a person is never in both arms",
  async () => {
    const r = await one<{
      checked: string;
      over: string;
      dupes: string;
      unreported: string;
      cap: string;
      suppressing: string;
    }>(
      `WITH sample AS (
         SELECT DISTINCT t.uic FROM tr_person_roles t ORDER BY t.uic LIMIT 400
       ),
       p AS (SELECT s.uic, company_political_links(s.uic, 200) AS j FROM sample s)
       SELECT count(*) AS checked,
              -- No emitted bridge may exceed the cap the payload declares.
              count(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM jsonb_array_elements(j -> 'bridged') b
                 WHERE (b ->> 'bridgeCompanies')::int > (j ->> 'bridgeMaxCompanies')::int
              )) AS over,
              -- A person in the direct arm must never reappear as a bridged lead: the tool
              -- renders the two with different wording, so the same human would be described
              -- to the reader twice, once as an officer here and once as a distant lead.
              count(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM jsonb_array_elements(j -> 'direct') d
                  JOIN jsonb_array_elements(j -> 'bridged') b
                    ON b ->> 'slug' = d ->> 'slug'
              )) AS dupes,
              -- The cap must never be silent: a company whose officers were ALL too busy to
              -- traverse has to be distinguishable from one that simply has no second-degree
              -- link, or "no connections found" overstates what was actually looked at.
              count(*) FILTER (WHERE j -> 'bridgeFoldsSuppressed' IS NULL
                                  OR j -> 'bridgeMaxCompanies' IS NULL) AS unreported,
              max((j ->> 'bridgeMaxCompanies')::int) AS cap,
              count(*) FILTER (WHERE (j ->> 'bridgeFoldsSuppressed')::int > 0) AS suppressing
         FROM p`,
    );
    assert.ok(Number(r.checked) > 100, "sample too small to discriminate");
    assert.equal(
      Number(r.over),
      0,
      `${r.over} companies emit a bridge above the declared cap`,
    );
    // ⚠️ PIN THE VALUE, not just the internal consistency. The first cut asserted only
    // `bridgeCompanies <= bridgeMaxCompanies`, which is satisfied by ANY cap because the
    // payload declares whichever one is in force — raising BRIDGE_MAX_COMPANIES from 25 to
    // 1,000 in 158 left this test green. Measured: 25 keeps 26,047 companies answerable
    // against 29,959 uncapped, and the 3,912 it drops are bridges through people holding
    // scores of boards. Changing it is a judgement about signal, so it must be deliberate.
    assert.equal(
      Number(r.cap),
      25,
      `BRIDGE_MAX_COMPANIES is ${r.cap}, not 25. Raising it republishes registered-agent ` +
        `bridges as political connections; lowering it drops real ties. See 158's header.`,
    );
    // And the cap must be DOING something, or the assertion above pins a dead constant.
    assert.ok(
      Number(r.suppressing) > 0,
      `no company in the sample had a bridge suppressed by the cap — either the fold table ` +
        `is empty or the guard has stopped firing, and the pin above gates nothing`,
    );
    assert.equal(
      Number(r.dupes),
      0,
      `${r.dupes} companies list the same person in BOTH arms — a direct officer must not ` +
        `also be published as a second-degree lead`,
    );
    assert.equal(
      Number(r.unreported),
      0,
      `${r.unreported} payloads omit the cap or the suppressed-bridge count`,
    );
  },
  300_000,
);

// ---------------------------------------------------------------------------------------
// 4. Coverage — the move must not have narrowed the answer
// ---------------------------------------------------------------------------------------
test.skipIf(skip)(
  "answers at least as many companies as the shard family it replaced",
  async () => {
    // The shard tree is a gitignored build artifact and step 6 of this migration retires the
    // bucket copy, so it is tolerated as absent — but the absent branch says so OUT LOUD
    // rather than comparing against 0, which would pass vacuously for ever after.
    const shardCount = fs.existsSync(SHARD_DIR)
      ? fs.readdirSync(SHARD_DIR).filter((f) => f.endsWith(".json")).length
      : null;

    const r = await one<{ direct: string; reachable: string }>(
      `WITH office AS (
         SELECT DISTINCT r.person_id FROM person_role r JOIN person p USING (person_id)
          WHERE r.confidence IN ('exact_id','high','manual')
            AND person_role_is_office(r.source, r.role)
            AND p.status = 'active'
            AND (p.is_public_figure OR p.identity_confidence IN ('verified','shared_name'))),
       hot AS (SELECT DISTINCT r.ref AS uic FROM person_role r JOIN office o USING (person_id)
                WHERE r.source IN ('tr','ngo')
                  AND r.confidence IN ('exact_id','high','manual')),
       span AS (SELECT t.name_fold, count(DISTINCT t.uic) AS n FROM tr_person_roles t
                 JOIN tr_name_fold_people f ON f.name_fold = t.name_fold AND f.people_n = 1
                GROUP BY 1),
       athot AS (SELECT DISTINCT s.name_fold FROM tr_person_roles t JOIN hot h ON h.uic = t.uic
                  JOIN span s ON s.name_fold = t.name_fold AND s.n <= 25),
       reach AS (SELECT DISTINCT t.uic FROM tr_person_roles t JOIN athot a USING (name_fold))
       SELECT (SELECT count(*) FROM hot) AS direct,
              (SELECT count(*) FROM (SELECT uic FROM reach UNION SELECT uic FROM hot) z)
              AS reachable`,
    );
    // Absolute floors, so this still gates something once the shard tree is gone. Measured
    // 2026-08-16: 9,982 direct / 26,047 reachable.
    assert.ok(
      Number(r.direct) > 7_000,
      `only ${r.direct} companies carry a direct link (expected ~9,982) — the person layer ` +
        `or the office floor has narrowed`,
    );
    assert.ok(
      Number(r.reachable) > 20_000,
      `only ${r.reachable} companies are answerable (expected ~26,047) — the bridged arm or ` +
        `its cap has narrowed`,
    );
    if (shardCount === null) {
      console.warn(
        `[company_political_links] ${SHARD_DIR} is gone — the shard comparison below is ` +
          `skipped and only the absolute floors above are gating coverage.`,
      );
      return;
    }
    assert.ok(
      Number(r.reachable) >= shardCount,
      `this function answers ${r.reachable} companies against the shard family's ` +
        `${shardCount}. The move was supposed to WIDEN coverage (fewer links per EIK where a ` +
        `name is shared, more companies overall); a shortfall means a gate is over-refusing.`,
    );
  },
  300_000,
);

// ---------------------------------------------------------------------------------------
// 5. Cost — the subject-scoped rewrite must not regress
// ---------------------------------------------------------------------------------------
// The first draft resolved every office-holder in the corpus and then filtered to one company,
// so the expensive half did not depend on p_eik. Measured warm, that body reads ~15,400 buffers
// WITH A TEMP SPILL for every subject alike — 15,430 for a company with no gated roles, 15,885
// for a busy one, 15,430 for an EIK that does not exist. The shipped body reads 75 for the
// empty case. 1,000 sits ~13x above that and ~15x below the control.
//
// Buffers rather than wall-clock on purpose: the same control times 987 ms cold and ~105 ms
// warm, while its buffer count barely moves. `sumExecutionBuffers` counts hit+read for that
// reason (see its header — a hit-only gate is load-dependent and fails in a full run).
const BUFFER_CEILING = 1_000;

const bufferCost = async (c: PoolClient, eik: string): Promise<number> => {
  // Warm this backend's catalog first — a fresh connection carries one-time planning warm-up
  // that scales with the schema, not with how this function plans.
  await c.query("SELECT company_political_links($1)", [eik]);
  const { rows } = await c.query<{ "QUERY PLAN": string }>(
    "EXPLAIN (ANALYZE, BUFFERS) SELECT company_political_links($1)",
    [eik],
  );
  return sumExecutionBuffers(rows);
};

test.skipIf(skip)(
  "costs almost nothing for a company with no links, and the ceiling still discriminates",
  async () => {
    const pick = await one<{ uic: string }>(
      `SELECT t.uic FROM tr_person_roles t
        WHERE NOT EXISTS (SELECT 1 FROM person_role r WHERE r.ref = t.uic
                           AND r.source IN ('tr','ngo'))
        GROUP BY t.uic ORDER BY count(*), t.uic LIMIT 1`,
    );
    assert.ok(
      pick?.uic,
      "no fixture for the empty case — every company has a gated role?",
    );

    const current = await withClient((c) => bufferCost(c, pick.uic));
    console.log(
      `[company_political_links] empty-case cost: ${current} buffers (ceiling ${BUFFER_CEILING})`,
    );
    assert.ok(
      current < BUFFER_CEILING,
      `company_political_links read ${current} buffers for a company with NO links ` +
        `(ceiling ${BUFFER_CEILING}). Every CTE must be subject-scoped — see 158's header on ` +
        `the whole-corpus office CTE this replaced, and 084's on the same defect.`,
    );

    // CONTROL: restore the pre-fix whole-corpus `office` CTE in a rolled-back transaction and
    // confirm the ceiling would have rejected it. Without this the assertion above is
    // satisfied by any body that happens to be fast today.
    //
    // ⚠️ THE CONTROL MUST KEEP BOTH ARMS, and the first cut did not — it kept only `direct`,
    // whereupon the merge join saw an empty subject-scoped side and never executed the CTE at
    // all: 20 buffers, and the assertion failed as "no longer discriminating". That was the
    // control being unfaithful, not the ceiling being wrong. In the real pre-fix body
    // `top_office` fed the direct AND the bridged arm, which is why it could not be skipped.
    const regressed = await withClient(async (c) => {
      await c.query("BEGIN");
      try {
        await c.query(`
          CREATE OR REPLACE FUNCTION company_political_links(p_eik text, p_limit int DEFAULT 50)
          RETURNS jsonb LANGUAGE sql STABLE AS $ctl$
            WITH office AS (
              SELECT r.person_id, r.source, r.role,
                     role_prominence(r.source, r.role) AS prom
                FROM person_role r
                JOIN person p ON p.person_id = r.person_id
               WHERE r.confidence IN ('exact_id','high','manual')
                 AND person_role_is_office(r.source, r.role)
                 AND p.status = 'active' AND p.is_public_figure
            ),
            top_office AS (
              SELECT DISTINCT ON (person_id) person_id FROM office
               ORDER BY person_id, prom DESC, source, role
            ),
            direct_role AS (
              SELECT r.person_id FROM person_role r JOIN top_office o USING (person_id)
               WHERE r.ref = p_eik AND r.source IN ('tr','ngo')
                 AND r.confidence IN ('exact_id','high','manual')
            ),
            bf AS (
              SELECT t.name_fold FROM tr_person_roles t
                JOIN tr_name_fold_people f USING (name_fold)
               WHERE t.uic = p_eik AND f.people_n = 1 GROUP BY 1
            ),
            bs AS (
              SELECT bf.name_fold, count(DISTINCT t2.uic) n
                FROM bf JOIN tr_person_roles t2 USING (name_fold) GROUP BY 1
            ),
            via AS (
              SELECT t2.uic FROM bs JOIN tr_person_roles t2 USING (name_fold)
               WHERE t2.uic <> p_eik AND bs.n <= 25 GROUP BY 1
            ),
            br AS (
              SELECT r.person_id FROM via v
                JOIN person_role r ON r.ref = v.uic AND r.source IN ('tr','ngo')
                 AND r.confidence IN ('exact_id','high','manual')
                JOIN top_office o USING (person_id) GROUP BY 1
            )
            SELECT jsonb_build_object('directCount', (SELECT count(*) FROM direct_role),
                                      'bridgedCount', (SELECT count(*) FROM br));
          $ctl$;`);
        return await bufferCost(c, pick.uic);
      } finally {
        await c.query("ROLLBACK").catch(() => {});
      }
    });
    assert.ok(
      regressed > BUFFER_CEILING,
      `the control body (whole-corpus office CTE) read only ${regressed} buffers, under the ` +
        `${BUFFER_CEILING} ceiling — the gate has stopped discriminating and must be re-based.`,
    );
  },
  300_000,
);

test.skipIf(skip)(
  "both arrays are emitted in the ORDER 158 declares",
  async () => {
    // ⚠️ THIS REPLACED A "call it twice and compare" TEST, WHICH DID NOT WORK. Dropping the
    // ORDER BY from a jsonb_agg leaves two calls in one statement agreeing perfectly — same
    // plan, same physical row order — so that gate went green on exactly the mutation it was
    // written for. What has to be asserted is that the order is the DECLARED one.
    //
    // It matters because both arrays are CAPPED. An unordered aggregate does not merely shuffle
    // rows a reader may screenshot; at the cap it changes WHICH people are returned, so the
    // answer to „who is this company connected to" would vary between two identical questions.
    //
    // direct:  role_prominence DESC, name, slug
    // bridged: bridgeCompanies ASC, role_prominence DESC, name, slug  (tightest bridge first)
    const r = await one<{
      n: string;
      rows: string;
      bad: string;
      sample: string | null;
    }>(
      `WITH sample AS (
       SELECT DISTINCT t.uic FROM tr_person_roles t ORDER BY t.uic LIMIT 400
     ),
     p AS (SELECT uic, company_political_links(uic, 200) AS j FROM sample),
     d AS (
       SELECT p.uic, 'direct' AS arm, e.ord,
              ROW(0,
                  -role_prominence(e.v ->> 'officeSource', e.v ->> 'officeRole'),
                  e.v ->> 'name', e.v ->> 'slug') AS k
         FROM p, jsonb_array_elements(p.j -> 'direct') WITH ORDINALITY e(v, ord)
     ),
     b AS (
       SELECT p.uic, 'bridged' AS arm, e.ord,
              ROW((e.v ->> 'bridgeCompanies')::int,
                  -role_prominence(e.v ->> 'officeSource', e.v ->> 'officeRole'),
                  e.v ->> 'name', e.v ->> 'slug') AS k
         FROM p, jsonb_array_elements(p.j -> 'bridged') WITH ORDINALITY e(v, ord)
     ),
     all_rows AS (SELECT * FROM d UNION ALL SELECT * FROM b),
     stepped AS (
       SELECT uic, arm, k, lag(k) OVER (PARTITION BY uic, arm ORDER BY ord) AS prev
         FROM all_rows
     )
     SELECT (SELECT count(*) FROM p) AS n,
            (SELECT count(*) FROM all_rows) AS rows,
            (SELECT count(*) FROM stepped WHERE prev IS NOT NULL AND k < prev) AS bad,
            (SELECT string_agg(DISTINCT uic || ' (' || arm || ')', ', ')
               FROM (SELECT uic, arm FROM stepped
                      WHERE prev IS NOT NULL AND k < prev LIMIT 5) z) AS sample`,
    );
    assert.ok(Number(r.n) > 100, "sample too small");
    assert.ok(
      Number(r.rows) > 200,
      `only ${r.rows} link rows across the sample — this assertion cannot discriminate`,
    );
    assert.equal(
      Number(r.bad),
      0,
      `${r.bad} rows break the declared sort — e.g. ${r.sample}. An unordered jsonb_agg lets ` +
        `the capped arrays return a DIFFERENT SET of people between two identical calls.`,
    );

    // Kept alongside, cheap, and it catches nondeterminism the sort assertion cannot: a tie the
    // ORDER BY does not close, or a value that changes between calls.
    const same = await one<{ same: boolean }>(
      `WITH sample AS (SELECT DISTINCT t.uic FROM tr_person_roles t ORDER BY t.uic LIMIT 200)
     SELECT bool_and(company_political_links(uic, 3)::text
                     = company_political_links(uic, 3)::text) AS same FROM sample`,
    );
    assert.equal(
      same.same,
      true,
      "company_political_links differs between two identical calls",
    );
  },
  300_000,
);

// ── The UNION layer's two invariants (docs/plans/company-political-links-third-arm-v1.md) ──────
//
// `/api/db/company-political` merges this function with `company_politicians` (008) and the ИСУН
// `political-by-eik` shard. Everything above gates 158 in isolation; these two gate the JOIN,
// because both of its load-bearing properties are properties of the CORPUS rather than of the JS —
// a route unit test can only assert them against fixtures it wrote itself.

/**
 * The union's dedup key, as SQL — the same three-way resolution `db_routes.js` performs, written
 * ONCE here so the gate and the route cannot drift into two different keys.
 *
 * ⚠️ THE `mp` BRANCH'S `COALESCE` FALLBACK IS NON-NULL BY CONSTRUCTION, so "is this key NULL"
 * gates NOTHING there — `company_politicians.ref` has no NULLs, and 68 of its 522 rows are `mp`.
 * That is why the assertions below test whether the key names a SERVABLE PERSON rather than
 * whether it is non-null: 158 emits `person.slug`, so a key that is not one cannot ever match it,
 * and the same human renders once per arm.
 */
const DEDUP_KEY_SQL = `
  CASE WHEN kind = 'mp'
       THEN COALESCE(person_slug_redirect(replace(ref, '/candidate/', '')),
                     replace(ref, '/candidate/', ''))
       ELSE officials_person_slug(replace(ref, '/officials/', ''))
  END`;

test.skipIf(skip)(
  "every arm's ref resolves to a person the site would actually serve",
  async () => {
    // ⚠️ WHAT THIS DOES *NOT* GATE, because an earlier draft of this comment claimed it did and
    // the corpus refutes it: the retirement map. `officials_person_slug()` is a COALESCE whose
    // FIRST branch is a `person_role.ref` join, and measured 2026-08-19 that branch answers
    // 445/445 PG officials refs and 919/919 funds officials slugs — **0** reach the
    // `person_slug_redirect` fallthrough. Deleting that arm from 106 would leave this green. (37
    // refs do have a redirect row, which is where the wrong claim came from; they resolve through
    // `person_role` anyway.)
    //
    // What it DOES gate is cross-loader drift, which is the real hazard here:
    // `company_politicians` is rebuilt by `db:load:tr:pg` and `person_role` by
    // `db:resolve:persons`, so a roster re-slug reaching one and not the other strands refs with
    // no live role — the dedup key degrades to the raw ref, and every affected human is rendered
    // once per arm on a page whose whole subject is naming people correctly.
    const pg = await one<{
      total: string;
      discriminating: string;
      unresolved: string;
      unservable: string;
      sample: string;
    }>(
      `SELECT count(*)                                            AS total,
              -- The mp branch cannot fail the NULL check, so the floor below must be measured
              -- against the rows that can.
              count(*) FILTER (WHERE kind <> 'mp')                AS discriminating,
              count(*) FILTER (WHERE pslug IS NULL)               AS unresolved,
              count(*) FILTER (
                WHERE pslug IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM person p
                                   WHERE p.slug = q.pslug
                                     AND p.status = 'active'
                                     AND p.is_public_figure)
              )                                                   AS unservable,
              COALESCE(min(ref) FILTER (
                WHERE pslug IS NULL
                   OR NOT EXISTS (SELECT 1 FROM person p
                                   WHERE p.slug = q.pslug
                                     AND p.status = 'active'
                                     AND p.is_public_figure)), '') AS sample
         FROM (SELECT ref, kind, ${DEDUP_KEY_SQL} AS pslug FROM company_politicians) q`,
    );
    assert.ok(
      Number(pg.discriminating) > 100,
      `only ${pg.discriminating} officials-kind rows of ${pg.total} — the mp branch's COALESCE ` +
        `fallback cannot produce NULL, so it contributes nothing to the unresolved check`,
    );
    assert.equal(
      Number(pg.unresolved),
      0,
      `${pg.unresolved}/${pg.total} company_politicians refs do not resolve (e.g. ${pg.sample})`,
    );
    assert.equal(
      Number(pg.unservable),
      0,
      `${pg.unservable}/${pg.total} company_politicians refs resolve to a key that is NOT a ` +
        `servable person (e.g. ${pg.sample}). 158 emits person.slug, so such a key can never ` +
        `match it — that human renders TWICE, once per arm, and escapes the bridged subtraction.`,
    );

    // Same key, same requirement, for the funds shard's two arrays.
    const funds = await one<{
      total: string;
      discriminating: string;
      unservable: string;
      sample: string;
    }>(
      `WITH src AS (
         SELECT o.slug AS ref, 'official' AS kind, officials_person_slug(o.slug) AS pslug
           FROM fund_payloads p
           CROSS JOIN LATERAL jsonb_to_recordset(
             COALESCE(p.payload -> 'officials', '[]'::jsonb)) AS o(slug text)
          WHERE p.kind = 'political-by-eik' AND o.slug IS NOT NULL
         UNION ALL
         SELECT 'mp-' || m."mpId", 'mp',
                COALESCE(person_slug_redirect('mp-' || m."mpId"), 'mp-' || m."mpId")
           FROM fund_payloads p
           CROSS JOIN LATERAL jsonb_to_recordset(
             COALESCE(p.payload -> 'mps', '[]'::jsonb)) AS m("mpId" text)
          WHERE p.kind = 'political-by-eik' AND m."mpId" IS NOT NULL
       )
       SELECT count(*)                               AS total,
              count(*) FILTER (WHERE kind <> 'mp')   AS discriminating,
              count(*) FILTER (
                WHERE pslug IS NULL
                   OR NOT EXISTS (SELECT 1 FROM person p
                                   WHERE p.slug = src.pslug
                                     AND p.status = 'active'
                                     AND p.is_public_figure)
              )                                      AS unservable,
              COALESCE(min(ref) FILTER (
                WHERE pslug IS NULL
                   OR NOT EXISTS (SELECT 1 FROM person p
                                   WHERE p.slug = src.pslug
                                     AND p.status = 'active'
                                     AND p.is_public_figure)), '') AS sample
         FROM src`,
    );
    // A clone that never ran db:load:funds:pg has no shard rows. Gate on the DISCRIMINATING half:
    // a corpus whose `officials` arrays emptied while `mps` remained would clear a `total > 0`
    // guard and then assert nothing at all.
    if (Number(funds.discriminating) === 0) {
      console.warn(
        "[company_political_links] fund_payloads carries no political-by-eik officials rows — " +
          "the funds half of this gate is inert",
      );
      return;
    }
    assert.equal(
      Number(funds.unservable),
      0,
      `${funds.unservable}/${funds.total} funds political-by-eik refs do not name a servable ` +
        `person (e.g. ${funds.sample}) — same double-render as above.`,
    );
  },
  300_000,
);

test.skipIf(skip)(
  "no person is both a direct link and a bridged lead once the arms are unioned",
  async () => {
    // 158 already guarantees this WITHIN its own payload (see the bridge-cap test above). The
    // union can break it from OUTSIDE: a PG- or funds-arm person with no `person_role` at this
    // EIK is absent from 158's `direct_role`, so 158 may legitimately place them in `bridged`
    // while the other arm puts them in the direct block — and the reader is told about the same
    // human twice, once as an officer here and once as a distant lead. `db_routes.js` subtracts
    // the resolved direct-slug set from `bridged` for exactly this reason.
    //
    // ⚠️ SCOPED TO BOTH ARMS, AND COUNTED IN PEOPLE. An earlier draft enumerated only
    // `company_politicians` EIKs and counted JOIN ROWS: it printed 7 where there are 5 people
    // (one EIK carries three refs folding to one slug) and missed the funds arm's 4 entirely.
    // The union-wide figure is 9.
    const r = await one<{
      eiks: string;
      collisions: string;
      in_158_direct: string;
      sample: string;
    }>(
      `WITH eiks AS (
         SELECT DISTINCT eik FROM company_politicians
         UNION SELECT key FROM fund_payloads WHERE kind = 'political-by-eik'
       ),
       l AS (SELECT e.eik, company_political_links(e.eik, 200) AS j FROM eiks e),
       b AS (SELECT eik, jsonb_array_elements(j -> 'bridged') ->> 'slug' AS slug FROM l),
       d AS (SELECT eik, jsonb_array_elements(j -> 'direct')  ->> 'slug' AS slug FROM l),
       arm AS (
         SELECT eik, ${DEDUP_KEY_SQL} AS pslug FROM company_politicians
         UNION
         SELECT p.key, officials_person_slug(o.slug)
           FROM fund_payloads p
           CROSS JOIN LATERAL jsonb_to_recordset(
             COALESCE(p.payload -> 'officials', '[]'::jsonb)) AS o(slug text)
          WHERE p.kind = 'political-by-eik' AND o.slug IS NOT NULL
         UNION
         SELECT p.key, COALESCE(person_slug_redirect('mp-' || m."mpId"), 'mp-' || m."mpId")
           FROM fund_payloads p
           CROSS JOIN LATERAL jsonb_to_recordset(
             COALESCE(p.payload -> 'mps', '[]'::jsonb)) AS m("mpId" text)
          WHERE p.kind = 'political-by-eik' AND m."mpId" IS NOT NULL
       ),
       hit AS (
         SELECT a.eik, a.pslug FROM arm a JOIN b ON b.eik = a.eik AND b.slug = a.pslug
       )
       SELECT (SELECT count(*) FROM eiks)                       AS eiks,
              count(*)                                          AS collisions,
              count(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM d WHERE d.eik = hit.eik AND d.slug = hit.pslug)) AS in_158_direct,
              COALESCE(min(hit.eik || ' / ' || hit.pslug), '')   AS sample
         FROM hit`,
    );
    assert.ok(
      Number(r.eiks) > 50,
      `only ${r.eiks} EIKs carry a link row — sample too small to discriminate`,
    );

    // ⚠️ THE ASSERTION WITH TEETH, and it is not the collision count. A colliding person must be
    // in 158's `bridged` and NOT in its `direct` — that is 158's own guarantee, and if it ever
    // failed the route's subtraction would be silently masking a defect one layer down rather
    // than de-duplicating two honest answers. Non-vacuous: the collisions below exercise it, and
    // none of their EIKs appears in the 400-uic sample the bridge-cap test above draws.
    assert.equal(
      Number(r.in_158_direct),
      0,
      `${r.in_158_direct} colliding person(s) are in 158's OWN direct array as well as its ` +
        `bridged one (e.g. ${r.sample}) — 158 excludes its direct_role set from bridged, so ` +
        `this cannot happen unless that exclusion has broken.`,
    );

    // The magnitude is REPORTED, never asserted to be zero: the collisions are real corpus facts
    // that the route filters, so pinning a number here would go red on the next TR reload.
    if (Number(r.collisions) === 0)
      console.warn(
        "[company_political_links] no direct/bridged collisions in the corpus — the route's " +
          "subtraction is currently exercised only by db_routes.company_political.test.js",
      );
    else
      console.info(
        `[company_political_links] ${r.collisions} person(s) appear in both arms before the ` +
          `route subtracts them (e.g. ${r.sample}) — each would be described to the reader twice.`,
      );
  },
  300_000,
);
