// The TYPED place on person_role (migration 115).
// Plan: docs/plans/person-role-place-consolidation-v1.md.
//
// WHAT THESE PIN. `place` used to be one untyped text column carrying five mutually
// incompatible namespaces, which is how raw obshtina codes ("BLG11") ended up rendered
// to users on /person and how a single council seat came to be listed twice. The
// replacement is a typed (kind, code) pair whose label is resolved from place_dim (117) /
// judicial_body (116), and every failure mode of that pair is SILENT — a NULL kind just
// drops the badge, a code the dictionary does not carry just renders blank, a stale Sofia
// synonym just re-splits the seat it was introduced to merge. So each invariant gets an
// assertion rather than a comment.
//
// The label assertions below run against the JOIN. The materialised
// place_label/place_label_en columns they used to read are GONE (dropped in 115) — see
// person_place_label_join.data.test.ts for the drift guards that replaced them.
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

// Sources whose every role is expected to carry a MUNICIPAL place. Both resolve a
// municipality: `official_muni` from the Court-of-Audit roster, `local` from the
// local-election shards.
//
// `local` accepts 'settlement' as well as 'obshtina' since §T2: a кмет на кметство governs a
// VILLAGE, so his seat is an EKATTE settlement whose parent obshtina is one join away
// (place_dim.obshtina_code). Publishing the община instead named a place he does not govern —
// с. Безмер's mayor read as "Тунджа" — and it is why this list is about being PLACED, not
// about one namespace. What must never happen is a municipal role with no place at all.
// See docs/plans/village-mayor-attribution-v1.md §T2.
const MUNICIPAL_PLACE_KINDS = ["obshtina", "settlement"];
const OBSHTINA_SOURCES = ["official_muni", "local"];

afterAll(async () => {
  await end();
});

test.skipIf(skip)(
  "every municipal role carries a typed municipal place",
  async () => {
    for (const source of OBSHTINA_SOURCES) {
      const [row] = await allRows<{ total: string; typed: string }>(
        `SELECT count(*) AS total,
              count(*) FILTER (
                WHERE place_kind = ANY($2::text[]) AND place_code IS NOT NULL
              ) AS typed
         FROM person_role WHERE source = $1`,
        [source, MUNICIPAL_PLACE_KINDS],
      );
      assert.equal(
        row.typed,
        row.total,
        `${Number(row.total) - Number(row.typed)} '${source}' role(s) have no typed municipal place — db:resolve:persons ran against a roster without obshtina codes, or the fill regressed`,
      );
    }
  },
);

// A settlement place is only useful if its parent obshtina resolves: `?obshtina` on /persons
// and 120's obshtina_code both read it through place_dim. A settlement row with a NULL parent
// would drop that person out of the filter silently — the failure mode the whole §T2 change
// was careful to avoid.
test.skipIf(skip)(
  "every settlement place resolves to a parent obshtina",
  async () => {
    const rows = await allRows<{ ref: string; place_code: string }>(
      `SELECT r.ref, r.place_code
         FROM person_role r
         LEFT JOIN place_dim pd
           ON pd.kind = 'settlement' AND pd.code = r.place_code
        WHERE r.place_kind = 'settlement'
          AND (pd.code IS NULL OR pd.obshtina_code IS NULL)
        LIMIT 5`,
    );
    assert.deepEqual(
      rows.map((r) => `${r.ref} → ${r.place_code}`),
      [],
      `settlement place(s) with no parent obshtina in place_dim — those people vanish from the ?obshtina filter`,
    );
  },
);

// Only village mayors get a settlement. A mayor or councillor with one would mean the walk
// stamped the wrong helper — their office IS the община, and narrowing it to the seat's
// village would understate what they govern.
test.skipIf(skip)("only village mayors carry a settlement place", async () => {
  const rows = await allRows<{ source: string; role: string; n: string }>(
    `SELECT source, role, count(*) AS n FROM person_role
        WHERE place_kind = 'settlement' AND role <> 'village_mayor'
        GROUP BY 1, 2 LIMIT 5`,
  );
  assert.deepEqual(
    rows.map((r) => `${r.source}/${r.role} ×${r.n}`),
    [],
    `non-village-mayor role(s) carry a settlement place`,
  );
});

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
  // Asserted against the JOINED label, not person_role.place_label: 082 resolves the label
  // from place_dim (117) / judicial_body (116), and the materialised columns are on their
  // way out. The invariant is unchanged — a code with no label is a blank badge — but its
  // subject is now the dictionary, which is where a missing entry would actually originate.
  // (The old form was green even on a database where db:load:place-dim:pg never ran, since
  // resolve_persons used to write the label in JS, independently of the dimension.)
  //
  // Deliberately duplicated: person_place_label_join.data.test.ts carries the same guard
  // with richer diagnostics, but that file is scoped to the column-retirement window. This
  // is the durable copy.
  const rows = await allRows<{ place_kind: string; place_code: string }>(
    `SELECT DISTINCT r.place_kind, r.place_code FROM person_role r
       LEFT JOIN place_dim pd
         ON pd.kind = r.place_kind AND pd.code = r.place_code
       LEFT JOIN judicial_body jb
         ON r.place_kind = 'judicial' AND jb.body_code = r.place_code
      WHERE r.place_code IS NOT NULL
        AND COALESCE(pd.name_bg, jb.name) IS NULL
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
  //
  // Against the joined label for the same reason as above; place_dim is where the English
  // name now comes from, and judicial_body has no name_en column at all.
  const rows = await allRows<{ place_kind: string; place_code: string }>(
    `SELECT DISTINCT r.place_kind, r.place_code FROM person_role r
       LEFT JOIN place_dim pd
         ON pd.kind = r.place_kind AND pd.code = r.place_code
      WHERE r.place_code IS NOT NULL
        AND r.place_kind <> 'judicial'
        AND pd.name_en IS NULL
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
    //
    // WHAT THIS DOES **NOT** PROVE, since mp-party-affiliation-v1 T3 gave an MP
    // one row per parliament (§2d). `index.json` holds ONE `seatedRegion` per
    // person with no per-NS variant, so the МИР is REPLICATED across a member's
    // rows. For someone who stood in a different МИР in a different parliament,
    // N-1 of their rows name the wrong one — and this gate stays green, because
    // every row does have a code. The companion test below MEASURES that bound
    // instead of leaving it as a caveat.
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

test.skipIf(skip)(
  "the replicated МИР affects a KNOWN and BOUNDED set of MPs (§2d)",
  async () => {
    // The cost of the §2d replication decision, measured rather than asserted.
    // An MP's own candidacies DO carry a per-election МИР, so they can bound how
    // often the replicated seat is wrong even though nothing can currently fix
    // it: 130 of the 303 multi-parliament MPs (43%) stood in more than one МИР.
    //
    // Two things this pins. First, replication is genuinely lossy for a large
    // minority — anyone reading `person_role.place_code` on a historical MP row
    // should know that. Second, if a future ingest gains per-NS seat data, this
    // number is what the fix has to move; a silent drop toward zero here would
    // mean the candidacy МИР stopped being populated, not that MPs stopped
    // moving.
    const [row] = await allRows<{ multi: string; moved: string }>(
      `WITH multi AS (
         SELECT person_id FROM person_role
          WHERE source = 'mp' AND ref LIKE '%:%'
          GROUP BY person_id HAVING count(*) > 1),
       cand AS (
         SELECT r.person_id, count(DISTINCT r.place_code) mirs
           FROM person_role r JOIN multi USING (person_id)
          WHERE r.source = 'candidate' AND r.place_code IS NOT NULL
          GROUP BY 1)
       SELECT count(*)::text AS multi,
              count(*) FILTER (WHERE mirs > 1)::text AS moved
         FROM cand`,
    );
    assert.ok(
      Number(row.multi) > 200,
      `only ${row.multi} multi-parliament MPs — the per-NS rows are missing`,
    );
    // Every row of one ROSTER PROFILE carries the same code, by construction — the
    // seat is read once per parliament.bg mp id (index.json's `seatedRegion`) and
    // replicated across that id's parliaments. So this is the only place the
    // inaccuracy is visible at all.
    //
    // ⚠️ THE GRAIN IS THE PROFILE, NOT THE PERSON, and this assertion said `person`
    // until 2026-08-13 — true only for as long as no human held two profiles.
    // parliament.bg has three (it re-registers an MP who changes name: id 2454
    // „Мая Божидарова Манолова" and id 3252 „…Манолова-Найденова" are one woman,
    // same birth date, and the person layer merges them on that gold key — correctly).
    // Each profile carries its own seat, so the merged person legitimately shows
    // Кюстендил on one and Благоевград on the other. Asserting at the person grain
    // turned a correct merge into a red gate; asserting at the profile grain still
    // catches what §2d is about — the replication rule itself changing.
    const [{ n }] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM (
         SELECT person_id, split_part(ref, ':', 1) AS mp_id
           FROM person_role WHERE source = 'mp'
          GROUP BY 1, 2 HAVING count(DISTINCT place_code) > 1) q`,
    );
    assert.equal(
      Number(n),
      0,
      "one MP roster profile carries two place_codes — the replication rule changed without §2d being revisited",
    );

    // And the cross-profile case is BOUNDED and visible rather than silent. A person
    // holding several profiles is the only way a merged MP can show two МИР at all,
    // so a jump here means the roster grew duplicates (or the merge started firing on
    // something weaker than the birth-date gold key) — either of which is a person-layer
    // change, not a place-layer one. Measured 2026-08-13: 3 multi-profile people, 1 of
    // them seated from two different МИР.
    const [dup] = await allRows<{ people: string; two_codes: string }>(
      `WITH profiles AS (
         SELECT person_id, count(DISTINCT split_part(ref, ':', 1)) AS n_mp_ids,
                count(DISTINCT place_code) AS n_codes
           FROM person_role WHERE source = 'mp'
          GROUP BY person_id)
       SELECT count(*) FILTER (WHERE n_mp_ids > 1)::text                  AS people,
              count(*) FILTER (WHERE n_mp_ids > 1 AND n_codes > 1)::text  AS two_codes
         FROM profiles`,
    );
    assert.ok(
      Number(dup.people) <= 20,
      `${dup.people} MPs hold more than one parliament.bg profile (expected a handful) — ` +
        `the roster gained duplicates or the merge widened`,
    );
    // Every person with two codes must be explained by two profiles. This is what makes
    // the profile-grain assertion above safe to weaken to: with no duplicate profiles the
    // two assertions are identical, so the gate does not go quiet on a single-profile corpus.
    const [{ unexplained }] = await allRows<{ unexplained: string }>(
      `SELECT count(*)::text AS unexplained FROM (
         SELECT person_id FROM person_role WHERE source = 'mp'
          GROUP BY person_id
         HAVING count(DISTINCT place_code) > 1
            AND count(DISTINCT split_part(ref, ':', 1)) = 1) q`,
    );
    assert.equal(
      Number(unexplained),
      0,
      "an MP shows two МИР from a SINGLE roster profile — that is the replication rule breaking",
    );
    assert.ok(
      Number(row.moved) > 50,
      `only ${row.moved} of ${row.multi} multi-parliament MPs show more than one candidacy МИР — ` +
        `expected ~130; if this collapsed, the candidacy place data changed, not the MPs`,
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
