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
import { MIN_RANK_COHORT } from "../lib/school_stats";

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

test.skipIf(skip)("the maths line carries its cohort", async () => {
  // /school/:id qualifies the ДЗИ Maths figure when the group was under the
  // ranking floor — which is most of them (108 of 152 schools). Without `n` the
  // card would print a 1-pupil average unqualified, exactly like a 145-pupil
  // one. The index has a count wherever it has a maths score, so the payload
  // must too.
  const [r] = await allRows<{ withMath: number; missing: number }>(
    `SELECT count(*) FILTER (WHERE s -> 'mathLatest' <> 'null'::jsonb)::int AS "withMath",
            count(*) FILTER (
              WHERE s -> 'mathLatest' <> 'null'::jsonb
                AND NOT (s -> 'mathLatest' ? 'n')
            )::int AS missing
     FROM school_payloads,
          jsonb_array_elements(payload -> 'schools') AS s
     WHERE kind = 'directory' AND key = ''`,
  );
  assert.ok(r.withMath > 0, "no school carries a mathLatest — parser change?");
  assert.equal(
    r.missing,
    0,
    `${r.missing}/${r.withMath} maths results have no cohort count`,
  );
});

test.skipIf(skip)("matched ЕИК is resolvable and non-blank", async () => {
  const [r] = await allRows<{ blank: number }>(
    "SELECT count(*)::int AS blank FROM schools WHERE eik IS NOT NULL AND btrim(eik) = ''",
  );
  assert.equal(r.blank, 0, `${r.blank} schools carry a blank (non-null) eik`);
});

// ── 'place' blobs — the Governance place-node education tiles ────────────────
// docs/plans/education-place-card-v1.md §8. These blobs are what
// /governance/region/:oblast renders INSTEAD of the 647 KB directory, so the
// two must agree by construction: a drift puts one matura average on /education
// and a different one on the region page, both at a 200.

test.skipIf(skip)("every oblast with schools has a place blob", async () => {
  const [r] = await allRows<{ missing: number; oblasts: number }>(
    `WITH d AS (
       SELECT payload AS p FROM school_payloads WHERE kind = 'directory' AND key = ''
     ),
     ob AS (SELECT o ->> 'oblast' AS code FROM d, jsonb_array_elements(p -> 'byOblast') AS o)
     SELECT count(*)::int AS oblasts,
            count(*) FILTER (
              WHERE NOT EXISTS (
                SELECT 1 FROM school_payloads sp
                 WHERE sp.kind = 'place' AND sp.key = ob.code
              )
            )::int AS missing
     FROM ob`,
  );
  assert.equal(r.oblasts, 28, `expected 28 oblasts, got ${r.oblasts}`);
  assert.equal(r.missing, 0, `${r.missing} oblasts have no 'place' blob`);
  // Sofia city is keyed S23 at region grain and SOF00 at município grain; the
  // three Sofia МИР pages alias onto the first, phase 2 onto the second.
  const [sof] = await allRows<{ n: number }>(
    `SELECT count(*)::int AS n FROM school_payloads
      WHERE kind = 'place' AND key IN ('S23', 'SOF00')`,
  );
  assert.equal(sof.n, 2, "Sofia city is missing its S23 / SOF00 place blob");
});

test.skipIf(skip)(
  "each region blob's headline reconciles with the directory's byOblast",
  async () => {
    // Two independent computations of the same number — buildPlacePayloads folds
    // the school list, byOblast is accumulated in the loader — so equality here
    // is a real cross-check, not a tautology.
    const [r] = await allRows<{ compared: number; mismatches: number }>(
      `WITH d AS (
         SELECT payload AS p FROM school_payloads WHERE kind = 'directory' AND key = ''
       ),
       cur AS (
         SELECT o ->> 'oblast' AS ob,
                (o ->> 'avg')::numeric AS avg,
                (o ->> 'examinees')::int AS n,
                (o ->> 'schools')::int AS schools
         FROM d, jsonb_array_elements(p -> 'byOblast') AS o
       ),
       pl AS (
         SELECT key AS ob,
                (payload ->> 'avg')::numeric AS avg,
                (payload ->> 'examinees')::int AS n,
                (payload ->> 'schools')::int AS schools
         FROM school_payloads
         WHERE kind = 'place' AND payload ->> 'grain' = 'region'
       )
       SELECT count(*)::int AS compared,
              count(*) FILTER (
                WHERE cur.avg IS DISTINCT FROM pl.avg
                   OR cur.n IS DISTINCT FROM pl.n
                   OR cur.schools IS DISTINCT FROM pl.schools
              )::int AS mismatches
       FROM cur FULL JOIN pl USING (ob)`,
    );
    assert.ok(r.compared > 0, "no region blobs to compare");
    assert.equal(
      r.mismatches,
      0,
      `${r.mismatches}/${r.compared} region blobs disagree with byOblast on avg/examinees/schools`,
    );
  },
);

test.skipIf(skip)(
  "the по-общини rows account for every school in the region headline",
  async () => {
    const [r] = await allRows<{ regions: number; mismatches: number }>(
      `WITH pl AS (
         SELECT key AS ob,
                (payload ->> 'schools')::int AS schools,
                (SELECT coalesce(sum((m ->> 'schools')::int), 0)
                   FROM jsonb_array_elements(payload -> 'byObshtina') AS m) AS muni_schools
         FROM school_payloads
         WHERE kind = 'place' AND payload ->> 'grain' = 'region'
       )
       SELECT count(*)::int AS regions,
              count(*) FILTER (WHERE schools <> muni_schools)::int AS mismatches
       FROM pl`,
    );
    assert.ok(r.regions > 0, "no region blobs found");
    assert.equal(
      r.mismatches,
      0,
      `${r.mismatches}/${r.regions} regions have по-общини rows that don't sum to the headline school count`,
    );
  },
);

test.skipIf(skip)("no ranked list shows a sub-cohort school", async () => {
  // MIN_RANK_COHORT is the site-wide floor. The bottom list is where breaking
  // it would be actively unfair — a 4-pupil year naming a school as the worst
  // in its oblast.
  const [r] = await allRows<{ rows: number; under: number }>(
    // `row ->> 'n' IS NULL OR …` on purpose: `NULL < 10` is NULL, not true, so
    // the bare comparison would pass a row emitted with no cohort at all.
    `SELECT count(*)::int AS rows,
            count(*) FILTER (
              WHERE row ->> 'n' IS NULL OR (row ->> 'n')::int < $1
            )::int AS under
     FROM school_payloads,
          LATERAL (
            SELECT jsonb_array_elements(payload -> 'top') AS row
            UNION ALL SELECT jsonb_array_elements(payload -> 'bottom')
            UNION ALL SELECT jsonb_array_elements(payload -> 'above')
            UNION ALL SELECT jsonb_array_elements(payload -> 'va' -> 'rows')
          ) AS lists
     WHERE kind = 'place'`,
    [MIN_RANK_COHORT],
  );
  assert.ok(r.rows > 0, "no ranked rows in any place blob");
  assert.equal(
    r.under,
    0,
    `${r.under}/${r.rows} ranked rows are under the ${MIN_RANK_COHORT}-graduate floor`,
  );
});

test.skipIf(skip)(
  "'над очакваното' rows carry the directory's own residual and verdict",
  async () => {
    // The tile must never re-fit a regression; it renders what the loader
    // computed. A residual that drifts from the directory means the place blob
    // is doing its own arithmetic somewhere.
    const [r] = await allRows<{ rows: number; bad: number }>(
      `WITH dir AS (
         SELECT s ->> 'id' AS id,
                (s ->> 'residual')::numeric AS residual,
                s ->> 'verdict' AS verdict
         FROM school_payloads, jsonb_array_elements(payload -> 'schools') AS s
         WHERE kind = 'directory' AND key = ''
       ),
       above AS (
         SELECT row ->> 'id' AS id,
                (row ->> 'residual')::numeric AS residual,
                row ->> 'verdict' AS verdict
         FROM school_payloads,
              jsonb_array_elements(payload -> 'above') AS row
         WHERE kind = 'place'
       )
       SELECT count(*)::int AS rows,
              count(*) FILTER (
                -- IS DISTINCT FROM, not <>: a leaked row carrying verdict NULL
                -- would make every disjunct NULL and count as good.
                WHERE above.verdict IS DISTINCT FROM 'above'
                   OR dir.id IS NULL
                   OR dir.residual IS DISTINCT FROM above.residual
                   OR dir.verdict IS DISTINCT FROM above.verdict
              )::int AS bad
       FROM above LEFT JOIN dir USING (id)`,
    );
    assert.ok(r.rows > 0, "no 'above' rows in any place blob");
    assert.equal(
      r.bad,
      0,
      `${r.bad}/${r.rows} 'above' rows disagree with the directory's residual/verdict`,
    );
  },
);

test.skipIf(skip)("no ranked row predates the blob's own year", async () => {
  // The membership rule that keeps every list on the headline's school set. A
  // school that stops reporting keeps its old score in `latestScore`, so
  // without this it would be ranked, undated, inside a later-year card — while
  // /school/:id and /education both show its year correctly.
  const [r] = await allRows<{ rows: number; stale: number }>(
    `WITH dir AS (
       SELECT s ->> 'id' AS id, (s ->> 'latestYear')::int AS ly
         FROM school_payloads, jsonb_array_elements(payload -> 'schools') AS s
        WHERE kind = 'directory' AND key = ''
     ),
     l AS (
       SELECT (payload ->> 'latestYear')::int AS ply, x.r ->> 'id' AS id
         FROM school_payloads,
              LATERAL (
                SELECT jsonb_array_elements(payload -> 'top') AS r
                UNION ALL SELECT jsonb_array_elements(payload -> 'bottom')
                UNION ALL SELECT jsonb_array_elements(payload -> 'above')
                UNION ALL SELECT jsonb_array_elements(payload -> 'va' -> 'rows')
              ) AS x
        WHERE kind = 'place'
     )
     SELECT count(*)::int AS rows,
            count(*) FILTER (WHERE dir.ly IS DISTINCT FROM l.ply)::int AS stale
     FROM l JOIN dir USING (id)`,
  );
  assert.ok(r.rows > 0, "no ranked rows to check");
  assert.equal(
    r.stale,
    0,
    `${r.stale}/${r.rows} ranked rows carry a score from before the blob's year`,
  );
});

test.skipIf(skip)(
  "no blob lists the same school as best and worst",
  async () => {
    const [r] = await allRows<{ blobs: number; overlapping: number }>(
      `SELECT count(*)::int AS blobs,
            count(*) FILTER (WHERE ov > 0)::int AS overlapping
     FROM (
       SELECT (SELECT count(*)
                 FROM jsonb_array_elements(payload -> 'top') t
                 JOIN jsonb_array_elements(payload -> 'bottom') b
                   ON t ->> 'id' = b ->> 'id') AS ov
       FROM school_payloads WHERE kind = 'place'
     ) x`,
    );
    assert.ok(r.blobs > 0, "no place blobs");
    assert.equal(
      r.overlapping,
      0,
      `${r.overlapping}/${r.blobs} blobs name the same school in top and bottom`,
    );
  },
);

test.skipIf(skip)("every place blob has a current cohort", async () => {
  // "No blob ⇒ the tiles self-hide" is the contract; a blob that exists with an
  // empty headline would render 0,00 as the place's matura average instead.
  const [r] = await allRows<{ n: number; empty: number }>(
    `SELECT count(*)::int AS n,
            count(*) FILTER (
              WHERE (payload ->> 'schools')::int = 0
                 OR (payload ->> 'examinees')::int = 0
            )::int AS empty
     FROM school_payloads WHERE kind = 'place'`,
  );
  assert.ok(r.n > 0, "no place blobs");
  assert.equal(
    r.empty,
    0,
    `${r.empty}/${r.n} place blobs have no current cohort`,
  );
});

test.skipIf(skip)(
  "муni blobs and their region's по-общини rows agree",
  async () => {
    // The phase-2 drift surface: /governance/{obshtina} reads the muni blob
    // while /governance/region/:oblast shows that município in its table.
    const [r] = await allRows<{ compared: number; mismatches: number }>(
      `WITH rows AS (
         SELECT m ->> 'obshtina' AS ob,
                (m ->> 'avg')::numeric AS avg,
                (m ->> 'examinees')::int AS n,
                (m ->> 'schools')::int AS schools
         FROM school_payloads, jsonb_array_elements(payload -> 'byObshtina') AS m
         WHERE kind = 'place' AND payload ->> 'grain' = 'region'
       ),
       muni AS (
         SELECT key AS ob,
                (payload ->> 'avg')::numeric AS avg,
                (payload ->> 'examinees')::int AS n,
                (payload ->> 'schools')::int AS schools
         FROM school_payloads
         WHERE kind = 'place' AND payload ->> 'grain' = 'muni'
       )
       SELECT count(*)::int AS compared,
              count(*) FILTER (
                WHERE rows.ob IS NULL OR muni.ob IS NULL
                   OR rows.avg IS DISTINCT FROM muni.avg
                   OR rows.n IS DISTINCT FROM muni.n
                   OR rows.schools IS DISTINCT FROM muni.schools
              )::int AS mismatches
       FROM rows FULL JOIN muni USING (ob)`,
    );
    assert.ok(r.compared > 0, "no município rows to compare");
    assert.equal(
      r.mismatches,
      0,
      `${r.mismatches}/${r.compared} municípios disagree between their own blob and their region's table`,
    );
  },
);

test.skipIf(skip)(
  "each region blob's series matches the directory's byOblastYear",
  async () => {
    // seriesOf() claims to mirror that rule; the region tile's trend and
    // /education's OblastTrendTable render from the two sources.
    const [r] = await allRows<{ compared: number; mismatches: number }>(
      `WITH dir AS (
         SELECT o ->> 'oblast' AS ob,
                (y ->> 'year')::int AS year,
                (y ->> 'avg')::numeric AS avg,
                (y ->> 'examinees')::int AS n,
                (y ->> 'schools')::int AS schools
         FROM school_payloads,
              jsonb_array_elements(payload -> 'byOblastYear') AS o,
              jsonb_array_elements(o -> 'years') AS y
         WHERE kind = 'directory' AND key = ''
       ),
       pl AS (
         SELECT key AS ob,
                (y ->> 'year')::int AS year,
                (y ->> 'avg')::numeric AS avg,
                (y ->> 'examinees')::int AS n,
                (y ->> 'schools')::int AS schools
         FROM school_payloads, jsonb_array_elements(payload -> 'series') AS y
         WHERE kind = 'place' AND payload ->> 'grain' = 'region'
       )
       SELECT count(*)::int AS compared,
              count(*) FILTER (
                WHERE dir.avg IS DISTINCT FROM pl.avg
                   OR dir.n IS DISTINCT FROM pl.n
                   OR dir.schools IS DISTINCT FROM pl.schools
              )::int AS mismatches
       FROM dir FULL JOIN pl USING (ob, year)`,
    );
    assert.ok(r.compared > 0, "no series points compared");
    assert.equal(
      r.mismatches,
      0,
      `${r.mismatches}/${r.compared} region series points disagree with byOblastYear`,
    );
  },
);

test.skipIf(skip)("rank follows the byOblast ordering", async () => {
  // `rank` is the "N-та от 28" the tile headlines, computed by its own sort.
  const [r] = await allRows<{
    regions: number;
    misranked: number;
    badOf: number;
    muniRanked: number;
  }>(
    `WITH expected AS (
       SELECT o ->> 'oblast' AS ob,
              row_number() OVER (
                ORDER BY (o ->> 'avg')::numeric DESC, o ->> 'oblast'
              )::int AS rank
       FROM school_payloads, jsonb_array_elements(payload -> 'byOblast') AS o
       WHERE kind = 'directory' AND key = ''
     ),
     pl AS (
       SELECT key AS ob,
              (payload ->> 'rank')::int AS rank,
              (payload ->> 'rankOf')::int AS "rankOf"
       FROM school_payloads
       WHERE kind = 'place' AND payload ->> 'grain' = 'region'
     )
     SELECT (SELECT count(*)::int FROM pl) AS regions,
            (SELECT count(*)::int FROM pl JOIN expected USING (ob)
              WHERE pl.rank IS DISTINCT FROM expected.rank) AS misranked,
            (SELECT count(*)::int FROM pl
              WHERE "rankOf" IS DISTINCT FROM (SELECT count(*) FROM pl)) AS "badOf",
            (SELECT count(*)::int FROM school_payloads
              WHERE kind = 'place' AND payload ->> 'grain' = 'muni'
                AND payload -> 'rank' <> 'null'::jsonb) AS "muniRanked"`,
  );
  assert.equal(r.regions, 28, `expected 28 region blobs, got ${r.regions}`);
  assert.equal(
    r.misranked,
    0,
    `${r.misranked} regions disagree with byOblast's order`,
  );
  assert.equal(r.badOf, 0, `${r.badOf} regions carry a wrong rankOf`);
  assert.equal(
    r.muniRanked,
    0,
    `${r.muniRanked} município blobs carry a rank — ranking a village against Пловдив`,
  );
});

test.skipIf(skip)("no place blob grows into a second directory", async () => {
  // P2 in the plan's performance contract, as a hard gate rather than a
  // measurement: the whole point of this kind is that a place dashboard fetches
  // a few KB. A list cap removed by accident is how it would stop being true.
  // octet_length, not length: these blobs are mostly Cyrillic, so `length`
  // counts characters and would let a 14 KB payload through a ceiling whose
  // message says 12 KB.
  const [r] = await allRows<{ n: number; max: number; over: number }>(
    `SELECT count(*)::int AS n,
            max(octet_length(payload::text))::int AS max,
            count(*) FILTER (WHERE octet_length(payload::text) > 12288)::int AS over
     FROM school_payloads WHERE kind = 'place'`,
  );
  assert.ok(r.n > 0, "no place blobs at all");
  assert.equal(
    r.over,
    0,
    `${r.over}/${r.n} place blobs exceed the 12 KB ceiling (largest ${r.max} B)`,
  );
});
