// The TYPED place on person_role (migration 115).
// Plan: docs/plans/person-role-place-consolidation-v1.md.
//
// WHAT THESE PIN. `place` used to be one untyped text column carrying five mutually
// incompatible namespaces, which is how raw obshtina codes ("BLG11") ended up rendered
// to users on /person and how a single council seat came to be listed twice. The
// replacement is a (kind, code, label) triple, and every failure mode of that triple is
// SILENT — a NULL kind just drops the badge, a missing label just renders blank, a
// stale Sofia synonym just re-splits the seat it was introduced to merge. So each
// invariant gets an assertion rather than a comment.
//
// Auto-skips when Postgres is down or the person layer has never been resolved — like
// the other *.data.test.ts gates. The probe is TOP-LEVEL and feeds test.skipIf
// (docs/testing-standards.md): an early `return` inside each test body would score as a
// PASS, so CI (which runs without a container) would report this whole gate green while
// asserting nothing — the exact silent-staleness failure this file exists to catch.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";

const reachable = async (): Promise<boolean> => {
  try {
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM person_role",
    );
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb ? false : "Postgres unreachable / person_role empty";

// Sources whose every role is expected to carry an obshtina place. Both resolve a
// municipality: `official_muni` from the Court-of-Audit roster, `local` from the
// local-election shards.
const OBSHTINA_SOURCES = ["official_muni", "local"];

afterAll(async () => {
  await end();
});

test.skipIf(skip)(
  "every municipal role carries a typed obshtina place",
  async () => {
    for (const source of OBSHTINA_SOURCES) {
      const [row] = await allRows<{ total: string; typed: string }>(
        `SELECT count(*) AS total,
              count(*) FILTER (
                WHERE place_kind = 'obshtina' AND place_code IS NOT NULL
              ) AS typed
         FROM person_role WHERE source = $1`,
        [source],
      );
      assert.equal(
        row.typed,
        row.total,
        `${Number(row.total) - Number(row.typed)} '${source}' role(s) have no typed obshtina place — db:resolve:persons ran against a roster without obshtina codes, or the fill regressed`,
      );
    }
  },
);

test.skipIf(skip)("place_kind is set exactly when place_code is", async () => {
  // Migration 115 enforces this with a CHECK; assert it anyway so a dropped or
  // NOT VALID constraint surfaces here rather than as half-filled rows downstream.
  const [row] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM person_role
      WHERE (place_kind IS NULL) <> (place_code IS NULL)`,
  );
  assert.equal(
    row.n,
    "0",
    `${row.n} role(s) carry a place kind without a code (or the reverse) — the person_role_place_pair CHECK is missing`,
  );
});

test.skipIf(skip)("every place_code resolves to both labels", async () => {
  const rows = await allRows<{ place_kind: string; place_code: string }>(
    `SELECT DISTINCT place_kind, place_code FROM person_role
      WHERE place_code IS NOT NULL
        AND (place_label IS NULL OR place_label_en IS NULL)
      LIMIT 20`,
  );
  assert.equal(
    rows.length,
    0,
    `place code(s) with no display label: ${rows
      .map((r) => `${r.place_kind}:${r.place_code}`)
      .join(
        ", ",
      )} — the label map is missing an entry, so the /person offices tile renders blank`,
  );
});

test.skipIf(skip)(
  "Sofia's city-wide bundle is canonicalised to one code",
  async () => {
    // `SFO_CITY` (officials roster) and `SOF` (local-election shards) are the same
    // Столична община. SFO_CITY is the survivor because it is the code the frontend
    // queries municipal_officials_table with; a surviving `SOF` means the
    // canonicalisation regressed and Sofia councillors list their seat twice again.
    const [row] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM person_role
      WHERE place_kind = 'obshtina' AND place_code = 'SOF'`,
    );
    assert.equal(
      row.n,
      "0",
      `${row.n} role(s) still carry the un-canonicalised Sofia code 'SOF' — canonicalObshtina() is not being applied`,
    );
    // And the canonical code must actually be present, or the mapping went the other way.
    const [have] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM person_role WHERE place_code = 'SFO_CITY'`,
    );
    assert.ok(
      Number(have.n) > 0,
      "no role carries 'SFO_CITY' — Sofia's city-wide roster lost its obshtina code, which unservables the municipal roster for the capital",
    );
  },
);

test.skipIf(skip)(
  "sources whose place was never a place carry no typed place",
  async () => {
    // ds / sanctions / regulator used the old `place` column for a decision context, an
    // OFAC programme and a body name respectively — none of them a place. All three
    // already carry that value in source_row, which is what the UI renders.
    const rows = await allRows<{ source: string; n: string }>(
      `SELECT source, count(*) n FROM person_role
      WHERE source IN ('ds', 'sanctions', 'regulator') AND place_kind IS NOT NULL
      GROUP BY 1`,
    );
    assert.equal(
      rows.length,
      0,
      `non-place source(s) gained a typed place: ${rows
        .map((r) => `${r.source} (${r.n})`)
        .join(", ")}`,
    );
  },
);

// The typed-place spread sits on the GENERIC official_roster loop, so any roster row with
// an obshtina gains a typed place regardless of which person_source it resolves to. Today
// only `official_muni` carries codes. But `public_sector` (school / kindergarten /
// social-care directors) obviously DO sit in a municipality, and the day
// municipality_join.ts learns to code them, thousands of rows would silently acquire typed
// places that OBSHTINA_SOURCES does not assert over and that T4's (role, place_code)
// dedupe would start keying on. This makes that widening loud instead of silent.
test.skipIf(skip)(
  "no roster source outside OBSHTINA_SOURCES has quietly gained typed places",
  async () => {
    const rows = await allRows<{ source: string; n: string }>(
      `SELECT source, count(*) n FROM person_role
        WHERE place_kind = 'obshtina' AND source <> ALL($1::text[])
        GROUP BY 1 ORDER BY 1`,
      [OBSHTINA_SOURCES],
    );
    assert.equal(
      rows.length,
      0,
      `source(s) gained an obshtina place without being reconsidered: ${rows
        .map((r) => `${r.source} (${r.n})`)
        .join(
          ", ",
        )}. Add them to OBSHTINA_SOURCES once T4's dedupe has been checked against them.`,
    );
  },
);
