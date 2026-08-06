// The hand-off gate: does Postgres reproduce the hub figures the JSON generator computes?
//
// This is the only thing that would catch a matview drifting away from the artifact it
// reproduces. Both sides currently exist, and while they do, disagreement is cheap to
// detect and free to explain; once the JSON retires, the SQL becomes the only source and
// this comparison is no longer possible. So it runs now, on every test:data.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dbReachable, end } from "../lib/pg";
import { readHubStatsFromPg } from "../gen_parliament/hub_stats_pg";

const BLOB = "data/parliament/votes/derived/hub_stats.json";
const haveDb = await dbReachable();

afterAll(async () => {
  if (haveDb) await end();
});

test("Postgres reproduces every hub tile figure", async (t) => {
  if (!haveDb || !existsSync(BLOB)) return t.skip();
  let sql;
  try {
    sql = await readHubStatsFromPg();
  } catch {
    return t.skip(); // matviews not built on this database
  }
  if (sql.size === 0) return t.skip();

  const blob = JSON.parse(readFileSync(BLOB, "utf8")) as {
    byNs: Record<
      string,
      {
        tiles: {
          sessions: number;
          items: number;
          membersVoting: number;
          groups: number;
          attendanceWeighted: number;
          cohesionMean: number;
          leastUnifiedGroup: string | null;
        };
      }
    >;
  };

  // The 45th and 52nd carry the 84 duplicate casts, so their attendance denominators
  // legitimately differ: the JSON counts those members twice, Postgres's primary key once,
  // and Postgres is therefore HIGHER. Bounded and directional rather than absorbed into a
  // tolerance — a tolerance wide enough to hide this would hide a real drift.
  const DUPLICATE_CAST_NS = new Set(["45", "52"]);
  const problems: string[] = [];

  for (const [ns, entry] of Object.entries(blob.byNs)) {
    const r = sql.get(Number(ns));
    if (!r) {
      problems.push(`${ns}: absent from Postgres`);
      continue;
    }
    const t0 = entry.tiles;
    if (t0.sessions !== Number(r.sessions))
      problems.push(`${ns}.sessions ${t0.sessions} vs ${r.sessions}`);
    if (t0.items !== Number(r.items))
      problems.push(`${ns}.items ${t0.items} vs ${r.items}`);
    if (t0.membersVoting !== Number(r.members_voting))
      problems.push(`${ns}.membersVoting`);
    if (t0.groups !== Number(r.groups))
      problems.push(`${ns}.groups ${t0.groups} vs ${r.groups}`);
    if (t0.leastUnifiedGroup !== r.least_group)
      problems.push(
        `${ns}.leastUnifiedGroup ${t0.leastUnifiedGroup} vs ${r.least_group}`,
      );

    const attDelta = Number(r.attendance_weighted) - t0.attendanceWeighted;
    const allowed = DUPLICATE_CAST_NS.has(ns) ? 2e-4 : 1e-6;
    if (
      Math.abs(attDelta) > allowed ||
      (attDelta > 1e-6 && !DUPLICATE_CAST_NS.has(ns))
    ) {
      problems.push(
        `${ns}.attendanceWeighted delta ${attDelta.toExponential(2)}`,
      );
    }
    // Noise-level, not 1e-3: a looser bound hid the spelling-merge divergence for a whole
    // step. Both generators fold renamed groups item-weighted now.
    const cohDelta = Math.abs(Number(r.cohesion_mean) - t0.cohesionMean);
    // The duplicate casts perturb the per-item bloc counts on the two parliaments that
    // carry them, so cohesion moves there too — bounded, but not directional the way
    // attendance is.
    if (cohDelta > (DUPLICATE_CAST_NS.has(ns) ? 2e-4 : 1e-9))
      problems.push(`${ns}.cohesionMean delta ${cohDelta.toExponential(2)}`);
  }

  assert.deepEqual(
    problems,
    [],
    "the SQL generator and the JSON generator disagree about the corpus",
  );
});
