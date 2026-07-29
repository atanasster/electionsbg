// The persons-browser loader's preflight message. Pure and hermetic — no database.
//
// This text is the ONLY thing that tells an operator which loader they skipped, and both
// failure modes it names are silent in Postgres: a MISSING input aborts the build with a
// bare relation error, and an EMPTY one builds happily and publishes blanks (no photos, no
// money column, or every 'declared' TR link quietly demoted to 'name_match'). So the
// wording is worth locking.

import { test } from "vitest";
import assert from "node:assert/strict";
import { preflightError } from "./load_persons_browse_pg";

// Every input the loader requires, present and non-empty.
const ALL = [
  "person",
  "person_role",
  "person_source",
  "place_dim",
  "judicial_body",
  "mp_profile",
  "official_candidate_link",
  "person_wealth_year",
  "declaration",
  "contracts",
  "company_politicians",
  "magistrate_company",
];

test("a fully loaded database produces no error", () => {
  assert.equal(preflightError(ALL, []), null);
});

test("a missing input is named, not merely counted", () => {
  const err = preflightError(
    ALL.filter((t) => t !== "place_dim"),
    [],
  );
  assert.ok(err, "a missing input must fail the preflight");
  assert.match(err, /missing: place_dim/);
  // The operator needs the fix, not just the diagnosis.
  assert.match(err, /db:refresh sequences them locally/);
});

test("an empty input is reported separately from a missing one", () => {
  const err = preflightError(ALL, ["contracts"]);
  assert.ok(
    err,
    "an empty input must fail the preflight — it publishes blanks silently",
  );
  assert.match(err, /empty: contracts/);
  assert.doesNotMatch(
    err,
    /missing:/,
    "nothing is missing here; conflating the two sends the operator to the wrong loader",
  );
});

test("both conditions are reported together", () => {
  const err = preflightError(
    ALL.filter((t) => t !== "judicial_body"),
    ["mp_profile"],
  );
  assert.ok(err);
  assert.match(err, /missing: judicial_body/);
  assert.match(err, /empty: mp_profile/);
});

test("several missing inputs are all listed", () => {
  const err = preflightError(["person", "person_role"], []);
  assert.ok(err);
  for (const t of ["place_dim", "judicial_body", "contracts"])
    assert.match(
      err,
      new RegExp(t),
      `${t} is missing but unnamed in the message`,
    );
});

// The join-key check. This is the gap that shipped: Cloud SQL held all 47,983 `declaration`
// rows with `person_id` NULL, so presence and row count both passed while the matview
// published has_declaration=false for every one of 56,801 people.
const KEY = {
  table: "declaration",
  column: "person_id",
  fix: "db:load:declarations:pg -- --resolve (phase 2 links declarations to the person layer)",
};

test("a wholly-NULL join key fails the preflight, even when the table is full", () => {
  const err = preflightError(ALL, [], [KEY]);
  assert.ok(
    err,
    "a present, non-empty table whose join key is NULL on every row must NOT pass",
  );
  assert.match(err, /declaration\.person_id is NULL on every row/);
  // The operator needs the command, not just the diagnosis.
  assert.match(err, /--resolve/);
});

test("the join-key failure is reported separately from missing and empty", () => {
  const err = preflightError(ALL, [], [KEY]);
  assert.ok(err);
  assert.doesNotMatch(err, /missing:/);
  assert.doesNotMatch(err, /empty:/);
});

test("all three failure kinds can be reported at once", () => {
  const err = preflightError(
    ALL.filter((t) => t !== "place_dim"),
    ["contracts"],
    [KEY],
  );
  assert.ok(err);
  assert.match(err, /missing: place_dim/);
  assert.match(err, /empty: contracts/);
  assert.match(err, /declaration\.person_id is NULL/);
});

test("a fully linked database still produces no error", () => {
  assert.equal(preflightError(ALL, [], []), null);
});
