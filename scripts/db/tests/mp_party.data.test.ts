// mp-party-affiliation-v1 gates 5.0-5.3 — MP roles carry the RIGHT party, for
// the RIGHT person, in the right vocabulary.
//
// Ordered by how much damage the failure does, not by gate number:
//
//   5.0  no MP row carries ANOTHER PERSON'S seat   (wrong human)
//   5.3  the ENTRY group, not the last-seen one    (wrong group — defamatory)
//   5.1  coverage floor + the crosswalk is total   (silent NULL for a parliament)
//   5.2  one vocabulary, no Cyrillic               (split facet, unlabelled row)
//
// Auto-skips when Postgres is down or the roll-call corpus is absent.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";
import { buildMpSeatIndex } from "../../person/mpSeats";
import {
  groupShortToCanonical,
  loadCanonicalIndex,
} from "../../person/partyGroups";

const haveDb = await dbReachable();

const tableExists = async (name: string) =>
  haveDb &&
  Number(
    (
      await allRows<{ n: string }>(
        `SELECT count(*) n FROM pg_class WHERE relname = $1`,
        [name],
      )
    )[0]?.n,
  ) > 0;

const haveSeats = await tableExists("mp_seat");
const haveRoles = await tableExists("person_role");

afterAll(async () => {
  await end();
});

// The three benign name disagreements in the corpus — same person, different
// spelling. Anything else that disagrees is a DIFFERENT PERSON, which is what
// this file exists to catch, so keep this list short and justify every entry.
//
//   3238:44  Радостин Радослaвов Танев — a Latin `a` homoglyph in the person row
//   5095     Деница Евгениева Сачева-Атанасова vs Сачева (married name)
//   5334:52  Галя Стоянова Желязкова vs Василева (married name)
//
// `5095` is keyed by REF ALONE, deliberately: she sits in NS 46-52 and the
// registry name differs in all of them, so a per-NS key would need a new entry
// every parliament. The cost is that it also excuses a future genuine mismatch
// on that id — acceptable because 5.0 and 5.3 still cover her rows.
const BENIGN_NAME_VARIANTS = new Set(["3238:44", "5095", "5334:52"]);

test("5.0 — no MP row carries another person's seat", async (t) => {
  if (!haveDb || !haveRoles || !haveSeats) return t.skip();

  // person_role.ref for source='mp' is a parliament.bg PROFILE id; mp_seat.mp_id
  // is a per-parliament SEAT id. Joining them bare gives 316 cross-person pairs
  // out of 1,831 (17.3%). The resolver goes through mpSeats.ts, which filters on
  // that MP's own nsFolders — so every seat backing a stored party must be one
  // this person actually held.
  const seats = buildMpSeatIndex();
  assert.ok(seats.size > 400, `only ${seats.size} MPs in the seat index`);

  const rows = await allRows<{ ref: string; display_name: string }>(
    `SELECT r.ref, p.display_name
       FROM person_role r JOIN person p ON p.person_id = r.person_id
      WHERE r.role = 'mp' AND r.party IS NOT NULL`,
  );
  assert.ok(rows.length > 0, "no MP role carries a party — T2 did not run");

  // Every party-bearing MP role must have a guarded seat behind it.
  const orphans = rows.filter((r) => !seats.has(Number(r.ref)));
  assert.deepEqual(
    orphans.map((r) => `${r.ref} ${r.display_name}`),
    [],
    "MP roles with a party but no seat in the nsFolders-guarded index — the party came from somewhere it should not have",
  );

  // …and the profile id must not be one of the recycled ones resolving to a
  // parliament this person did not sit in. 3103 is the worked example: index.json
  // says Димитър Бойчев Петров (NS 41-44); the corpus also has that id in NS 51
  // as Деница Димитрова Симеонова.
  const seats3103 = seats.get(3103)?.map((s) => s.ns) ?? [];
  if (seats3103.length) {
    assert.deepEqual(
      seats3103,
      [44],
      "profile 3103 picked up NS 51, which belongs to a different member",
    );
  }
});

test("5.0b — the stored party matches the seat's own name", async (t) => {
  if (!haveDb || !haveRoles || !haveSeats) return t.skip();

  // The sharper form: fold both names and require agreement on every joined
  // pair. This is what discriminates a guarded join from a bare one — the bare
  // join's 316 bad pairs are all name mismatches.
  const rows = await allRows<{
    ref: string;
    ns: string;
    person_name: string;
    seat_name: string;
  }>(
    `SELECT r.ref, s.ns::text AS ns, p.display_name AS person_name, s.name AS seat_name
       FROM person_role r
       JOIN person p   ON p.person_id = r.person_id
       JOIN mp_seat s  ON s.mp_id::text = r.ref
      WHERE r.role = 'mp' AND r.party IS NOT NULL`,
  );

  const seats = buildMpSeatIndex();
  const fold = (s: string) =>
    s
      .toLocaleUpperCase("bg")
      .replace(/[.\s-]+/g, " ")
      .trim();

  // Check the seat the party ACTUALLY came from — the latest guarded one — and
  // do not pre-filter the row set by that same index.
  //
  // A first draft filtered `rows` down to pairs the index admits, which made the
  // gate unfalsifiable: if `person_role` had been populated from the bare
  // mp_id join, the filter would have discarded exactly the bad rows before
  // asserting. (Simulated: 807 orphan refs and 26 changed values passed it
  // unchanged.) Asserting per STORED ROW instead means every party-bearing role
  // must have a name-matching seat behind it, so a bare-join regression shows up
  // as a mismatch rather than being filtered away.
  const mismatches: string[] = [];
  for (const r of rows) {
    const list = seats.get(Number(r.ref));
    const latest = list?.length ? list[list.length - 1] : undefined;
    if (!latest) {
      mismatches.push(`${r.ref}: stored a party with no guarded seat`);
      continue;
    }
    if (Number(r.ns) !== latest.ns) continue; // a different NS's row, not the source
    if (fold(r.person_name) === fold(r.seat_name)) continue;
    if (
      BENIGN_NAME_VARIANTS.has(`${r.ref}:${r.ns}`) ||
      BENIGN_NAME_VARIANTS.has(r.ref)
    ) {
      continue;
    }
    mismatches.push(`${r.ref}:${r.ns} ${r.person_name} != ${r.seat_name}`);
  }

  assert.deepEqual(
    mismatches,
    [],
    "a stored MP party is backed by a seat naming a different person",
  );
});

test("5.3 — the ENTRY group, never mp_seat.party_id (last-seen)", async (t) => {
  if (!haveDb || !haveRoles || !haveSeats) return t.skip();

  // mp_seat.party_id is documented last-seen (134_rollcall.sql), and using it
  // would file a defector under the group they LEFT — the [[feedback_name_match_not_identity]]
  // failure applied to affiliation. The resolver stores the group held at the
  // member's FIRST cast in that NS instead.
  const canon = loadCanonicalIndex();
  const seats = buildMpSeatIndex();

  const stored = await allRows<{ ref: string; party: string }>(
    `SELECT ref, party FROM person_role WHERE role = 'mp' AND party IS NOT NULL`,
  );
  assert.ok(stored.length > 0, "no MP role carries a party — T2 did not run");

  const wrong: string[] = [];
  for (const row of stored) {
    const list = seats.get(Number(row.ref));
    if (!list?.length) continue;
    const latest = list[list.length - 1];
    const expected = groupShortToCanonical(latest.entryGroupShort, canon);
    if (row.party !== expected) {
      wrong.push(`${row.ref}: stored ${row.party}, entry group ${expected}`);
    }
  }
  assert.deepEqual(wrong, [], "stored MP party is not the entry group");

  // And prove the two bases genuinely differ, so this gate cannot pass by
  // accident on a corpus where nobody ever switched. Measured: 88 seats change
  // group mid-term, and on NS 52 the entry basis is ДБ 33 / ПП 18 against a
  // last-seen ДБ 28 / ПП 23.
  const [{ n }] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM (
       SELECT c.ns, c.mp_id FROM vote_cast c
        WHERE c.ns IS NOT NULL
        GROUP BY 1, 2 HAVING count(DISTINCT c.party_id) > 1) q`,
  );
  assert.ok(
    Number(n) > 100,
    `only ${n} seats change group mid-term — gate 5.3 has nothing to discriminate`,
  );
});

test("5.1 — coverage floor, and the crosswalk covers every live group short", async (t) => {
  if (!haveDb || !haveRoles) return t.skip();

  const [{ n }] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM person_role WHERE role = 'mp' AND party IS NOT NULL`,
  );
  // A FLOOR, not an equality: a T0 win or a new parliament raises it without an
  // edit. 563 measured 2026-08-07 (§1c). Emphatically NOT 843 — that figure came
  // from the bare mp_id join and would fail a correct build while passing the
  // broken one.
  assert.ok(
    Number(n) >= 563,
    `only ${n} mp role(s) carry a party, expected >= 563`,
  );

  if (!(await tableExists("party_dim"))) return;
  // Exhaustiveness: every group short the corpus contains must resolve, so a
  // NEW parliament introducing one fails the build instead of writing NULL for
  // a whole NS among the 1,559 legitimately blank roles.
  const canon = loadCanonicalIndex();
  const shorts = await allRows<{ short: string }>(
    `SELECT DISTINCT short FROM party_dim WHERE short IS NOT NULL`,
  );
  assert.ok(shorts.length > 20, `only ${shorts.length} distinct group shorts`);
  const unresolved = shorts
    .map((s) => s.short)
    .filter((s) => {
      try {
        return !groupShortToCanonical(s, canon);
      } catch {
        return true;
      }
    });
  assert.deepEqual(
    unresolved,
    [],
    "party_dim.short values the crosswalk cannot resolve — add an alias or a sentinel",
  );
});

test("the ПАРТИЯ column's multi-party badge stays consistent with party_codes", async (t) => {
  if (!haveDb || !(await tableExists("person_browse_table"))) return t.skip();

  // The one downstream effect §0d's "120 needs no edit" does not mention:
  // `parties_n` counts DISTINCT party over a person's roles, so an MP whose
  // group differs from every ballot party they carried gains one — and
  // PersonsBrowserScreen renders that as a "+N" badge beside the party chip.
  // Measured: 15 people moved from 1 to 2 when T2 landed. Harmless, but it is a
  // visible change to a column nobody was watching, so it gets an invariant
  // rather than a surprise: the badge must always agree with the padded set it
  // summarises.
  const [{ n }] = await allRows<{ n: string }>(
    `SELECT count(*) n
       FROM person_browse_table
      WHERE is_mp
        AND party_codes IS NOT NULL
        AND parties_n <> array_length(
              string_to_array(btrim(party_codes), ' '), 1)`,
  );
  assert.equal(
    Number(n),
    0,
    "parties_n disagrees with the number of codes in party_codes",
  );
});

test("5.2 — one vocabulary: no Cyrillic, every id labellable", async (t) => {
  if (!haveDb || !haveRoles) return t.skip();

  // Writing the raw group short would render the Cyrillic string through the
  // `|| p.partyPrimary` fallback, fail to colour it, and split the facet
  // dropdown into `gerb` and `ГЕРБ - СДС` as two options for one party — the
  // exact "makes them look comparable" failure the old NULL was protecting
  // against. This gate is why that objection can be retired rather than merely
  // overridden.
  const [{ n }] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM person_role WHERE party ~ '[А-Яа-я]'`,
  );
  assert.equal(Number(n), 0, "person_role.party contains a Cyrillic value");

  const ids = new Set(loadCanonicalIndex().parties.map((p) => p.id));
  const values = await allRows<{ party: string; n: string }>(
    `SELECT party, count(*)::text AS n
       FROM person_role WHERE role = 'mp' AND party IS NOT NULL
      GROUP BY 1`,
  );
  const unlabelled = values.filter((v) => !ids.has(v.party));
  assert.deepEqual(
    unlabelled.map((v) => `${v.party} (${v.n} roles)`),
    [],
    "MP party ids with no canonical entry — these print as themselves in the ПАРТИЯ column",
  );
});
