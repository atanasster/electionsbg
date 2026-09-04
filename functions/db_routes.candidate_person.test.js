// Route-level tests for `/api/db/candidate-person` — how a /candidate/:id URL becomes a
// person, and what happens when it cannot (person-candidate-display-unification-v1 Tier 1).
//
// WHAT IT PINS. Six things, each invisible in a diff and each with a live consequence:
//
//   1. THE ELECTION IS FORWARDED, AND ONLY WHEN IT IS DATE-SHAPED. The election is the
//      disambiguator that costs the caller nothing (`?elections=` is always known) and takes
//      the unresolved shared-name population from 1,478 folds to 230 (fold, election) pairs.
//      A handler that dropped it would resolve nothing more than before while every gate
//      above it still passed.
//   2. A REFUSAL RETURNS THE PEOPLE, NOT AN EMPTY ANSWER. `personSlug: null` with a
//      `namesakes` set is what lets the page say „these are two different people". Without
//      it the page falls through to the legacy body, which reads the NAME-folder shards and
//      publishes both people's preference history as one person's, at a 200.
//   3. THE 42883 FALLBACK IS TO THE 2-ARG LOOKUP, NOT TO NULL. On a database whose 085
//      predates the 3-arg signature, degrading to null would stop resolving even the 25,625
//      folds that name exactly one person — a hosting-before-migration deploy would become a
//      REGRESSION on every bare-name candidate page rather than a no-op.
//   4. A SLUG NEVER ASKS FOR NAMESAKES. `c-{party}-…` / `mp-{id}` are party-unique by
//      construction, so a second query there would be pure latency on the resolvable path.
//   5. A NAMESAKE SET RIDES ALONG WITH A HIT. 385 folds resolve because exactly one of
//      several same-named people stood in the requested cycle; without the set beside the
//      hit the page asserts a single identity under a shared name with no route to the
//      others, chosen by a default rather than by the reader.
//   6. ONLY 42883 IS SWALLOWED. Any other error must reach the caller as a 400 — degrading a
//      dead pool or a statement_timeout to `personSlug: null` publishes the conflation.
//
// Run: cd functions && npm test

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { DB_ROUTES, __resetMissLog } = require("./db_routes.js");
const route = DB_ROUTES["candidate-person"];

const NAME = "Боян Иванов Бойчев";
const SLUG = "boyan-boychev-1a9q2r";

const NAMESAKES = [
  {
    personSlug: SLUG,
    displayName: NAME,
    latestElection: "2024_10_27",
    candidacies: [
      {
        election: "2024_10_27",
        partyNum: 28,
        partyNick: "БСП",
        partyColor: "rgb(237, 28, 36)",
        candidateSlug: "c-28-boyan-ivanov-boychev",
        totalVotes: 18,
        oblast: "S24",
      },
    ],
  },
  {
    personSlug: `${SLUG}-2`,
    displayName: NAME,
    latestElection: "2023_04_02",
    candidacies: [
      {
        election: "2023_04_02",
        partyNum: 1,
        partyNick: "БСП",
        partyColor: "rgb(237, 28, 36)",
        candidateSlug: "c-1-boyan-ivanov-boychev",
        totalVotes: 21,
        oblast: "S23",
      },
    ],
  },
];

/** A dbRows that records every call and answers per SQL fragment. */
function db(answers, seen) {
  return (sql, params) => {
    seen.push({ sql, params });
    for (const [fragment, answer] of answers) {
      if (sql.includes(fragment)) {
        return typeof answer === "function"
          ? answer()
          : Promise.resolve([{ r: answer }]);
      }
    }
    throw new Error(`unexpected SQL: ${sql}`);
  };
}

const undefinedFunction = () => {
  const e = new Error("function candidate_person_by_name(...) does not exist");
  e.code = "42883";
  return Promise.reject(e);
};

const RESOLVER = "candidate_person_by_name($1, $2, $3)";
const LEGACY_RESOLVER = "candidate_person_by_name($1, $2)";
const NAMESAKE_SET = "candidate_person_namesakes($1)";

test("a bare name forwards the election to the 3-arg lookup", async () => {
  const seen = [];
  const { body } = await route(
    db(
      [
        [RESOLVER, SLUG],
        [NAMESAKE_SET, [NAMESAKES[0]]],
      ],
      seen,
    ),
    { name: NAME, elections: "ignored", election: "2024_10_27" },
  );
  assert.equal(body.personSlug, SLUG);
  assert.deepEqual(
    seen.find((c) => c.sql.includes(RESOLVER)).params,
    [NAME, null, "2024_10_27"],
  );
});

test("a non-date election is dropped rather than passed through", async () => {
  // The value reaches us from a URL. It is a data-tree folder name, never free text — and
  // an unvalidated one would be compared against `election_date` as-is.
  const seen = [];
  await route(
    db(
      [
        [RESOLVER, SLUG],
        [NAMESAKE_SET, []],
      ],
      seen,
    ),
    { name: NAME, election: "2024-10-27" },
  );
  assert.deepEqual(seen.find((c) => c.sql.includes(RESOLVER)).params, [
    NAME,
    null,
    null,
  ]);
});

test("a party hint is VALIDATED, never clamped into a real ballot", async () => {
  // `clampInt(v, null, 1, 99)` turns "", "0" and "-5" into ballot №1 — a real party — and any
  // non-null party also excludes every `party_num IS NULL` row, i.e. every `mp-{id}`
  // candidacy. So a junk value would not narrow: it would answer about the wrong ballot and
  // hide every MP at the same time.
  const cases = [
    ["28", 28],
    ["1", 1],
    ["", null],
    ["0", null],
    ["-5", null],
    ["  ", null],
    ["abc", null],
    ["150", null],
  ];
  for (const [raw, expected] of cases) {
    const seen = [];
    await route(
      db(
        [
          [RESOLVER, SLUG],
          [NAMESAKE_SET, []],
        ],
        seen,
      ),
      { name: NAME, party: raw, election: "2024_10_27" },
    );
    assert.equal(
      seen.find((c) => c.sql.includes(RESOLVER)).params[1],
      expected,
      `?party=${JSON.stringify(raw)}`,
    );
  }
});

test("the namesake set rides along with a HIT — that is the shared-name disclosure", async () => {
  // A >1 fold cannot resolve without the election, so `personSlug` + ≥2 namesakes IS "the
  // election chose one of several". The page needs the set to say so and to link to the rest.
  const { body } = await route(
    db(
      [
        [RESOLVER, SLUG],
        [NAMESAKE_SET, NAMESAKES],
      ],
      [],
    ),
    { name: NAME, election: "2024_10_27" },
  );
  assert.equal(body.personSlug, SLUG);
  assert.equal(body.namesakes.length, 2);
});

test("an unresolved name comes back as the namesake SET, not as an empty answer", async () => {
  const seen = [];
  const { body } = await route(
    db(
      [
        [RESOLVER, null],
        [NAMESAKE_SET, NAMESAKES],
      ],
      seen,
    ),
    { name: NAME, election: "2026_04_19" },
  );
  assert.equal(body.personSlug, null);
  assert.equal(body.namesakes.length, 2);
  // The fields the chooser discriminates on — a set that lost the party or the МИР would
  // render two identical rows and force a coin flip.
  assert.deepEqual(
    body.namesakes.map((n) => [n.personSlug, n.candidacies[0].oblast]),
    [
      [SLUG, "S24"],
      [`${SLUG}-2`, "S23"],
    ],
  );
  assert.equal(seen.length, 2);
});

test("42883 on the 3-arg form falls back to the 2-arg lookup, not to null", async () => {
  __resetMissLog();
  const seen = [];
  const { body } = await route(
    db(
      [
        [RESOLVER, undefinedFunction],
        [LEGACY_RESOLVER, SLUG],
        [NAMESAKE_SET, []],
      ],
      seen,
    ),
    { name: NAME, election: "2024_10_27" },
  );
  // The ~25.6k unique-fold population keeps resolving — the whole point of keeping the
  // 2-arg form rather than degrading to null on an unmigrated database.
  assert.equal(body.personSlug, SLUG);
  assert.deepEqual(
    seen.find((c) => c.sql.includes(LEGACY_RESOLVER)).params,
    [NAME, null],
  );
});

test("any error that is NOT 42883 propagates", async () => {
  // A dead pool (08006), a statement_timeout (57014) or a permission error (42501) is a
  // failed lookup, not an answer. Degrading it to `personSlug: null` sends a shared name to
  // the legacy name-keyed body, which is exactly the conflation this route exists to avoid.
  for (const code of ["08006", "57014", "42501", undefined]) {
    const boom = () => {
      const e = new Error(`boom ${code}`);
      if (code) e.code = code;
      return Promise.reject(e);
    };
    await assert.rejects(
      route(
        db(
          [
            [RESOLVER, boom],
            [NAMESAKE_SET, []],
          ],
          [],
        ),
        { name: NAME, election: "2024_10_27" },
      ),
      /boom/,
      `code ${code} was swallowed`,
    );
  }
});

test("a missing 085 altogether degrades to the legacy fall-through", async () => {
  __resetMissLog();
  const seen = [];
  const { body } = await route(
    db(
      [
        [RESOLVER, undefinedFunction],
        [LEGACY_RESOLVER, undefinedFunction],
        [NAMESAKE_SET, undefinedFunction],
      ],
      seen,
    ),
    { name: NAME },
  );
  // Null + no namesakes is exactly the pre-Tier-1 behaviour: the page renders the legacy
  // candidate body rather than 500-ing.
  assert.deepEqual(body, { personSlug: null, namesakes: [] });
});

test("a candidate SLUG resolves without asking for namesakes", async () => {
  const seen = [];
  const { body } = await route(
    db([["candidate_person_slug($1)", SLUG]], seen),
    { slug: "c-28-boyan-ivanov-boychev", election: "2024_10_27" },
  );
  assert.deepEqual(body, { personSlug: SLUG, namesakes: [] });
  assert.equal(seen.length, 1);
});

test("an unknown slug returns null and still declares an empty namesake set", async () => {
  // The key must be PRESENT: the client reads `namesakes.length`, and an absent array on
  // one arm of the route makes that a TypeError on exactly the miss path.
  const { body } = await route(db([["candidate_person_slug($1)", null]], []), {
    slug: "mp-99999",
  });
  assert.deepEqual(body, { personSlug: null, namesakes: [] });
});

test("no name and no slug is answered, not thrown", async () => {
  const { body } = await route(() => {
    throw new Error("must not query");
  }, {});
  assert.deepEqual(body, { personSlug: null, namesakes: [] });
});
