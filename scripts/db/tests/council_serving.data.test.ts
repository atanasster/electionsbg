// Gate for the council serving layer (migration 161) behind /api/db/council-*.
//
// These are "applied, never loaded" functions: no loader ships them except
// db:load:council:pg, and `deploy:db` deploys functions/ code, which is a
// different thing from a Postgres function. So the failure mode is a serving
// database running a body nobody has replaced, with nothing reporting it.
//
// What is asserted, and why each is not obvious:
//   1. The payloads reconcile with the corpus. A hub that states coverage has
//      to state the MEASURED coverage — a hard-coded fraction goes stale in
//      both directions (the /funds/calls "2 от 6" lesson).
//   2. The frontend-code bridge resolves. Sofia is 27 codes -> one council, and
//      a My-Area user in a район holds an S2*** code, not `SOF`.
//   3. NULL means "not covered", and is distinct from "covered, no named
//      votes". Collapsing the two tells a reader in Пловдив that nothing is
//      known about their council when 151 resolutions are indexed.
//   4. Every payload that reports participation carries its BASIS. Bulgarian
//      protokols list only the councillors who voted, so attendance is a
//      participation share and never "missed N sessions".
//   5. Buffer ceilings. Prod is a db-g1-small under a 10 s statement_timeout;
//      a local timing proves nothing about it, but a buffer count does.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import { allRows, dbReachable, end, withClient } from "../lib/pg";
import { sumExecutionBuffers } from "../lib/explain_buffers";

const haveDb = await dbReachable();
const skip = !haveDb ? "Postgres unreachable" : false;

afterAll(async () => {
  await end();
});

const one = async <T>(sql: string, params: unknown[] = []): Promise<T> =>
  (await allRows<{ r: T }>(sql, params))[0]?.r;

const present = async (): Promise<boolean> =>
  (await allRows(`SELECT 1 FROM council_muni LIMIT 1`).catch(() => null)) !==
  null;

type Overview = {
  councilsCovered: number;
  councilsTotal: number;
  councilsWithNamedVotes: number;
  resolutions: number;
  namedVotes: number;
  attributedVotes: number;
  councils: {
    code: string;
    name: string;
    hasNamedVotes: boolean;
    resolutions: number;
    newestNamedOn: string | null;
  }[];
};

test.skipIf(skip)("council_overview reconciles with the corpus", async () => {
  assert.ok(await present(), "council_* absent — run db:load:council:pg");
  const o = await one<Overview>("SELECT council_overview() AS r");
  assert.ok(o, "council_overview() returned nothing — is 161 applied?");

  const [c] = await allRows<{
    munis: string;
    named: string;
    res: string;
    votes: string;
    attributed: string;
  }>(
    `SELECT (SELECT count(*) FROM council_muni)::text AS munis,
            (SELECT count(*) FROM council_muni WHERE has_named_votes)::text AS named,
            (SELECT count(*) FROM council_resolution)::text AS res,
            (SELECT count(*) FROM council_vote)::text AS votes,
            (SELECT count(*) FROM council_vote WHERE person_id IS NOT NULL)::text AS attributed`,
  );
  assert.equal(o.councilsCovered, Number(c.munis));
  assert.equal(o.councilsWithNamedVotes, Number(c.named));
  assert.equal(o.resolutions, Number(c.res));
  assert.equal(o.namedVotes, Number(c.votes));
  assert.equal(o.attributedVotes, Number(c.attributed));
  assert.equal(
    o.councils.length,
    Number(c.munis),
    "the per-council list is not the same set as the count above it",
  );

  // The denominator the hub's coverage line divides by. 265 общински съвета is
  // the country, and it is stated here rather than in the component so the two
  // cannot disagree — but it must never silently become the covered count.
  assert.equal(o.councilsTotal, 265);
  assert.ok(
    o.councilsCovered < o.councilsTotal,
    "councilsCovered has reached councilsTotal — if coverage really is complete " +
      "the hub's framing needs rewriting, not just this assertion",
  );
});

test.skipIf(skip)(
  "the frontend-code bridge resolves every council",
  async () => {
    assert.ok(await present(), "council_* absent — run db:load:council:pg");
    const codes = await allRows<{
      frontend_code: string;
      obshtina_code: string;
    }>(`SELECT frontend_code, obshtina_code FROM council_muni_code`);
    assert.ok(codes.length > 0, "council_muni_code is empty");

    // Every frontend code must answer, and answer for the RIGHT council.
    for (const c of codes) {
      const d = await one<{ code: string } | null>(
        "SELECT council_muni_detail($1, 1) AS r",
        [c.frontend_code],
      );
      assert.ok(d, `council_muni_detail('${c.frontend_code}') returned null`);
      assert.equal(
        d.code,
        c.obshtina_code,
        `${c.frontend_code} resolved to ${d.code}, expected ${c.obshtina_code}`,
      );
    }

    // THE CASE BOTH ASSERTIONS ABOVE WERE BLIND TO. Three council keys are also
    // OTHER municipalities' frontend codes — BGS01 is Бургас's council key AND
    // Айтос's obshtina code, PDV01 likewise Асеновград, VAR01 Аврен. All three
    // places are UNCOVERED, so each must resolve to null. An earlier body added a
    // fallback arm matching p_code against council_muni.obshtina_code, which
    // served Бургас's 374 resolutions to a reader in Айтос.
    //
    // The bridge loop above cannot see this: it only iterates codes that are IN
    // the bridge, and these three are not.
    for (const collision of ["BGS01", "PDV01", "VAR01"]) {
      const wrong = await one<{ code: string } | null>(
        "SELECT council_muni_detail($1, 1) AS r",
        [collision],
      );
      assert.equal(
        wrong,
        null,
        `council_muni_detail('${collision}') resolved to ${JSON.stringify(wrong)} — ` +
          `that code is an UNCOVERED municipality's obshtina code that happens to ` +
          `equal another council's internal key. Resolution must go through ` +
          `council_muni_code only`,
      );
    }

    // A Sofia район is the case a scalar column could not express.
    const rayon = codes.find((c) => c.frontend_code.startsWith("S2"));
    assert.ok(rayon, "no Sofia район code in the bridge");
    const d = await one<{ code: string }>(
      "SELECT council_muni_detail($1, 1) AS r",
      [rayon.frontend_code],
    );
    assert.equal(d.code, "SOF");
  },
);

test.skipIf(skip)(
  "an uncovered place is NULL, not an empty council",
  async () => {
    assert.ok(await present(), "council_* absent — run db:load:council:pg");
    // 249 of 265 municipalities have no council coverage. The tile must be able
    // to say "not covered" — distinct from "covered but publishes no named
    // votes", which is a different sentence about a different situation.
    const d = await one<unknown>("SELECT council_muni_detail($1, 5) AS r", [
      "ZZZ99",
    ]);
    assert.equal(
      d,
      null,
      "an unknown place must resolve to null, not to a shell",
    );

    // …and a covered council with no named votes is NOT null.
    const [quiet] = await allRows<{ code: string }>(
      `SELECT obshtina_code AS code FROM council_muni WHERE NOT has_named_votes LIMIT 1`,
    );
    if (quiet) {
      const q = await one<{ hasNamedVotes: boolean; resolutionCount: number }>(
        "SELECT council_muni_detail($1, 5) AS r",
        [quiet.code],
      );
      assert.ok(q, `${quiet.code} is covered but resolved to null`);
      assert.equal(q.hasNamedVotes, false);
      assert.ok(
        q.resolutionCount > 0,
        `${quiet.code} is covered with no resolutions — the two states have collapsed`,
      );
    }
  },
);

test.skipIf(skip)("every participation figure ships its basis", async () => {
  assert.ok(await present(), "council_* absent — run db:load:council:pg");
  // A FRONTEND code — resolution goes through council_muni_code only, so the
  // council's own key is deliberately not accepted here.
  const [m] = await allRows<{ code: string }>(
    `SELECT c.frontend_code AS code
       FROM council_muni m
       JOIN council_muni_code c ON c.obshtina_code = m.obshtina_code
      WHERE m.has_named_votes ORDER BY 1 LIMIT 1`,
  );
  assert.ok(m, "no vote-bearing council reachable through the bridge");
  const d = await one<{
    attendanceBasis?: string;
    namedVoteResolutions: number;
  }>("SELECT council_muni_detail($1, 5) AS r", [m.code]);
  // Without this a consumer renders "участие 62%" as "missed 38% of sessions",
  // which the corpus cannot support: protokols list only who voted.
  assert.ok(
    d.attendanceBasis && d.attendanceBasis.includes("отсъствал"),
    "council_muni_detail dropped attendanceBasis — attendance would read as absence",
  );
  assert.ok(d.namedVoteResolutions > 0, "no denominator for participation");

  const [p] = await allRows<{ pid: string }>(
    `SELECT person_id::text AS pid FROM council_vote WHERE person_id IS NOT NULL LIMIT 1`,
  );
  assert.ok(p, "no attributed vote to test with");
  const c = await one<{
    attendanceBasis?: string;
    dissentBasis?: string;
    againstMajority: number;
    ofNamedVoteResolutions: number;
  }>("SELECT council_councillor($1) AS r", [Number(p.pid)]);
  assert.ok(c, "council_councillor returned nothing for an attributed person");
  assert.ok(c.attendanceBasis, "council_councillor dropped attendanceBasis");
  // The corpus carries no party at all, so this is measured against the
  // COUNCIL's majority. Named `againstMajority`, and its basis stated, so it
  // cannot be read as the parliamentary party-dissent metric.
  assert.ok(
    c.dissentBasis && c.dissentBasis.includes("партия"),
    "council_councillor dropped dissentBasis — againstMajority would read as party dissent",
  );
  assert.ok(c.againstMajority <= c.ofNamedVoteResolutions);
});

test.skipIf(skip)(
  "againstMajority refuses a tie and excludes abstentions",
  async () => {
    assert.ok(await present(), "council_* absent — run db:load:council:pg");
    const [p] = await allRows<{ pid: string }>(
      `SELECT person_id::text AS pid FROM council_vote WHERE person_id IS NOT NULL
      GROUP BY person_id ORDER BY count(*) DESC, person_id LIMIT 1`,
    );
    assert.ok(p, "no attributed vote to test with");
    const c = await one<{
      votes: number;
      against: number;
      for: number;
      abstain: number;
      againstMajority: number;
      abstainedFromMajority: number;
      ofScoredVotes: number;
      noMajorityResolutions: number;
    }>("SELECT council_councillor($1) AS r", [Number(p.pid)]);
    assert.ok(
      c,
      "council_councillor returned nothing for the busiest councillor",
    );

    // A tied resolution has NO majority, so it scores nothing either way. An
    // alphabetical tiebreak previously made `abstain` the winner on 59 of 61
    // ties and flagged 686 councillor-votes as dissent where no majority existed.
    assert.equal(
      c.ofScoredVotes + c.noMajorityResolutions,
      c.votes,
      "scored + no-majority must account for every vote — a tie is being scored",
    );
    // Abstention is the refusal to take a side, not opposition — it was 48.6% of
    // this figure before the split. Note the bound is against + FOR, not against
    // alone: voting `for` when the majority voted `against` is genuinely against
    // the majority. What must never be counted is an abstention.
    assert.ok(
      c.againstMajority <= c.against + c.for,
      `againstMajority (${c.againstMajority}) exceeds this councillor's explicit ` +
        `votes (${c.against} against + ${c.for} for) — abstentions are being counted`,
    );
    assert.ok(c.abstainedFromMajority <= c.abstain);
    assert.ok(c.againstMajority <= c.ofScoredVotes);

    // The property stated directly, corpus-wide: recompute the flag from the raw
    // votes and require it to match, so neither an abstention nor a tie can enter.
    const [check] = await allRows<{ mismatched: string }>(
      `WITH tallies AS (
       SELECT resolution_id, vote, count(*) AS n FROM council_vote GROUP BY 1, 2
     ),
     ranked AS (
       SELECT resolution_id, vote, n,
              row_number() OVER (PARTITION BY resolution_id ORDER BY n DESC) AS rn,
              count(*) OVER (PARTITION BY resolution_id, n) AS at_this_n,
              max(n)   OVER (PARTITION BY resolution_id)    AS top_n
         FROM tallies
     ),
     majority AS (
       SELECT resolution_id, vote AS mv FROM ranked
        WHERE rn = 1 AND n = top_n AND at_this_n = 1
     ),
     expected AS (
       SELECT v.person_id,
              count(*) FILTER (
                WHERE j.mv IS NOT NULL AND v.vote <> j.mv AND v.vote <> 'abstain'
              ) AS n
         FROM council_vote v
         LEFT JOIN majority j ON j.resolution_id = v.resolution_id
        WHERE v.person_id IS NOT NULL
        GROUP BY 1
     )
     SELECT count(*)::text AS mismatched FROM expected e
      WHERE (council_councillor(e.person_id)->>'againstMajority')::int <> e.n`,
    );
    assert.equal(
      check.mismatched,
      "0",
      `${check.mismatched} councillors' againstMajority disagrees with the flag ` +
        `recomputed from the raw votes — a tie or an abstention is being scored`,
    );
  },
);

test.skipIf(skip)(
  "a resolution payload carries its votes and its source",
  async () => {
    assert.ok(await present(), "council_* absent — run db:load:council:pg");
    const [r] = await allRows<{ id: string }>(
      `SELECT id FROM council_resolution WHERE has_named_votes LIMIT 1`,
    );
    const d = await one<{
      votes: { name: string; vote: string }[];
      sourceUrl: string | null;
      councilName: string;
    }>("SELECT council_resolution_detail($1) AS r", [r.id]);
    assert.ok(d, "council_resolution_detail returned nothing");
    assert.ok(d.votes.length > 0, "a named-vote resolution returned no votes");
    assert.ok(
      d.councilName,
      "no council name — the page cannot say whose decision this is",
    );
    // Every claim on the page must be traceable to the protokol it came from.
    assert.ok(
      d.sourceUrl,
      "no sourceUrl — the reader cannot check the original",
    );

    assert.equal(
      await one<unknown>("SELECT council_resolution_detail($1) AS r", ["nope"]),
      null,
    );
  },
);

test.skipIf(skip)(
  "the serving functions stay cheap enough for a db-g1-small",
  async () => {
    assert.ok(await present(), "council_* absent — run db:load:council:pg");
    // Buffers, not wall-clock: the same call times very differently cold and
    // warm while its buffer count barely moves. Measured 2026-08-16 —
    // overview 577, worst município 864, councillor 1,220. The ceilings sit
    // ~2x above that and well under the ~2,000 a per-view call is budgeted.
    const cost = async (
      c: PoolClient,
      sql: string,
      params: unknown[],
    ): Promise<number> => {
      await c.query(sql, params); // warm this backend's catalog first
      const { rows } = await c.query(
        `EXPLAIN (ANALYZE, BUFFERS) ${sql}`,
        params,
      );
      return sumExecutionBuffers(rows as { "QUERY PLAN": string }[]);
    };

    await withClient(async (c) => {
      // SWEEP every council, do not guess the worst one. Two defects lived in
      // the single-row pick this replaces, and both kept it green:
      //
      //  - it ordered by `named_vote_count`, which is not the cost driver
      //    (cost tracks resolutions x councillor fan-out). It selected PER32 at
      //    1,784 buffers while BGS04 (2,073) and SFO_CITY (2,007) — the two
      //    largest municipalities, one of them Sofia — were over the ceiling.
      //  - it passed `obshtina_code`, but council_muni_detail resolves a
      //    FRONTEND code. Eight of the sixteen council keys are not frontend
      //    codes, so for those it measured the cost of returning NULL.
      //
      // Same lesson the council_councillor block below already records: an
      // unordered LIMIT 1 is green, nondeterministic, and blind to the case
      // that matters.
      const { rows: codes } = await c.query<{ code: string }>(
        `SELECT DISTINCT ON (obshtina_code) frontend_code AS code
           FROM council_muni_code
          ORDER BY obshtina_code, (frontend_code LIKE 'S2%'), frontend_code`,
      );
      let worstMuni = 0;
      let worstMuniCode = "";
      for (const { code } of codes) {
        // 30, the limit useCouncilMuni actually sends — not 20.
        const n = await cost(c, "SELECT council_muni_detail($1, 30)", [code]);
        if (n > worstMuni) {
          worstMuni = n;
          worstMuniCode = code;
        }
      }
      assert.ok(
        worstMuni <= 2_000,
        `council_muni_detail cost ${worstMuni} buffers for ${worstMuniCode}, ` +
          `against a ceiling of 2,000. The per-councillor slug lookups are the ` +
          `usual cause: as correlated subqueries they fire once per councillor ` +
          `group and cost BGS04 2,073 / SFO_CITY 2,007; as LEFT JOIN + LEFT ` +
          `JOIN LATERAL, 1,364 / 1,298`,
      );

      const checks: [string, number, string, unknown[]][] = [
        ["council_overview", 1_500, "SELECT council_overview()", []],
      ];
      for (const [label, ceiling, sql, params] of checks) {
        const n = await cost(c, sql, params);
        assert.ok(
          n <= ceiling,
          `${label} touched ${n} buffers against a ceiling of ${ceiling} — ` +
            `prod is a db-g1-small reading cold over the proxy under a 10 s ` +
            `statement_timeout`,
        );
      }

      // council_councillor over the FIVE busiest, not one. An unordered
      // `LIMIT 1` picked a councillor costing 1,220 while the worst cost 3,591
      // against this ceiling — green, nondeterministic, and blind to the case
      // that mattered. Even ordering by vote count is not enough on its own:
      // the top two are TIED on votes and cost 1,397 and 1,559, so the tiebreak
      // alone decided whether the gate saw the expensive one. Cost tracks the
      // distinct resolutions a councillor's votes touch, not the count.
      const { rows: busiest } = await c.query<{ pid: string }>(
        `SELECT person_id::text AS pid FROM council_vote
          WHERE person_id IS NOT NULL
          GROUP BY person_id ORDER BY count(*) DESC, person_id LIMIT 5`,
      );
      const COUNCILLOR_CEILING = 2_500;
      let worstCost = 0;
      let worstPid = "";
      for (const b of busiest) {
        const n = await cost(c, "SELECT council_councillor($1)", [b.pid]);
        if (n > worstCost) {
          worstCost = n;
          worstPid = b.pid;
        }
      }
      assert.ok(
        worstCost <= COUNCILLOR_CEILING,
        `council_councillor cost ${worstCost} buffers for person ${worstPid}, ` +
          `against a ceiling of ${COUNCILLOR_CEILING}. Before the per-resolution ` +
          `majority moved ` +
          `into a CTE this was 3,591 — as a correlated subquery it ran once per ` +
          `vote and was 93% of the total`,
      );
    });
  },
);

test.skipIf(skip)(
  "every resolution carries a LINKABLE council code",
  async () => {
    assert.ok(await present(), "council_* absent — run db:load:council:pg");
    // /council/:code resolves through council_muni_code ONLY. Eight of the
    // sixteen council keys are not frontend codes, and three (BGS01, PDV01,
    // VAR01) are OTHER municipalities' codes — so linking obshtina_code put a
    // "we do not track this council" page one click from that council's own
    // decision, for 1,768 of 4,727 resolutions. Eight councils DO work (key ==
    // frontend code), which is why a spot check misses it and this asserts
    // over every council.
    const orphan = await allRows<{ n: string; sample: string | null }>(
      `SELECT count(*)::text AS n, min(r.obshtina_code) AS sample
         FROM council_resolution r
        WHERE NOT EXISTS (
                SELECT 1 FROM council_muni_code mc
                 WHERE mc.obshtina_code = r.obshtina_code)`,
    );
    assert.equal(
      Number(orphan[0].n),
      0,
      `${orphan[0].n} resolution(s) have no frontend code (e.g. ${orphan[0].sample})`,
    );

    const perCouncil = await allRows<{ id: string; fc: string | null }>(
      `SELECT r.id,
              (council_resolution_detail(r.id) ->> 'councilFrontendCode') AS fc
         FROM (SELECT DISTINCT ON (obshtina_code) id, obshtina_code
                 FROM council_resolution ORDER BY obshtina_code, id) r`,
    );
    assert.ok(perCouncil.length >= 10, "too few councils to be a real check");
    for (const row of perCouncil) {
      assert.ok(row.fc, `${row.id}: councilFrontendCode is null`);
      const served = await one<unknown>(
        "SELECT council_muni_detail($1, 1) AS r",
        [row.fc],
      );
      assert.ok(
        served,
        `${row.id}: /council/${row.fc} resolves to NOTHING — dead breadcrumb`,
      );
    }
  },
);

test.skipIf(skip)(
  "personSlug is present only for a servable /person page",
  async () => {
    assert.ok(await present(), "council_* absent — run db:load:council:pg");
    // A councillor can carry a resolved person_id and still have no page —
    // /person exists for active public figures only. Linking on the id would
    // mint a 404 per councillor, so the payload gates the slug and every
    // consumer links on the slug alone.
    const [r] = await allRows<{ leaked: string; missing: string }>(
      `WITH v AS (
         SELECT jsonb_array_elements(
                  council_resolution_detail(r.id) -> 'votes') AS j
           FROM (SELECT id FROM council_resolution
                  WHERE has_named_votes ORDER BY id LIMIT 40) r
       )
       SELECT
         count(*) FILTER (
           WHERE j ->> 'personSlug' IS NOT NULL
             AND NOT EXISTS (
                   SELECT 1 FROM person p
                    WHERE p.slug = j ->> 'personSlug'
                      AND p.status = 'active' AND p.is_public_figure))::text AS leaked,
         count(*) FILTER (
           WHERE j ->> 'personSlug' IS NULL
             AND EXISTS (
                   SELECT 1 FROM person p
                    WHERE p.person_id = (j ->> 'personId')::bigint
                      AND p.status = 'active' AND p.is_public_figure))::text AS missing
         FROM v`,
    );
    assert.equal(
      Number(r.leaked),
      0,
      `${r.leaked} vote(s) expose a slug whose /person page is not servable`,
    );
    assert.equal(
      Number(r.missing),
      0,
      `${r.missing} vote(s) withhold a slug for a person who HAS a page`,
    );
  },
);
