// Gates for the roll-call routes, and one lint for a trap this file has now hit twice.
//
//   npm run functions:test
//
// THE BACKTICK TRAP. Every SQL query here lives in a JS template literal, and a backtick
// inside a SQL comment TERMINATES THAT LITERAL. It does not produce a bad query — it
// produces a SyntaxError at module load, so the whole `db` function fails to start and every
// /api/db route 500s. It is caught today only because the rest of the suite cannot import a
// broken module, which reports as seven unrelated failures pointing at the wrong place.
// Twice now the offending text was an ordinary code reference in prose (`ns`, then
// `vote_day_summary`), which is exactly the shape a careful comment takes.

const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const SRC = readFileSync(path.join(__dirname, "db_routes.js"), "utf8");

test("no backtick appears inside a SQL comment", () => {
  const offenders = [];
  SRC.split("\n").forEach((line, i) => {
    const comment = line.indexOf("--");
    // Only lines that are SQL comments (the marker at the start of the trimmed line) —
    // a JS `a -- b` is not one, and neither is a `--` inside a string.
    if (comment === -1 || line.trim().indexOf("--") !== 0) return;
    if (line.slice(comment).includes("`")) {
      offenders.push(`${i + 1}: ${line.trim()}`);
    }
  });
  assert.deepEqual(
    offenders,
    [],
    "a backtick in a SQL comment terminates the enclosing template literal — " +
      "the module then fails to LOAD, so every /api/db route 500s:\n" +
      offenders.join("\n"),
  );
});

test("the module loads and exposes the roll-call routes", () => {
  const { DB_ROUTES: routes } = require("./db_routes.js");
  assert.ok(routes, "db_routes exports no route table");
  for (const name of [
    "session",
    "session-item",
    "mp-attendance",
    "party-cohesion",
    "mp-dissents",
    "mp-similarity",
    "vote-day-summary",
    "contested-votes",
  ]) {
    assert.equal(typeof routes[name], "function", `missing route: ${name}`);
  }
});

test("both P5 routes answer safely without a database", async () => {
  const { DB_ROUTES: routes } = require("./db_routes.js");
  // An absent or unparseable ns must short-circuit BEFORE the query — clampInt's default of
  // 0 is falsy, which is what keeps a junk query string from reaching Postgres at all.
  //
  // An out-of-RANGE numeric ns is a different case and is deliberately not tested here: the
  // clamp maps ?ns=999 to 60, the same way every other route in this file treats it, and NS
  // 60 simply has no rows. Worth knowing rather than assuming it is rejected.
  const boom = () => {
    throw new Error("the route queried the database on an invalid ns");
  };
  assert.deepEqual((await routes["vote-day-summary"](boom, {})).body, []);
  assert.deepEqual(
    (await routes["vote-day-summary"](boom, { ns: "not-a-number" })).body,
    [],
  );
  // "not-a-number", NOT "" — Number("") is 0, which is finite, so clampInt returns the LOW
  // bound rather than the default and an empty ns is answered as NS 40. Every route in this
  // file behaves that way and NS 40 has no roll-call rows, so the effect is an empty result
  // either way; it is written down here because it is not what the code reads like.
  const empty = await routes["contested-votes"](boom, { ns: "not-a-number" });
  assert.deepEqual(empty.body, { anchor: null, recent: [], allTime: [] });
});

test("contested-votes partitions on the tier SQL assigned, and never re-ranks", async () => {
  const { DB_ROUTES: routes } = require("./db_routes.js");
  const row = (tier, date, contest) => ({
    tier,
    date,
    item_no: 1,
    slug: "s",
    title: "t",
    topic: "budget",
    yes: 100,
    no: 90,
    abstain: 0,
    contest,
    outcome: "passed",
    anchor: "2026-07-31",
    in_window: tier === "recent",
  });
  // The shape the query actually returns: a UNION ALL of two INDEPENDENTLY ranked and
  // limited sets. The tiers OVERLAP by design — a vote can be both the week's most
  // contested and the term's — and the route must not dedupe or re-sort them.
  const res = await routes["contested-votes"](
    async () => [
      row("recent", "2026-07-30", 0.47),
      row("recent", "2026-07-29", 0.4),
      row("all", "2026-02-04", 0.49),
      row("all", "2026-07-30", 0.47),
    ],
    { ns: "52", limit: "2" },
  );
  assert.equal(res.body.anchor, "2026-07-31");
  assert.deepEqual(
    res.body.recent.map((r) => r.date),
    ["2026-07-30", "2026-07-29"],
  );
  // allTime holds a HIGHER-scoring row than anything in the window. That is the case the
  // first draft could not produce: it ranked once, took the global top 200 and filtered the
  // window afterwards, so on the 51st ZERO of the trailing week's votes survived and the
  // tile silently showed the all-time list while captioned „тази седмица".
  assert.deepEqual(
    res.body.allTime.map((r) => r.date),
    ["2026-02-04", "2026-07-30"],
  );
  assert.ok(
    res.body.allTime[0].contestScore > res.body.recent[0].contestScore,
    "the fixture no longer exercises the window-vs-global distinction",
  );
  // outcome must survive the projection: the tile prints it as a word and colours the row
  // by it, and the first draft dropped it — every row rendered votes_outcome_undefined.
  assert.equal(res.body.recent[0].outcome, "passed");
  assert.deepEqual(res.body.recent[0].tally, { yes: 100, no: 90, abstain: 0 });
});
