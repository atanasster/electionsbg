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
