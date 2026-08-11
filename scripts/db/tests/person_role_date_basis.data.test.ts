// person_role.date_basis (migration 081) — WHAT a role's start_date/end_date measure.
// Plan: docs/plans/person-enrichment-v1.md (T0).
//
// WHAT THESE PIN. The three sources that date a role measure three different events: a
// mandate ('term'), the election that produced it ('election'), and the day a declaration
// was filed with the Сметна палата ('filing', up to ~30 days after the fact). The renderer
// keys its phrasing off the basis, so an unlabelled date is not a cosmetic gap — it is the
// difference between "took office on X" and "filed a declaration on X".
//
// Every failure mode here is SILENT, which is why they are assertions and not comments:
//
//   - The column is written by resolve_persons.ts's copyRows list AND backfilled by 081.
//     The resolver DELETEs person_role and re-COPYs it, so dropping the column from that
//     list makes every basis NULL on the next resolve — and officeTermPhrase renders
//     nothing without a basis, so the whole feature disappears with nothing failing.
//   - person_by_slug's roles are consumed FIRST-ROW-WINS by the profile's office dedupe,
//     so an unordered jsonb_agg tie means the term shown for a multi-term seat can change
//     between two resolves of the same data.
//
// Auto-skips when Postgres is down or the person layer has never been resolved. The probe
// is TOP-LEVEL and feeds test.skipIf (docs/testing-standards.md): an early `return` inside
// a test body scores as a PASS, so CI (which runs without a container) would report this
// gate green while asserting nothing — the exact silent staleness it exists to catch.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";

const reachable = async (): Promise<boolean> => {
  try {
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM person_role WHERE date_basis IS NOT NULL",
    );
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb
  ? false
  : "Postgres unreachable / person_role has no date_basis (apply 081)";

afterAll(async () => {
  await end();
});

test.skipIf(skip)(
  "every dated role declares what its dates measure",
  async () => {
    const [r] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM person_role
      WHERE (start_date IS NOT NULL OR end_date IS NOT NULL) AND date_basis IS NULL`,
    );
    assert.equal(
      Number(r.n),
      0,
      `${r.n} role(s) carry a date with no basis. A date whose meaning is undeclared renders ` +
        `as nothing at best and as a start of office at worst. If a resolve just ran, check ` +
        `that date_basis is still in resolve_persons.ts's copyRows column list.`,
    );
  },
);

test.skipIf(skip)(
  "the mp basis survives a REBUILD, not merely 081's backfill",
  async () => {
    // The backfill patches a warm database; the resolver rebuilds one from scratch. This
    // number is only ever right when BOTH writers set the column.
    const [r] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM person_role WHERE source = 'mp' AND date_basis = 'term'`,
    );
    assert.ok(
      Number(r.n) > 1400,
      `only ${r.n} dated mp terms carry a basis (expected ~1,522) — a resolve that omits ` +
        `date_basis from its copyRows list leaves this at 0 with nothing else failing`,
    );
  },
);

test.skipIf(skip)(
  "every local role is dated from the election cycle in its own ref",
  async () => {
    // T1: the cycle is the ref's first segment, so coverage here is total by construction —
    // a shortfall means the derivation stopped running, not that a source went quiet.
    const [r] = await allRows<{ total: string; dated: string; basis: string }>(
      `SELECT count(*) total,
              count(start_date) dated,
              count(*) FILTER (WHERE date_basis = 'election') basis
         FROM person_role WHERE source = 'local'`,
    );
    assert.equal(
      r.dated,
      r.total,
      `${Number(r.total) - Number(r.dated)} local roles carry no start date`,
    );
    assert.equal(
      r.basis,
      r.dated,
      "a dated local role must declare basis 'election'",
    );
  },
);

test.skipIf(skip)("a by-election ends ONLY the seat it contested", async () => {
  // The rule that makes the end dates worth publishing. If a partial were treated as a
  // general election, every mandate outstanding on that date would end — so the count of
  // roles ending on a NON-general date would run to five figures instead of the few
  // hundred by-elections the corpus actually holds.
  // "General" is derived from the REF here — the cycle folder's `_mi` suffix — which is a
  // different route to the same fact than localTerms.ts's isRegularLocalCycle, so the two
  // can disagree. Deriving it from row COUNTS instead does not work: 2011 and 2015 are real
  // general elections this corpus only partly ingested (262 and 300 roles), so any
  // volume threshold mislabels them as by-elections.
  const [r] = await allRows<{ n: string; days: string; unobserved: string }>(
    `WITH cyc AS (
         SELECT start_date, end_date, split_part(ref, ':', 1) AS cycle
           FROM person_role WHERE source = 'local'
       ),
       general AS (
         SELECT DISTINCT start_date d FROM cyc
          WHERE cycle LIKE '%\\_mi' AND start_date IS NOT NULL
       ),
       observed AS (SELECT DISTINCT start_date d FROM cyc WHERE start_date IS NOT NULL)
       SELECT count(*) FILTER (WHERE end_date NOT IN (SELECT d FROM general)) n,
              count(DISTINCT end_date) FILTER (WHERE end_date NOT IN (SELECT d FROM general)) days,
              count(*) FILTER (WHERE end_date NOT IN (SELECT d FROM observed)) unobserved
         FROM cyc WHERE end_date IS NOT NULL`,
  );
  assert.equal(
    Number(r.unobserved),
    0,
    `${r.unobserved} mandates end on a date no local election in the corpus was held on — ` +
      `an end date must be an observed election, never an inferred one`,
  );
  assert.ok(
    Number(r.n) > 0,
    "no local mandate ends on a by-election date — the per-seat partial index is not being applied",
  );
  assert.ok(
    Number(r.n) < 2000,
    `${r.n} roles end on a by-election date across ${r.days} dates — a partial is ending ` +
      `mandates beyond its own seat (isRegularLocalCycle mis-classifying '*_chmi'?)`,
  );
});

test.skipIf(skip)(
  "an officials posting is dated from its own Entry/Vacate filings",
  async () => {
    // T2. These are the Сметна палата's own встъпителна / при напускане filings, joined on
    // subject_ref = the officials slug, so coverage is bounded by which postings ever filed
    // one — NOT total like the local roles. ~4,600 roles across ~4,400 people.
    const [r] = await allRows<{ roles: string; people: string }>(
      `SELECT count(*) roles, count(DISTINCT person_id) people
         FROM person_role WHERE date_basis = 'filing'`,
    );
    assert.ok(
      Number(r.roles) > 3000,
      `only ${r.roles} roles carry a filing date — the declaration join in ` +
        `resolve_persons.ts stopped matching (subject_ref vs the officials slug)`,
    );
    assert.ok(Number(r.people) > 3000, `only ${r.people} people`);
  },
);

test.skipIf(skip)(
  "no role is dated outside the register's plausible range",
  async () => {
    // The register carries at least one filed_at of 3023-02-13. A typo'd year that reached
    // person_role would sort to the top of every "most recent" ordering on the site.
    const [r] = await allRows<{ n: string; worst: string | null }>(
      `SELECT count(*) n, to_char(max(greatest(start_date, end_date)), 'YYYY-MM-DD') worst
         FROM person_role
        WHERE greatest(start_date, end_date) > now()::date + 1
           OR least(start_date, end_date) < DATE '1990-01-01'`,
    );
    assert.equal(
      Number(r.n),
      0,
      `${r.n} role(s) dated outside 1990..today (worst: ${r.worst})`,
    );
  },
);

test.skipIf(skip)("no role ends before it starts", async () => {
  // Applies to every basis. The filing arm is where this can actually happen: one slug can
  // be entered and vacated more than once, so max(Vacate) can precede min(Entry), and the
  // resolver drops the end rather than publishing a period that runs backwards.
  const rows = await allRows<{ date_basis: string; n: string }>(
    `SELECT date_basis, count(*) n FROM person_role
      WHERE end_date IS NOT NULL AND start_date IS NOT NULL AND end_date <= start_date
      GROUP BY date_basis`,
  );
  assert.deepEqual(rows, [], "role(s) end on or before they start");
});

test.skipIf(skip)(
  "no basis is used outside the declared vocabulary",
  async () => {
    const rows = await allRows<{ date_basis: string }>(
      `SELECT DISTINCT date_basis FROM person_role
      WHERE date_basis IS NOT NULL AND date_basis NOT IN ('term', 'election', 'filing')`,
    );
    assert.deepEqual(
      rows.map((r) => r.date_basis),
      [],
      "the UI has one phrase set per basis; an unknown one renders its raw i18n key",
    );
  },
);

test.skipIf(skip)(
  "person_by_slug emits start/end/dateBasis together, in a deterministic order",
  async () => {
    // Pick the person with the MOST dated roles for one source+place, i.e. the worst case
    // for the profile's (role, placeCode) dedupe. Derived rather than hard-coded: a slug
    // pinned here would rot at the next re-resolve.
    const [pick] = await allRows<{ slug: string }>(
      `SELECT p.slug
         FROM person p
         JOIN person_role r ON r.person_id = p.person_id
        WHERE r.source = 'mp' AND r.start_date IS NOT NULL
          AND (p.is_public_figure OR p.identity_confidence = 'verified')
          AND p.status = 'active'
        GROUP BY p.slug, r.place_code
        ORDER BY count(*) DESC
        LIMIT 1`,
    );
    assert.ok(pick, "no dated, servable mp person to sample");

    const [row] = await allRows<{
      roles: Array<{
        source: string;
        start: string | null;
        end: string | null;
        dateBasis: string | null;
      }>;
    }>(`SELECT person_by_slug($1) -> 'roles' AS roles`, [pick.slug]);

    const mp = row.roles.filter((r) => r.source === "mp");
    assert.ok(mp.length > 1, `${pick.slug} should hold several mp terms`);

    for (const r of mp)
      assert.ok(
        !r.start || r.dateBasis,
        `${pick.slug}: a term carries a start with no basis — the payload dropped the column`,
      );

    // The dedupe downstream keeps the FIRST row of a tied group, so ties must be broken in
    // SQL. Dated rows descend by start; that is what makes "the row the page shows" a
    // decision rather than a plan artefact.
    const dated = mp.filter((r) => r.start).map((r) => r.start!);
    assert.deepEqual(
      dated,
      [...dated].sort().reverse(),
      `${pick.slug}: mp terms are not ordered by start_date DESC — jsonb_agg returned a ` +
        `tie order, so which term the profile shows can change between resolves`,
    );
  },
);
