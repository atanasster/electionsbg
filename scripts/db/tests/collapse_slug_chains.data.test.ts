// collapse_slug_chains.ts — the sweep that flattens merge chains in
// person_slug_retired (A→B written by one run, B→C by a later one, leaving A→B as
// a 301 into a 404).
//
// Every case runs against synthetic `zz-collapse-*` rows and cleans up after
// itself, so this never depends on — or disturbs — the real corpus. The two
// invariants worth pinning are the ones the review caught the first
// implementation getting wrong:
//
//   1. it must follow a chain to its END, and
//   2. it must refuse a target we would not SERVE, rather than re-pointing at one
//      and turning the data gate green while the redirect still 404s.
//
// Auto-skips when Postgres is down — like the other *.data.test.ts gates.
//
//   npm run test:data

import { test, afterAll, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { allRows, exec, end } from "../lib/pg";
import { collapseSlugRedirectChains } from "../../person/collapse_slug_chains";

const reachable = async (): Promise<boolean> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.person_slug_retired') IS NOT NULL AS ok",
    );
    return !!t?.ok;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb ? false : "Postgres unreachable";

// A real servable person and a real unservable one, so the fixtures exercise the
// actual §6 predicate rather than a stand-in.
const pick = async (servable: boolean): Promise<string | null> => {
  const [r] = await allRows<{ slug: string }>(
    `SELECT slug FROM person
      WHERE ${servable ? "" : "NOT "}(status = 'active' AND is_public_figure)
      LIMIT 1`,
  );
  return r?.slug ?? null;
};

const cleanup = () =>
  exec(`DELETE FROM person_slug_retired WHERE slug LIKE 'zz-collapse-%'`);

beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await end();
});

test.skipIf(skip)("follows a chain to its servable end", async () => {
  const live = await pick(true);
  assert.ok(live, "no servable person in the corpus to point at");

  await exec(
    `INSERT INTO person_slug_retired (slug, target_slug) VALUES
       ('zz-collapse-a', 'zz-collapse-b'),
       ('zz-collapse-b', ${quote(live)})`,
  );

  const r = await collapseSlugRedirectChains();
  assert.equal(r.repointed, 1, "the A→B row should have been re-pointed");

  const [a] = await allRows<{ target_slug: string }>(
    `SELECT target_slug FROM person_slug_retired WHERE slug = 'zz-collapse-a'`,
  );
  assert.equal(a.target_slug, live, "A must land on the chain's servable end");
});

// The regression guard for the bug the review caught: judging liveness by bare
// existence in `person` would re-point here, satisfy the existence-based data gate,
// and still serve a 404 — a loud failure converted into a silent one.
test.skipIf(skip)(
  "refuses a target that exists but is NOT servable",
  async () => {
    const unservable = await pick(false);
    assert.ok(unservable, "no unservable person in the corpus to test against");

    await exec(
      `INSERT INTO person_slug_retired (slug, target_slug) VALUES
         ('zz-collapse-a', 'zz-collapse-b'),
         ('zz-collapse-b', ${quote(unservable)})`,
    );

    const r = await collapseSlugRedirectChains();
    assert.equal(r.repointed, 0, "must not re-point onto an unservable person");

    const [a] = await allRows<{ target_slug: string }>(
      `SELECT target_slug FROM person_slug_retired WHERE slug = 'zz-collapse-a'`,
    );
    assert.equal(a.target_slug, "zz-collapse-b", "the broken row must survive");
    assert.ok(
      r.stillDeadCount >= 2,
      "both rows should be reported as still unservable",
    );
  },
);

test.skipIf(skip)("terminates on a cycle instead of spinning", async () => {
  await exec(
    `INSERT INTO person_slug_retired (slug, target_slug) VALUES
       ('zz-collapse-a', 'zz-collapse-b'),
       ('zz-collapse-b', 'zz-collapse-a')`,
  );
  // The assertion is that this RETURNS at all — an unbounded walk would hang the
  // suite rather than fail it.
  const r = await collapseSlugRedirectChains();
  assert.equal(r.repointed, 0, "a cycle has no servable end to re-point at");
});

test.skipIf(skip)("is idempotent — a second pass changes nothing", async () => {
  const live = await pick(true);
  assert.ok(live);
  await exec(
    `INSERT INTO person_slug_retired (slug, target_slug) VALUES
       ('zz-collapse-a', 'zz-collapse-b'),
       ('zz-collapse-b', ${quote(live)})`,
  );
  assert.equal((await collapseSlugRedirectChains()).repointed, 1);
  assert.equal((await collapseSlugRedirectChains()).repointed, 0);
});

/** Slugs are `[a-z0-9-]` by construction, but these are interpolated into DDL-ish
 *  fixture SQL, so quote them rather than trusting that. */
function quote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}
