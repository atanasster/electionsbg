// The /culture hub quotes eight figures as FROZEN STRINGS in its copy.
//
// That is a deliberate trade — a hub tile must render before any fetch, and the
// alternative (a live call per tile) is the payload problem the hub pattern
// exists to solve. The cost is that the numbers cannot self-correct, and they sit
// beside the film figures the PRERENDER does interpolate from
// data/culture/overview.json, so half the page updates itself and half does not,
// indistinguishably to a reader.
//
// So this gate re-derives every quoted figure from Postgres. It is the only thing
// standing between a corpus reload and a hub that states, confidently and in
// large type, a number that stopped being true.
//
// It asserts a BAND, not equality: the corpora move, and a gate that fails on
// every ingest gets deleted. The band is wide enough to survive ordinary drift
// and narrow enough that a figure which has become wrong cannot hide in it —
// when one trips, update the copy AND the expectation together.
//
// Auto-skips ONLY when Postgres is down.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { allRows, dbReachable, end } from "../lib/pg";
import { CULTURE_GROUP_EIKS } from "@/lib/kulturaReferenceData";

const haveDb = await dbReachable();
const skip = !haveDb ? "Postgres unreachable" : false;

afterAll(async () => {
  await end();
});

const TOLERANCE = 0.05;

// The copy lives in the REGISTRY (pure data, no JSX) rather than in the screen —
// the screen exporting it tripped react-refresh/only-export-components.
const copy = () =>
  readFileSync(
    path.resolve(process.cwd(), "src/screens/culture/cultureRegistry.ts"),
    "utf8",
  );

/** The figure must still be PRESENT in the copy — otherwise this gate silently
 *  stops checking anything the day someone rewords a tile. */
const quoted = (needle: string) =>
  assert.ok(
    copy().includes(needle),
    `cultureRegistry.ts no longer contains "${needle}" — either the tile was ` +
      `reworded (update this gate with it) or the figure was dropped`,
  );

const near = (actual: number, expected: number, what: string) =>
  assert.ok(
    Math.abs(actual - expected) / expected <= TOLERANCE,
    `${what}: the corpus says ${actual.toLocaleString()}, the hub copy says ` +
      `${expected.toLocaleString()} (±${TOLERANCE * 100}%). Update the tile copy ` +
      `and this expectation together.`,
  );

test.skipIf(skip)("the procurement tile's figures still hold", async () => {
  quoted("€157.9 млн.");
  quoted("881 договора");
  quoted("42 институции");
  const [r] = await allRows<{ n: string; eur: string; buyers: string }>(
    `SELECT count(*) n, round(sum(amount_eur)::numeric, 0) eur,
            count(DISTINCT awarder_eik) buyers
       FROM contracts WHERE tag = 'contract' AND awarder_eik = ANY($1)`,
    [[...CULTURE_GROUP_EIKS]],
  );
  near(Number(r.n), 881, "contract count");
  near(Number(r.eur), 157_900_000, "contract money");
  near(Number(r.buyers), 42, "procuring institutions");
});

test.skipIf(skip)(
  "the competition tile's rate and its baseline still hold",
  async () => {
    quoted("42.0%");
    quoted("40.9%");
    const [c] = await allRows<{ sb: string; bk: string }>(
      `SELECT count(*) FILTER (WHERE number_of_tenderers = 1) sb,
            count(*) FILTER (WHERE number_of_tenderers IS NOT NULL) bk
       FROM contracts WHERE tag = 'contract' AND awarder_eik = ANY($1)`,
      [[...CULTURE_GROUP_EIKS]],
    );
    near((Number(c.sb) / Number(c.bk)) * 100, 42.0, "culture single-bid rate");
    const [n] = await allRows<{ sb: string; bk: string }>(
      `SELECT count(*) FILTER (WHERE number_of_tenderers = 1) sb,
            count(*) FILTER (WHERE number_of_tenderers IS NOT NULL) bk
       FROM contracts WHERE tag = 'contract'`,
    );
    near((Number(n.sb) / Number(n.bk)) * 100, 40.9, "national baseline");
    // The POINT of the pair: culture is typical. If the sector ever diverges
    // materially the copy („Типично, не изключение") stops being true, and that is
    // a claim about the world, not a number.
    const gap =
      (Number(c.sb) / Number(c.bk)) * 100 - (Number(n.sb) / Number(n.bk)) * 100;
    assert.ok(
      Math.abs(gap) < 5,
      `culture is now ${gap.toFixed(1)} points from the national single-bid rate; ` +
        `the tile still says „Типично, не изключение"`,
    );
  },
);

test.skipIf(skip)(
  "the risk tile's claim of no E or F still holds",
  async () => {
    quoted("няма нито един с E или F");
    const rows = await allRows<{ grade: string; n: string }>(
      `SELECT r.grade, count(*) n
       FROM contracts c JOIN contract_risk_cache r ON r.key = c.key
      WHERE c.tag = 'contract' AND c.awarder_eik = ANY($1)
      GROUP BY 1`,
      [[...CULTURE_GROUP_EIKS]],
    );
    const bad = rows.filter((r) => r.grade === "E" || r.grade === "F");
    assert.deepEqual(
      bad,
      [],
      `the culture corpus now has ${bad.map((b) => `${b.n} ${b.grade}`).join(", ")} ` +
        `— the risk tile says it has none, and its ?grade=C,D link omits them`,
    );
  },
);

test.skipIf(skip)("the directors tile's count still holds", async () => {
  quoted("224 души");
  const [r] = await allRows<{ n: string }>(
    `SELECT count(DISTINCT person_id) n FROM person_role
      WHERE role = 'cultural_institute'`,
  );
  near(Number(r.n), 224, "culture-institute role holders");
});

test.skipIf(skip)("the budget tile's figure still holds", async () => {
  quoted("€269.1 млн.");
  const [r] = await allRows<{ eur: string }>(
    `SELECT round(value_eur::numeric, 0) eur FROM budget_admin_fact f
       JOIN budget_admin_node n ON n.node_id = f.node_id
      WHERE n.name ILIKE '%култура%' AND f.year = 2026 AND f.kind = 'planned'
      ORDER BY value_eur DESC LIMIT 1`,
  ).catch(() => [] as { eur: string }[]);
  // The budget tables are a REFRESH_EXCLUSIONS family — absent on a fresh clone
  // rather than empty-but-loaded, so a missing row is not a failure here.
  if (r) near(Number(r.eur), 269_051_700, "МК planned budget 2026");
});
