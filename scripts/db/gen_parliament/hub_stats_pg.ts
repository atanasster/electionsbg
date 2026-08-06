// The hub blob, computed from Postgres instead of from rebuildDerived's in-memory objects.
//
// THE HAND-OFF, AND WHY IT DOES NOT SWAP YET (plan §10, step 6). H1's generator computes
// from the same objects the derived JSON artifacts are made of, which is what makes it
// impossible for the hub's numbers to drift from the sub-pages'. This one reads the
// matviews — a REPRODUCTION of those artifacts. Replacing a verified path with a
// reproduction of it, on the strength of the reproduction being new, is the wrong trade:
// two of the four matviews were wrong when first written (party_cohesion's denominator,
// mp_dissent's tie-break), and both produced plausible numbers rather than errors.
//
// So this runs in `--check` mode by default: it computes the blob from SQL and DIFFS it
// against the committed one. The swap becomes safe when the two agree over several
// ingests, and becomes NECESSARY when the JSON artifacts retire — at which point the
// in-memory generator loses its inputs and this becomes the only source. Until then the
// diff is the useful artifact, because it is the only thing that would catch a matview
// drifting away from the JSON it reproduces.
//
//   npx tsx scripts/db/gen_parliament/hub_stats_pg.ts            # check, exit 1 on drift
//   npx tsx scripts/db/gen_parliament/hub_stats_pg.ts --write    # take over the blob

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, end } from "../lib/pg";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const BLOB = path.join(ROOT, "data/parliament/votes/derived/hub_stats.json");

interface SqlRow {
  ns: number;
  sessions: string;
  items: string;
  members_voting: string;
  groups: string;
  attendance_weighted: string;
  cohesion_mean: string;
  least_group: string | null;
  least_value: string | null;
}

/** The same figures H1 computes, expressed against the matviews.
 *
 *  Every clause here mirrors a decision documented in hub_stats.ts, and getting any of them
 *  wrong yields a plausible number: `superseded_by IS NULL` (else +9.8%), attendance
 *  WEIGHTED rather than a mean of rates (else +3pp), and the unaffiliated buckets excluded
 *  from the group set (else the 50th reads 0.94 instead of 0.973). */
export const readHubStatsFromPg = async (): Promise<Map<number, SqlRow>> => {
  const rows = await allRows<SqlRow>(`
    WITH standing AS (
      SELECT ns, count(*) AS items, count(DISTINCT date) AS sessions
        FROM vote_item WHERE superseded_by IS NULL GROUP BY ns
    ),
    att AS (
      SELECT ns,
             count(*)                                        AS members_voting,
             sum(present)::numeric / NULLIF(sum(items), 0)   AS attendance_weighted
        FROM mp_attendance GROUP BY ns
    ),
    groups AS (
      -- Real parliamentary groups only, and one row per group rather than per spelling.
      SELECT c.ns,
             upper(replace(p.short, ' ', '')) AS gkey,
             min(p.short)                     AS label,
             sum(c.cohesion * c.items) / NULLIF(sum(c.items), 0) AS cohesion
        FROM party_cohesion c
        JOIN party_dim p ON p.party_id = c.party_id
       WHERE p.short !~* '^(НЕЗ|НЕЧЛ)'
       GROUP BY c.ns, upper(replace(p.short, ' ', ''))
    ),
    coh AS (
      SELECT ns,
             count(*)      AS groups,
             avg(cohesion) AS cohesion_mean,
             (array_agg(label ORDER BY cohesion))[1]    AS least_group,
             (array_agg(cohesion ORDER BY cohesion))[1] AS least_value
        FROM groups GROUP BY ns
    )
    SELECT s.ns, s.sessions::text, s.items::text,
           a.members_voting::text, c.groups::text,
           a.attendance_weighted::text, c.cohesion_mean::text,
           c.least_group, c.least_value::text
      FROM standing s
      LEFT JOIN att a ON a.ns = s.ns
      LEFT JOIN coh c ON c.ns = s.ns
     ORDER BY s.ns`);
  return new Map(rows.map((r) => [Number(r.ns), r]));
};

const run = async (): Promise<void> => {
  const write = process.argv.includes("--write");
  if (!existsSync(BLOB)) {
    console.warn(
      `hub_stats_pg: ${BLOB} is absent — run npm run derived:rebuild first`,
    );
    await end();
    process.exitCode = 1;
    return;
  }
  const committed = JSON.parse(readFileSync(BLOB, "utf8")) as {
    byNs: Record<string, { tiles: Record<string, unknown> }>;
  };
  const sql = await readHubStatsFromPg();

  // Tolerances, not equality, on the two derived rates: the JSON is computed in float64
  // over a different summation order, so the last bit can differ. Anything larger is a
  // genuine disagreement about the corpus.
  const EPS = 1e-9;

  // ONE known disagreement, and it is not a defect in either generator. The 45th and 52nd
  // parliaments are the two that carry the 84 duplicate (item, MP) casts the source lists
  // twice; the JSON counts them twice and so divides by a denominator that is too large,
  // while Postgres's primary key counts each once. Postgres is therefore HIGHER, and only
  // on those two. Encoded rather than absorbed into a wider tolerance, because a tolerance
  // big enough to hide this is big enough to hide a real drift.
  const DUPLICATE_CAST_NS = new Set([45, 52]);
  const EXPECTED_DRIFT = 2e-4;
  const drift: string[] = [];
  const known: string[] = [];
  for (const [ns, entry] of Object.entries(committed.byNs)) {
    const r = sql.get(Number(ns));
    if (!r) {
      drift.push(`${ns}: absent from Postgres`);
      continue;
    }
    const t = entry.tiles as {
      sessions: number;
      items: number;
      membersVoting: number;
      groups: number;
      attendanceWeighted: number;
      cohesionMean: number;
      leastUnifiedGroup: string | null;
    };
    const cmp: Array<[string, number, number, number]> = [
      ["sessions", t.sessions, Number(r.sessions), 0],
      ["items", t.items, Number(r.items), 0],
      ["membersVoting", t.membersVoting, Number(r.members_voting), 0],
      ["groups", t.groups, Number(r.groups), 0],
      [
        "attendanceWeighted",
        t.attendanceWeighted,
        Number(r.attendance_weighted),
        1e-6,
      ],
      // 1e-9, not 1e-3. The looser bound was hiding a real structural difference: the JSON
      // side DISCARDED one spelling of a renamed group while the SQL merged both, which put
      // the 51st 3.4e-5 apart — ten orders above float noise and invisible under 1e-3. Both
      // sides merge item-weighted now, so anything above noise is a genuine drift.
      ["cohesionMean", t.cohesionMean, Number(r.cohesion_mean), 1e-9],
    ];
    for (const [field, json, pg, tol] of cmp) {
      const delta = Math.abs(json - pg);
      if (delta <= Math.max(tol, EPS)) continue;
      // The duplicate casts move BOTH derived rates on the two parliaments that carry
      // them: attendance through its denominator, cohesion through the per-item bloc
      // counts. Attendance is directional (Postgres divides by less, so it reads higher);
      // cohesion can go either way, so only its magnitude is bounded.
      if (
        DUPLICATE_CAST_NS.has(Number(ns)) &&
        delta < EXPECTED_DRIFT &&
        (field === "cohesionMean" ||
          (field === "attendanceWeighted" && pg > json))
      ) {
        known.push(
          `${ns}.${field}: ${(pg - json).toExponential(2)} (the 84 duplicate casts)`,
        );
        continue;
      }
      drift.push(`${ns}.${field}: json=${json} pg=${pg}`);
    }
    if (t.leastUnifiedGroup !== r.least_group) {
      drift.push(
        `${ns}.leastUnifiedGroup: json=${t.leastUnifiedGroup} pg=${r.least_group}`,
      );
    }
  }

  if (drift.length) {
    console.error(
      `hub_stats_pg: ${drift.length} field(s) disagree between the JSON generator and Postgres:`,
    );
    for (const d of drift.slice(0, 20)) console.error(`  ${d}`);
    process.exitCode = 1;
  } else {
    console.log(
      `hub_stats_pg: Postgres reproduces every hub figure across ${sql.size} parliaments`,
    );
    for (const k of known) console.log(`  expected: ${k}`);
  }

  if (write) {
    // Deliberately NOT implemented as a silent takeover: the fields the SQL cannot produce
    // (coverage, seeds, inRecessDays) come from the JSON side, so a --write that dropped
    // them would blank the coverage banner. When the JSON retires, this is where that
    // logic moves — and it should move with its own tests, not as a flag.
    console.warn(
      "hub_stats_pg: --write is not implemented. The SQL covers the tile figures only; " +
        "coverage, seeds and inRecessDays still come from rebuildDerived. Retire the JSON " +
        "artifacts first, then move those three here.",
    );
  }
  await end();
};

if (process.argv[1] && process.argv[1].includes("hub_stats_pg")) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
