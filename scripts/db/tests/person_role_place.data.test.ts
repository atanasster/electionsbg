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
import { MIR_CODES } from "../../../src/data/parliament/nsFolders";

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

test.skipIf(skip)("every place_code resolves to a display label", async () => {
  const rows = await allRows<{ place_kind: string; place_code: string }>(
    `SELECT DISTINCT place_kind, place_code FROM person_role
      WHERE place_code IS NOT NULL AND place_label IS NULL
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

test.skipIf(skip)("place kinds with an English name carry one", async () => {
  // `judicial` is deliberately Bulgarian-only: there is no official English register of
  // Bulgarian courts and prosecution offices to translate against, and an invented
  // translation on a named magistrate's profile is worse than the Bulgarian name. Every
  // OTHER kind draws its label from a source that carries name_en, so a NULL there is a
  // gap rather than a decision.
  const rows = await allRows<{ place_kind: string; place_code: string }>(
    `SELECT DISTINCT place_kind, place_code FROM person_role
      WHERE place_code IS NOT NULL
        AND place_kind <> 'judicial'
        AND place_label_en IS NULL
      LIMIT 20`,
  );
  assert.equal(
    rows.length,
    0,
    `place code(s) with no English label: ${rows
      .map((r) => `${r.place_kind}:${r.place_code}`)
      .join(", ")}`,
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

test.skipIf(skip)(
  "every MP carries the МИР they were seated from",
  async () => {
    // parliament.bg carries a seat on every profile it holds, so anything short of 100%
    // means index.json was rebuilt without `seatedRegion` (T3a) or the crosswalk lost an
    // entry. The old `currentRegion` path covered only the 240 sitting MPs.
    const [row] = await allRows<{ total: string; coded: string }>(
      `SELECT count(*) AS total,
            count(*) FILTER (WHERE place_kind = 'mir' AND place_code IS NOT NULL) AS coded
       FROM person_role WHERE source = 'mp'`,
    );
    // Floor first: `0 === 0` would otherwise pass on an empty table, which is exactly
    // the silent green this file's header argues against.
    assert.ok(
      Number(row.total) > 2000,
      `only ${row.total} mp role(s) — the roster did not load`,
    );
    assert.equal(
      row.coded,
      row.total,
      `${Number(row.total) - Number(row.coded)} mp role(s) have no seated МИР`,
    );
  },
);

test.skipIf(skip)("every МИР place_code is one of the 31", async () => {
  // A code outside the constituency set means the crosswalk or the shard data drifted —
  // e.g. a statistical oblast (28 of them) leaking in where a МИР (31) belongs.
  const rows = await allRows<{ place_code: string; n: string }>(
    `SELECT place_code, count(*) n FROM person_role
      WHERE place_kind = 'mir'
        AND place_code <> ALL($1::text[])
      GROUP BY 1 LIMIT 10`,
    // From the crosswalk itself, not a fourth hand-written copy — nsFolders.test.ts
    // pins that list against its own witness, so there is one place to be wrong.
    [[...MIR_CODES]],
  );
  assert.equal(
    rows.length,
    0,
    `non-МИР code(s) in a 'mir' place: ${rows.map((r) => `${r.place_code} (${r.n})`).join(", ")}`,
  );
  const [total] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM person_role WHERE place_kind = 'mir'`,
  );
  assert.ok(
    Number(total.n) > 50000,
    `only ${total.n} 'mir' place(s) — the gate is passing vacuously`,
  );
});

test.skipIf(skip)(
  "a candidacy's МИР is one the candidacy actually contested",
  async () => {
    // The bug this pins: parliament.bg holds ONE seat per person with no cycle attached,
    // so using it wherever an mpId exists back-stamped a 39th-NS seat onto 2022–2026
    // candidacies that recorded no votes anywhere. The seated МИР may only DISAMBIGUATE
    // among the МИР a candidacy actually has — never assert one it does not.
    // person_election_stats is keyed on (person, election), NOT on the candidacy — a
    // person who appears in one cycle under both an `mp-{id}` shard and a `c-{party}`
    // one collapses to a single stats row. Restrict to people with exactly ONE candidacy
    // in the election so the stats row unambiguously describes the role being checked;
    // otherwise this compares a candidacy against a different candidacy's regions.
    const [row] = await allRows<{ n: string }>(
      `WITH solo AS (
         SELECT person_id, split_part(ref, ':', 1) AS election_date
           FROM person_role WHERE source = 'candidate'
          GROUP BY 1, 2 HAVING count(*) = 1
       )
       SELECT count(*) n
         FROM person_role r
         JOIN solo o
           ON o.person_id = r.person_id
          AND o.election_date = split_part(r.ref, ':', 1)
         JOIN person_election_stats s
           ON s.person_id = r.person_id
          AND s.election_date = o.election_date
        WHERE r.source = 'candidate'
          AND r.place_code IS NOT NULL
          AND jsonb_array_length(s.regions) > 0
          AND NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(s.regions) g
             WHERE g->>'oblast' = r.place_code
          )`,
    );
    assert.equal(
      row.n,
      "0",
      `${row.n} candidacy place(s) name a МИР absent from that candidacy's own region rows`,
    );
    // …and the join must actually match something, or "0 mismatches" means "0 rows".
    const [scope] = await allRows<{ n: string }>(
      `WITH solo AS (
         SELECT person_id, split_part(ref, ':', 1) AS election_date
           FROM person_role WHERE source = 'candidate'
          GROUP BY 1, 2 HAVING count(*) = 1
       )
       SELECT count(*) n FROM person_role r
         JOIN solo o ON o.person_id = r.person_id
                    AND o.election_date = split_part(r.ref, ':', 1)
        WHERE r.source = 'candidate' AND r.place_code IS NOT NULL`,
    );
    assert.ok(
      Number(scope.n) > 40000,
      `only ${scope.n} candidacy place(s) in scope — the gate is passing vacuously`,
    );
  },
);

test.skipIf(skip)(
  "every magistrate role with a resolvable court carries a judicial place",
  async () => {
    // The 394 roles whose ИВСС record names no institution, and the ~35 spellings the
    // parser refuses to guess at, legitimately have none — so this pins the RATIO rather
    // than demanding 100%. A collapse here means judicial_body_alias was not loaded
    // before db:resolve:persons (db:refresh order) and every magistrate lost their court.
    const [row] = await allRows<{ typed: string; withcourt: string }>(
      `SELECT count(*) FILTER (WHERE r.place_kind = 'judicial') AS typed,
              count(*) FILTER (WHERE m.court IS NOT NULL AND m.court <> '') AS withcourt
         FROM person_role r JOIN magistrate m ON m.name = r.ref
        WHERE r.source = 'magistrate'`,
    );
    const ratio = Number(row.typed) / Math.max(1, Number(row.withcourt));
    assert.ok(
      ratio > 0.95,
      `only ${row.typed}/${row.withcourt} magistrate roles with a court got a judicial place (${(100 * ratio).toFixed(1)}%) — db:load:judicial-bodies:pg did not run before db:resolve:persons, or the parser regressed`,
    );
  },
);

test.skipIf(skip)("every judicial place_code is a real body", async () => {
  const rows = await allRows<{ place_code: string }>(
    `SELECT DISTINCT r.place_code FROM person_role r
      WHERE r.place_kind = 'judicial'
        AND NOT EXISTS (SELECT 1 FROM judicial_body b WHERE b.body_code = r.place_code)
      LIMIT 10`,
  );
  assert.equal(
    rows.length,
    0,
    `judicial place code(s) with no body row: ${rows.map((r) => r.place_code).join(", ")}`,
  );
});

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
