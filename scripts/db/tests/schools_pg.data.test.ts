// Tier 3 (Postgres-native) — integrity invariants over the loaded schools
// serving layer (migration 055): the relational dim/fact tables AND the
// precomputed 'directory' payload the /education + /school/:id pages read.
// Guards against a loader regression silently shipping an empty or inconsistent
// education dataset — test:data would otherwise assert nothing about it.
//
//   npm run test:data   (or DB_VERIFY=1 npm run db:verify)
//
// Requires the Postgres store (`npm run db:pg:up` + `db:load:schools:pg`);
// auto-skips when Postgres is unreachable or the schools table is absent — so CI
// (no container, no corpus) skips it, like the other *_pg.data.test.ts files.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, end } from "../lib/pg";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

// Recompute the expected school_scores tuple count straight from the ingest
// index — the same rule the loader uses (numeric ДЗИ subject-years + numeric
// НВО bel/math). Independent of the DB so it catches silent ON CONFLICT drops.
const expectedScoreRows = (): number => {
  const idx = JSON.parse(
    readFileSync(path.join(ROOT, "data/schools/index.json"), "utf8"),
  ) as {
    schoolsByObshtina: Record<
      string,
      {
        scoresByYear: Record<string, Record<string, number>>;
        nvoByYear?: Record<string, { bel?: number; math?: number }>;
      }[]
    >;
  };
  let n = 0;
  for (const recs of Object.values(idx.schoolsByObshtina)) {
    for (const rec of recs) {
      for (const subs of Object.values(rec.scoresByYear))
        for (const v of Object.values(subs))
          if (typeof v === "number" && Number.isFinite(v)) n++;
      for (const nv of Object.values(rec.nvoByYear ?? {})) {
        if (typeof nv.bel === "number") n++;
        if (typeof nv.math === "number") n++;
      }
    }
  }
  return n;
};

const reachable = async (): Promise<boolean> => {
  try {
    await allRows("SELECT 1");
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.schools') IS NOT NULL AS ok",
    );
    return !!t?.ok;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb ? false : "Postgres unreachable / schools table absent";

afterAll(async () => {
  await end();
});

test.skipIf(skip)("directory payload exists and is non-empty", async () => {
  const [r] = await allRows<{ n: number }>(
    `SELECT jsonb_array_length(payload -> 'schools')::int AS n
       FROM school_payloads WHERE kind = 'directory' AND key = ''`,
  );
  assert.ok(r, "no 'directory' payload row (loader did not write it)");
  assert.ok(
    r.n > 0,
    `directory payload has ${r?.n} schools — expected the full corpus`,
  );
});

test.skipIf(skip)(
  "schools table row count matches the directory payload",
  async () => {
    const [tbl] = await allRows<{ n: number }>(
      "SELECT count(*)::int AS n FROM schools",
    );
    const [pay] = await allRows<{ n: number }>(
      `SELECT jsonb_array_length(payload -> 'schools')::int AS n
       FROM school_payloads WHERE kind = 'directory' AND key = ''`,
    );
    assert.equal(
      tbl.n,
      pay.n,
      `schools table (${tbl.n}) ≠ directory payload (${pay.n}) — a dup id or ` +
        `an ON CONFLICT DO NOTHING drop would undercount the relational table`,
    );
  },
);

test.skipIf(skip)(
  "school_scores row count matches the index (no silent ON CONFLICT drops)",
  async () => {
    const [db] = await allRows<{ n: number }>(
      "SELECT count(*)::int AS n FROM school_scores",
    );
    const expected = expectedScoreRows();
    assert.equal(
      db.n,
      expected,
      `school_scores has ${db.n} rows but the index yields ${expected} tuples — ` +
        `a duplicate (school_id,year,subject) would be silently dropped by ` +
        `ON CONFLICT DO NOTHING in load_schools_pg.ts`,
    );
  },
);

test.skipIf(skip)(
  "no orphan score rows (every fact has a school)",
  async () => {
    const [r] = await allRows<{ n: number }>(
      `SELECT count(*)::int AS n FROM school_scores f
       WHERE NOT EXISTS (SELECT 1 FROM schools s WHERE s.id = f.school_id)`,
    );
    assert.equal(
      r.n,
      0,
      `${r.n} school_scores rows reference a missing school id`,
    );
  },
);

test.skipIf(skip)("the SES + value-added regressions ran", async () => {
  // A verdict distribution proves the loader's OLS fits produced bands rather
  // than silently null-ing out (e.g. too few rows, or a shape change upstream).
  const [r] = await allRows<{ ses: number; va: number }>(
    `SELECT
       count(*) FILTER (WHERE (s ->> 'verdict') IS NOT NULL)::int   AS ses,
       count(*) FILTER (WHERE (s ->> 'vaVerdict') IS NOT NULL)::int AS va
     FROM school_payloads,
          jsonb_array_elements(payload -> 'schools') AS s
     WHERE kind = 'directory' AND key = ''`,
  );
  assert.ok(
    r.ses > 0,
    "no SES-context verdicts in the payload (regression null)",
  );
  assert.ok(
    r.va > 0,
    "no value-added verdicts in the payload (regression null)",
  );
});

test.skipIf(skip)(
  "the per-oblast series' latest slice reconciles with byOblast",
  async () => {
    // byOblastYear aggregates whoever reported each year; byOblast counts only
    // schools whose OWN latest year is the national one. Those rules coincide
    // while every reporting school is current, and the /education table reads
    // both — so a drift here means one of the two is wrong, not that the data
    // moved. Compare on avg AND examinees, all 28 oblasts.
    const [r] = await allRows<{ mismatches: number; compared: number }>(
      `WITH d AS (
         SELECT payload AS p FROM school_payloads WHERE kind = 'directory' AND key = ''
       ),
       cur AS (
         SELECT o ->> 'oblast' AS ob,
                (o ->> 'avg')::numeric AS avg,
                (o ->> 'examinees')::int AS n
         FROM d, jsonb_array_elements(p -> 'byOblast') AS o
       ),
       new AS (
         SELECT o ->> 'oblast' AS ob,
                (y ->> 'avg')::numeric AS avg,
                (y ->> 'examinees')::int AS n
         FROM d,
              jsonb_array_elements(p -> 'byOblastYear') AS o,
              jsonb_array_elements(o -> 'years') AS y
         WHERE (y ->> 'year')::int = (p ->> 'latestYear')::int
       )
       SELECT count(*) FILTER (
                WHERE cur.avg IS DISTINCT FROM new.avg
                   OR cur.n IS DISTINCT FROM new.n
              )::int AS mismatches,
              count(*)::int AS compared
       FROM cur FULL JOIN new USING (ob)`,
    );
    assert.ok(r.compared > 0, "no oblasts compared — byOblastYear is missing");
    assert.equal(
      r.mismatches,
      0,
      `${r.mismatches}/${r.compared} oblasts disagree between byOblast and the latest byOblastYear slice`,
    );
  },
);

test.skipIf(skip)("every oblast series is ordered and complete", async () => {
  // The dumbbell reads first-vs-latest off the ends of each series, so an
  // unsorted or single-point series would silently render a wrong change.
  const [r] = await allRows<{
    oblasts: number;
    short: number;
    unsorted: number;
  }>(
    `WITH d AS (
       SELECT payload AS p FROM school_payloads WHERE kind = 'directory' AND key = ''
     ),
     s AS (
       SELECT o ->> 'oblast' AS ob,
              array_agg((y ->> 'year')::int ORDER BY ord) AS years
       FROM d,
            jsonb_array_elements(p -> 'byOblastYear') AS o,
            jsonb_array_elements(o -> 'years') WITH ORDINALITY AS t(y, ord)
       GROUP BY 1
     )
     SELECT count(*)::int AS oblasts,
            count(*) FILTER (WHERE array_length(years, 1) < 2)::int AS short,
            count(*) FILTER (WHERE years <> (SELECT array_agg(x ORDER BY x) FROM unnest(years) AS x))::int AS unsorted
     FROM s`,
  );
  assert.equal(r.oblasts, 28, `expected 28 oblasts, got ${r.oblasts}`);
  assert.equal(r.short, 0, `${r.short} oblasts carry fewer than 2 years`);
  assert.equal(
    r.unsorted,
    0,
    `${r.unsorted} oblast series are not year-sorted`,
  );
});

test.skipIf(skip)("every series point carries its cohort", async () => {
  // /school/:id marks years under MIN_RANK_COHORT as provisional, so a missing
  // `n` would silently promote a 3-pupil year to a confident-looking dot. The
  // index has a count for every scored year, so the payload must too.
  const [r] = await allRows<{ points: number; missing: number }>(
    `SELECT count(*)::int AS points,
            count(*) FILTER (WHERE NOT (p ? 'n'))::int AS missing
     FROM school_payloads,
          jsonb_array_elements(payload -> 'schools') AS s,
          jsonb_array_elements(s -> 'series') AS p
     WHERE kind = 'directory' AND key = ''`,
  );
  assert.ok(r.points > 0, "no series points in the directory payload");
  assert.equal(
    r.missing,
    0,
    `${r.missing}/${r.points} series points have no cohort count`,
  );
});

test.skipIf(skip)("matched ЕИК is resolvable and non-blank", async () => {
  const [r] = await allRows<{ blank: number }>(
    "SELECT count(*)::int AS blank FROM schools WHERE eik IS NOT NULL AND btrim(eik) = ''",
  );
  assert.equal(r.blank, 0, `${r.blank} schools carry a blank (non-null) eik`);
});
