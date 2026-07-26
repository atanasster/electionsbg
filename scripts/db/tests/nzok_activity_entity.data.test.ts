// Tier 3 (Postgres-native) — the НЗОК clinical-activity corpus is keyed on the
// resolved ENTITY, never on the facility name.
//
// WHY THIS EXISTS. НЗОК renames facilities MID-YEAR: it is migrating this feed
// from mixed-case trade names to ALL-CAPS full legal names, and in 2025 the
// cutover fell between м.06 and м.07 ("МБАЛ Айтос ЕООД" → "МНОГОПРОФИЛНА
// БОЛНИЦА ЗА АКТИВНО ЛЕЧЕНИЕ-АЙТОС ЕООД"). The writer sums 12 monthly files into
// one annual matrix and can only key that on the NAME, so before the entity
// re-key a renamed hospital shipped as TWO rows per procedure with its cases
// SPLIT and its bed count attached in FULL to each half — halving its
// cases-per-bed ratio and double-counting it in every peer median. 463 names
// stood for 376–403 real facilities.
//
// These assertions are data-version-independent: they hold for any year НЗОК
// publishes, including one with no renames at all.
//
//   npm run test:data
//
// Requires the Postgres store (`npm run db:pg:up` + `db:load:nzok-activities:pg`);
// auto-skips when Postgres is unreachable or the table is absent, exactly like
// invariants_pg.data.test.ts.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";

// Mirrors ENTITY_CHURN_CEILING in ../load_nzok_activities_pg.ts — the loader
// throws above it; this locks the loaded corpus to the same bound so a hand-run
// or an older load can't leave a split corpus in place unnoticed.
const ENTITY_CHURN_CEILING = 1.1;

const reachable = async (): Promise<boolean> => {
  try {
    await allRows("SELECT 1");
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.nzok_activities') IS NOT NULL AS ok",
    );
    if (!t?.ok) return false;
    const [n] = await allRows<{ n: number }>(
      "SELECT count(*)::int AS n FROM nzok_activities",
    );
    return (n?.n ?? 0) > 0;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb ? false : "Postgres unreachable / nzok_activities empty";

afterAll(async () => {
  await end();
});

test.skipIf(skip)("one row per (period, entity, procedure)", async () => {
  const dups = await allRows<{ entity_key: string; procedure: string }>(
    `SELECT entity_key, procedure FROM nzok_activities
     GROUP BY period, entity_key, procedure HAVING count(*) > 1 LIMIT 5`,
  );
  assert.equal(
    dups.length,
    0,
    `an entity is split across rows again: ${JSON.stringify(dups)}`,
  );
});

test.skipIf(skip)(
  "entity_key is eik when known, fold-scoped when not",
  async () => {
    const [bad] = await allRows<{ n: number }>(
      `SELECT count(*)::int AS n FROM nzok_activities
     WHERE entity_key <> coalesce(eik, 'f:' || facility_fold)`,
    );
    assert.equal(bad.n, 0, "entity_key drifted from its definition");
  },
);

test.skipIf(skip)(
  "no eik carries two entities (the rename split)",
  async () => {
    // The split's signature: one EIK appearing under several entity keys, i.e. the
    // crosswalk matched a hospital's two names but they were never merged.
    const split = await allRows<{ eik: string; n: number }>(
      `SELECT eik, count(DISTINCT entity_key)::int AS n FROM nzok_activities
     WHERE eik IS NOT NULL GROUP BY eik HAVING count(DISTINCT entity_key) > 1 LIMIT 5`,
    );
    assert.equal(
      split.length,
      0,
      `eik split across entities: ${JSON.stringify(split)}`,
    );
  },
);

test.skipIf(skip)("beds are attached once per entity", async () => {
  // A renamed hospital used to carry its FULL bed count on each half. One bed
  // value per entity is what makes cases-per-bed comparable at all.
  const many = await allRows<{ entity_key: string; n: number }>(
    `SELECT entity_key, count(DISTINCT beds)::int AS n FROM nzok_activities
     WHERE beds IS NOT NULL GROUP BY entity_key HAVING count(DISTINCT beds) > 1 LIMIT 5`,
  );
  assert.equal(
    many.length,
    0,
    `entity carries more than one bed count: ${JSON.stringify(many)}`,
  );
});

test.skipIf(skip)("entity churn stays under the ceiling", async () => {
  // The annual entity roster should barely exceed the busiest single period's:
  // the only legitimate excess is genuine openings and closures. A jump means
  // НЗОК renamed a batch and the crosswalk did not re-unite them.
  const [c] = await allRows<{ annual: number; max_period: number }>(
    `SELECT
       (SELECT count(DISTINCT entity_key)::int
          FROM nzok_activity_facility_periods) AS annual,
       (SELECT max(n)::int FROM (
          SELECT count(DISTINCT entity_key) AS n
            FROM nzok_activity_facility_periods GROUP BY period) p) AS max_period`,
  );
  const churn = c.annual / c.max_period;
  assert.ok(
    churn <= ENTITY_CHURN_CEILING,
    `entity churn ${churn.toFixed(3)} > ${ENTITY_CHURN_CEILING} ` +
      `(${c.annual} annual entities vs ${c.max_period} in the busiest period) — ` +
      `renamed facilities are split; curate scripts/db/lib/nzok_activity_eik.ts`,
  );
});

test.skipIf(skip)(
  "the per-period roster reconciles with the annual matrix",
  async () => {
    // Same cases, counted two ways. The roster is what the coverage block and the
    // churn assert read, so it must not drift from the matrix it describes.
    const [r] = await allRows<{ matrix: string; roster: string }>(
      `SELECT (SELECT sum(cases)::bigint FROM nzok_activities)               AS matrix,
            (SELECT sum(cases)::bigint FROM nzok_activity_facility_periods) AS roster`,
    );
    assert.equal(
      Number(r.matrix),
      Number(r.roster),
      "annual matrix and per-period roster disagree on total cases",
    );
  },
);

test.skipIf(skip)(
  "overview publishes unmapped coverage rather than dropping it",
  async () => {
    const [o] = await allRows<{
      unmapped_cases: number;
      pct: number;
      periods: number;
      entities: number;
      distinct_facilities: number;
    }>(
      `SELECT (nzok_activities_overview() -> 'coverage' ->> 'unmappedCases')::bigint AS unmapped_cases,
            (nzok_activities_overview() -> 'coverage' ->> 'unmappedCasesPct')::numeric AS pct,
            jsonb_array_length(nzok_activities_overview() -> 'coverage' -> 'byPeriod') AS periods,
            (nzok_activities_overview() -> 'coverage' ->> 'unmappedEntities')::int AS entities,
            (nzok_activities_overview() ->> 'distinctFacilities')::int AS distinct_facilities`,
    );
    assert.ok(o.periods > 0, "coverage.byPeriod is empty");
    assert.ok(
      Number(o.pct) >= 0 && Number(o.pct) <= 100,
      `nonsensical unmapped share ${o.pct}%`,
    );
    // distinctFacilities must be an ENTITY count — never the name count, which is
    // what over-stated it by ~15% before the re-key.
    const [e] = await allRows<{ n: number }>(
      `SELECT count(DISTINCT entity_key)::int AS n FROM nzok_activities
     WHERE period = (SELECT max(period) FROM nzok_activities)`,
    );
    assert.equal(o.distinct_facilities, e.n);
  },
);

test.skipIf(skip)(
  "hospital type ignores which name form НЗОК used",
  async () => {
    // The peer test groups by hospital type (rule 2 in 053), and the ALL-CAPS
    // migration spells the type acronym out — so a classifier that only knows
    // "МБАЛ" drops every renamed hospital into 'ДРУГИ' and measures it against the
    // wrong peers. Both forms must land in the same bucket.
    const [t] = await allRows<{
      umbal: string;
      mbal: string;
      sbal: string;
      sbr: string;
    }>(
      `SELECT nzok_hospital_type('УНИВЕРСИТЕТСКА МНОГОПРОФИЛНА БОЛНИЦА ЗА АКТИВНО ЛЕЧЕНИЕ БУРГАС АД') AS umbal,
            nzok_hospital_type('МНОГОПРОФИЛНА БОЛНИЦА ЗА АКТИВНО ЛЕЧЕНИЕ АЙТОС ЕООД')               AS mbal,
            nzok_hospital_type('СПЕЦИАЛИЗИРАНА БОЛНИЦА ЗА АКТИВНО ЛЕЧЕНИЕ ПО ОНКОЛОГИЯ ХАСКОВО ЕООД') AS sbal,
            nzok_hospital_type('СПЕЦИАЛИЗИРАНА БОЛНИЦА ЗА РЕХАБИЛИТАЦИЯ НЕСЕБЪР АД')                AS sbr`,
    );
    assert.equal(t.umbal, "УМБАЛ");
    assert.equal(t.mbal, "МБАЛ");
    assert.equal(t.sbal, "СБАЛ");
    assert.equal(t.sbr, "СБР");
  },
);
