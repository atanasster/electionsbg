// Gates for migration 139 — the per-capita municipal EU-money ranking with the
// Interreg arm counted.
//
// The property that matters most here is NOT that the combined number is
// bigger. It is that the ИСУН arm is unchanged: this view reads the served
// `muni-summary` payload rather than re-deriving `muniShare`'s even split, so
// the ИСУН-only rank it computes must reproduce, exactly, the rank the offline
// TypeScript pipeline already published. If it ever stops doing that, the two
// definitions have drifted and every "+43 places" claim on the site is measuring
// a change in the DEFINITION rather than a change in the data.

import { test } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";

const haveDb = await dbReachable();
const skip = !haveDb ? "Postgres unreachable" : false;

const one = async <T>(sql: string, params?: unknown[]): Promise<T> => {
  const rows = await allRows<T>(sql, params);
  assert.ok(rows.length === 1, `expected one row, got ${rows.length}`);
  return rows[0];
};

// ── 1. The ИСУН arm reproduces the offline pipeline, exactly ────────────────
test.skipIf(skip)("the ИСУН-only rank equals the published one", async () => {
  // 256 of 256 on 2026-08-07. Not "close" — equal. The view's oblast partition
  // and the payload's oblast cohort are the same cohort, computed twice from
  // the same numbers, and a single disagreement means they are not.
  const r = await one<{
    checked: string;
    rank_agree: string;
    size_agree: string;
  }>(
    `SELECT count(*) checked,
            count(*) FILTER (WHERE v.oblast_rank_before = (f.payload->>'perCapitaRank')::int) rank_agree,
            count(*) FILTER (WHERE v.oblast_cohort_size = (f.payload->>'cohortSize')::int) size_agree
       FROM funds_muni_combined_v v
       JOIN fund_payloads f ON f.kind = 'muni-summary' AND f.key = v.obshtina`,
  );
  assert.ok(Number(r.checked) > 200, `only ${r.checked} municipalities ranked`);
  assert.equal(
    r.rank_agree,
    r.checked,
    "the view's ИСУН-only oblast rank disagrees with the published perCapitaRank",
  );
  assert.equal(r.size_agree, r.checked, "oblast cohort sizes disagree");
});

// ── 2. The two arms are never conflated ────────────────────────────────────
test.skipIf(skip)("isunEur + interregEur is exactly totalEur", async () => {
  // The payload carries all three. A surface may render any of them; what it
  // may not do is find that they disagree.
  const bad = await allRows<{ obshtina: string }>(
    `SELECT obshtina FROM funds_muni_combined_v
      WHERE abs((isun_eur + interreg_eur) - total_eur) > 0.01
         OR abs(total_eur / population - per_capita_eur) > 0.000001
         OR abs(isun_eur / population - per_capita_eur_isun) > 0.000001`,
  );
  assert.deepEqual(bad, [], "an arm does not reconcile with the total");
});

// ── 3. The Interreg arm is the SAME money the fact tables hold ─────────────
test.skipIf(skip)(
  "the ranked Interreg euros come from interreg_partners",
  async () => {
    // Recomputed independently of the view, including its country predicate — a
    // view that quietly dropped the Bulgaria scope would inherit exactly the
    // foreign-national-id defect interreg_by_eik shipped with.
    const rows = await allRows<{
      obshtina: string;
      view_eur: string;
      raw_eur: string;
    }>(
      `SELECT v.obshtina, v.interreg_eur view_eur, x.eur raw_eur
       FROM funds_muni_combined_v v
       JOIN (SELECT p.obshtina, SUM(p.budget_eur) eur
               FROM interreg_partners p
              WHERE p.obshtina IS NOT NULL
                AND (p.country = 'Bulgaria' OR p.country_department = 'Bulgaria')
              GROUP BY 1) x ON x.obshtina = v.obshtina
      WHERE abs(v.interreg_eur - x.eur) > 0.01`,
    );
    assert.deepEqual(
      rows,
      [],
      "the view's Interreg arm is not the fact-table sum",
    );
  },
);

// ── 4. Both ranks are dense-from-1 and mutually distinct ──────────────────
test.skipIf(skip)("the national and oblast ranks are well-formed", async () => {
  const r = await one<{
    n: string;
    min_rank: number;
    max_rank: number;
    same: string;
  }>(
    `SELECT count(*) n, min(rank) min_rank, max(rank) max_rank,
            count(*) FILTER (WHERE rank = oblast_rank) same
       FROM funds_muni_combined_v`,
  );
  assert.equal(r.min_rank, 1, "the national ranking does not start at 1");
  assert.ok(
    r.max_rank <= Number(r.n),
    `max national rank ${r.max_rank} exceeds the cohort ${r.n}`,
  );
  // They coincide only by accident on a handful of #1s. If EVERY row matched,
  // the oblast partition has been lost and the tile is rendering a national
  // rank under a "в областта" label.
  assert.ok(
    Number(r.same) < Number(r.n) / 2,
    `national and oblast ranks agree on ${r.same}/${r.n} rows — the partition is gone`,
  );
  const perOblast = await allRows<{ oblast_code: string }>(
    `SELECT oblast_code FROM funds_muni_combined_v
      GROUP BY oblast_code HAVING min(oblast_rank) <> 1`,
  );
  assert.deepEqual(perOblast, [], "an oblast cohort does not start at rank 1");
});

// ── 5. The movement is real, and only one direction is guaranteed ─────────
test.skipIf(skip)(
  "the movement is real, and only one direction is guaranteed",
  async () => {
    // ONE direction is guaranteed and the other is not, which is worth stating
    // because the tempting stronger claim is false. A municipality with NO
    // Interreg money keeps its per-capita figure exactly while every other
    // municipality's can only rise, so its rank can never IMPROVE — that is the
    // invariant, and a violation means the two ranks were computed over different
    // cohorts, which would make every "+43 places" figure on the site meaningless.
    //
    // The mirror claim — that a municipality WITH Interreg money can never lose a
    // place — does not hold, and asserting it fails against live data: Варна
    // (VAR16) gained €352k and still slipped one place, because a rival gained
    // more per resident. Ranks are relative; gaining money is not the same as
    // gaining ground.
    const bad = await allRows<{ obshtina: string; d: number; ir: string }>(
      `SELECT obshtina, (rank_before - rank) d, interreg_eur::text ir
       FROM funds_muni_combined_v
      WHERE interreg_eur = 0 AND rank < rank_before`,
    );
    assert.deepEqual(
      bad,
      [],
      "a municipality with no Interreg money improved its rank",
    );

    // The per-capita figure itself IS monotone, unlike the rank — that is the
    // quantity with no relative component, so it can be asserted outright.
    const moneyBad = await allRows<{ obshtina: string }>(
      `SELECT obshtina FROM funds_muni_combined_v
      WHERE per_capita_eur < per_capita_eur_isun - 0.000001
         OR (interreg_eur = 0 AND abs(per_capita_eur - per_capita_eur_isun) > 0.000001)`,
    );
    assert.deepEqual(
      moneyBad,
      [],
      "counting Interreg lowered a per-capita figure",
    );

    const r = await one<{ moved: string; gained: string }>(
      `SELECT count(*) FILTER (WHERE rank <> rank_before) moved,
            count(*) FILTER (WHERE interreg_eur > 0) gained
       FROM funds_muni_combined_v`,
    );
    // 213 / 134 on 2026-08-07. The floor is deliberately far below that: this
    // asserts the arm is CONNECTED, not that the corpus has not grown.
    assert.ok(
      Number(r.gained) > 50,
      `only ${r.gained} municipalities carry Interreg money — is the arm joined?`,
    );
    assert.ok(Number(r.moved) > 50, `only ${r.moved} municipalities moved`);
  },
);

// ── 6. What the ranking excludes is reported, not dropped ─────────────────
test.skipIf(skip)(
  "every Bulgarian partner euro is in exactly one bucket",
  async () => {
    // €88.7m of Столична община's money sits outside the cohort on BOTH arms
    // (ГРАО carries no Sofia city EKATTE), and 24 rows are honestly unplaced.
    // That is 23.8% of the corpus, so a payload that silently omitted it would
    // let a caption claim national coverage it does not have.
    const payload = await one<{
      r: {
        excluded: Record<string, { rows: number; eur: number }>;
        cohortSize: number;
      };
    }>(`SELECT funds_muni_combined_rank(1) AS r`);
    const buckets = payload.r.excluded;
    assert.ok(buckets.ranked, "no 'ranked' bucket");
    assert.ok(
      buckets.outsideCohort,
      "no 'outsideCohort' bucket — Sofia is silent",
    );

    const total = await one<{ rows: string; eur: string }>(
      `SELECT count(*) rows, COALESCE(SUM(budget_eur), 0) eur
       FROM interreg_partners
      WHERE country = 'Bulgaria' OR country_department = 'Bulgaria'`,
    );
    const sumRows = Object.values(buckets).reduce((a, b) => a + b.rows, 0);
    const sumEur = Object.values(buckets).reduce((a, b) => a + b.eur, 0);
    assert.equal(sumRows, Number(total.rows), "the buckets lose partner rows");
    assert.ok(
      Math.abs(sumEur - Number(total.eur)) < 0.01,
      `the buckets lose money: €${sumEur} vs €${total.eur}`,
    );
  },
);

// ── 7. A place outside the cohort is NULL, not zero ───────────────────────
test.skipIf(skip)(
  "an unranked municipality answers NULL, never €0",
  async () => {
    // Столична община is the live case: it has €88.7m of Interreg money and no
    // per-capita rank on either arm. A zero-filled payload would read as "Sofia
    // received nothing", which is the opposite of true.
    const r = await one<{
      sofia: boolean;
      unknown: boolean;
      sofia_eur: string;
    }>(
      `SELECT funds_muni_combined('SFO_CITY') IS NULL sofia,
            funds_muni_combined('ZZZ99') IS NULL unknown,
            (SELECT COALESCE(SUM(budget_eur), 0)::text FROM interreg_partners
              WHERE obshtina = 'SFO_CITY') sofia_eur`,
    );
    assert.equal(r.unknown, true, "an unknown obshtina should answer NULL");
    assert.equal(
      r.sofia,
      true,
      `Столична община answers a payload while holding €${r.sofia_eur} — ` +
        "a zero-shaped answer there reads as 'received nothing'",
    );
    assert.ok(Number(r.sofia_eur) > 0, "Sofia should hold Interreg money");
  },
);

// ── 8. Serving latency ────────────────────────────────────────────────────
test.skipIf(skip)("the leaderboard answers fast", async () => {
  const t0 = Date.now();
  await allRows(`SELECT funds_muni_combined_rank(300)`);
  const ms = Date.now() - t0;
  // 23 ms locally at the full cohort. Cloud SQL is a db-g1-small, so the ceiling
  // is generous — what it forbids is the view silently becoming a scan over
  // fund_projects instead of the 273-row payload table.
  assert.ok(ms < 2000, `funds_muni_combined_rank(300) took ${ms} ms`);
});

// ── 9. The two corpora speak the same obshtina vocabulary ────────────────
test.skipIf(skip)(
  "every placed Interreg obshtina is a muni-summary key",
  async () => {
    // This is the gate for the failure that hid behind the cohort gap. The two
    // corpora call Sofia city different things — interreg_partners says SFO_CITY,
    // fund_payloads keys it S22 — so `USING (obshtina)` could never have matched
    // it EVEN IF ГРАО published the Sofia city EKATTE and it entered the cohort.
    // Two independent reasons for one exclusion, each hiding the other, with every
    // row count reconciling. The view normalises; this fails on any other code
    // that drifts apart.
    const NORMALISED: Record<string, string> = { SFO_CITY: "S22" };
    const codes = await allRows<{
      obshtina: string;
      rows: string;
      eur: string;
    }>(
      `SELECT p.obshtina, count(*) rows, COALESCE(SUM(p.budget_eur), 0)::text eur
       FROM interreg_partners p
      WHERE p.obshtina IS NOT NULL
        AND (p.country = 'Bulgaria' OR p.country_department = 'Bulgaria')
      GROUP BY 1`,
    );
    const keys = new Set(
      (
        await allRows<{ key: string }>(
          `SELECT key FROM fund_payloads WHERE kind = 'muni-summary'`,
        )
      ).map((r) => r.key),
    );
    assert.ok(keys.size > 200, `only ${keys.size} muni-summary keys`);
    const orphans = codes.filter(
      (c) => !keys.has(NORMALISED[c.obshtina] ?? c.obshtina),
    );
    assert.deepEqual(
      orphans.map((o) => `${o.obshtina} (${o.rows} rows, €${o.eur})`),
      [],
      "Interreg money keyed to an obshtina the funds corpus does not know",
    );
  },
);

// ── 10. The route can ask for every municipality that has an answer ───────
test.skipIf(skip)("the route regex admits every muni-summary key", async () => {
  // fund_payloads' key vocabulary is NOT place_dim's: it carries S22, the Sofia
  // city rollup MyAreaProjectsMapTile sends for all ~25 rayon dashboards. The
  // route's first draft copied the interreg-place regex, which has no S##
  // alternative, so every Sofia page 400'd — four times each, since the hook
  // throws on !ok and React Query retries — while rendering an identical number.
  const ROUTE_RE = /^([A-Z]{3}\d{2}|S\d{2,4}|SFO_CITY)$/;
  const keys = await allRows<{ key: string }>(
    `SELECT key FROM fund_payloads WHERE kind = 'muni-summary'`,
  );
  assert.ok(keys.length > 200, `only ${keys.length} keys`);
  assert.deepEqual(
    keys.map((k) => k.key).filter((k) => !ROUTE_RE.test(k)),
    [],
    "the route would 400 a municipality that has a payload",
  );
});

// ── 11. Every migration the loader applies role-guards its GRANTs ─────────
test.skipIf(skip)(
  "no SCHEMA_FILES migration can 42704 a cold database",
  async () => {
    // roles_readonly.sql is a one-time MANUAL step, and exec() sends a migration
    // as one implicit transaction — so a bare GRANT on a database without the role
    // raises 42704, rolls the WHOLE file back, and aborts the loader before a
    // single row is written. Harmless until a file joins SCHEMA_FILES, which is
    // what 138 and 139 just did. Reads the loader's own list so a file added later
    // is covered without touching this test.
    const fs = await import("fs");
    const path = await import("path");
    const url = await import("url");
    const dir = path.dirname(url.fileURLToPath(import.meta.url));
    const loader = fs.readFileSync(
      path.join(dir, "../load_interreg_pg.ts"),
      "utf8",
    );
    const block = /const SCHEMA_FILES = \[([\s\S]*?)\];/.exec(loader);
    assert.ok(block, "could not find SCHEMA_FILES in load_interreg_pg.ts");
    const files = [...block[1].matchAll(/"([^"]+\.sql)"/g)].map((m) => m[1]);
    assert.ok(files.length >= 3, `only ${files.length} schema files parsed`);

    for (const f of files) {
      const sql = fs.readFileSync(path.join(dir, "../schema/pg", f), "utf8");
      // The repo has two guarded idioms and they look different: 137 puts an
      // INDENTED `GRANT` inside `DO $$ … IF EXISTS (SELECT 1 FROM pg_roles …)`,
      // while 138/139 `EXECUTE` the statement from inside one. Both are safe. The
      // unguarded form is a GRANT in column 0 — top level, outside any block — so
      // that, not a trimmed match, is what this looks for. Trimming first reports
      // 137's guarded grants as bare, which is how this test failed on its first
      // run: a detector that cannot see the guard cannot verify it.
      const bare = sql
        .split("\n")
        .filter((l) => /^GRANT\b/.test(l) && /app_readonly/.test(l));
      assert.deepEqual(
        bare,
        [],
        `${f} GRANTs to app_readonly at top level — it will 42704 and roll back ` +
          "the whole file on a database that never ran roles_readonly.sql",
      );
      // And a file that grants at all must actually carry the probe, so wrapping
      // a GRANT in a DO block without one cannot pass by indentation alone.
      if (/app_readonly/.test(sql))
        assert.match(
          sql,
          /pg_roles\s+WHERE\s+rolname\s*=\s*'app_readonly'/,
          `${f} mentions app_readonly but never probes pg_roles`,
        );
    }
  },
);

// ── 12. interreg_overview re-derived from the facts ──────────────────────
test.skipIf(skip)(
  "the /funds overview totals come from interreg_partners",
  async () => {
    const got = await one<{
      r: {
        budgetEur: number;
        partnerCount: number;
        operationCount: number;
        programmeCount: number;
        placedCount: number;
        periods: Record<string, { budgetEur: number; linkedCount: number }>;
        programmes: { code: string; budgetEur: number }[];
      };
    }>(`SELECT interreg_overview(40) AS r`);
    const o = got.r;

    const raw = await one<{
      eur: string;
      n: string;
      ops: string;
      progs: string;
      placed: string;
    }>(
      `SELECT COALESCE(SUM(p.budget_eur), 0)::text eur, count(*) n,
            count(DISTINCT p.keep_id) ops,
            count(DISTINCT o.programme_code) progs,
            count(*) FILTER (WHERE p.ekatte IS NOT NULL) placed
       FROM interreg_partners p JOIN interreg_operations o USING (keep_id)
      WHERE p.country = 'Bulgaria' OR p.country_department = 'Bulgaria'`,
    );
    assert.ok(Math.abs(o.budgetEur - Number(raw.eur)) < 0.01, "budget drifts");
    assert.equal(o.partnerCount, Number(raw.n));
    assert.equal(o.operationCount, Number(raw.ops));
    assert.equal(o.programmeCount, Number(raw.progs));
    assert.equal(o.placedCount, Number(raw.placed));

    // The programmes list INNER JOINs interreg_programmes, so a code with no
    // catalogue row would vanish from it while still counting in programmeCount —
    // the tile would then print "largest 6 of 19" over a list that can never
    // reach 19. At limit 40 (above the 19 that exist) the two must agree.
    assert.equal(
      o.programmes.length,
      o.programmeCount,
      "a programme_code has no interreg_programmes row and dropped out of the list",
    );

    // The period asymmetry, asserted so a source change that starts supplying
    // 2014-2020 national ids is NOTICED rather than silently absorbed — every
    // "Tier L only" caption on the site is calibrated on this being zero.
    assert.equal(
      o.periods["2014-2020"]?.linkedCount,
      0,
      "keep.eu is now publishing 2014-2020 national ids — the Tier L/P split moved",
    );
    assert.ok(
      (o.periods["2021-2027"]?.linkedCount ?? 0) > 250,
      "the 2021-2027 EIK link collapsed",
    );
  },
);

// ── 13. The exclusion the /funds caption prints ──────────────────────────
test.skipIf(skip)(
  "both exclusion figures are present and the larger one is ИСУН",
  async () => {
    // The caption names BOTH sources. Printing only the Interreg exclusion beside
    // that sentence tells a reader €95.4m is missing from a ranking that is
    // missing €6.56bn — Столична община alone holds €5.52bn of ИСУН projects and
    // has no per-capita figure on either arm. So the payload carries both, and
    // this fails if the ИСУН side ever stops travelling.
    const got = await one<{
      r: {
        excluded: Record<string, { rows: number; eur: number }>;
        excludedIsunEur: number;
      };
    }>(`SELECT funds_muni_combined_rank(1) AS r`);
    const interregExcluded = Object.entries(got.r.excluded)
      .filter(([reason]) => reason !== "ranked")
      .reduce((a, [, v]) => a + v.eur, 0);

    assert.ok(interregExcluded > 0, "no Interreg money outside the cohort?");
    assert.ok(
      got.r.excludedIsunEur > interregExcluded,
      `excludedIsunEur (€${got.r.excludedIsunEur}) should dwarf the Interreg ` +
        `exclusion (€${interregExcluded}) — if it does not, the cohort changed`,
    );

    const raw = await one<{ eur: string }>(
      `SELECT COALESCE(SUM((f.payload->'rollup'->>'totalEur')::double precision), 0)::text eur
       FROM fund_payloads f
      WHERE f.kind = 'muni-summary'
        AND f.key NOT IN (SELECT obshtina FROM funds_muni_combined_v)`,
    );
    assert.ok(
      Math.abs(got.r.excludedIsunEur - Number(raw.eur)) < 0.01,
      "excludedIsunEur is not the ИСУН money outside the cohort",
    );
  },
);

test.skipIf(skip)("close the pool", async () => {
  await end();
});
