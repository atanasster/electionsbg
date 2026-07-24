// End-to-end gate for the human-override tier (scripts/person/overrides.ts +
// person_link_override, 081_person_identity.sql). Constructs a same-name mis-merge — two
// mentions sharing a gold mp-id hardId AND a name fold — inserts a REF-LEVEL SPLIT override
// into Postgres, loads it back through the exact SELECT the resolver runs, applies it, and
// asserts the wrong mention is separated onto its own person. Proves the mechanism the task
// asked for: a genuine mis-merge undone by DATA, not code — and that a ref-split can veto a
// Tier-0 gold union a name fold is too coarse to target.
//
//   npm run test:data
//
// Needs Postgres (translit_bg_latin folding + the person_link_override table); auto-skips when
// unreachable, like the other *.data.test.ts gates. Self-applies 081 so it works on any DB.

import { test, afterAll, beforeAll } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, exec, end } from "../lib/pg";
import {
  applyOverrides,
  parseOverrides,
  EMPTY_OVERRIDES,
  type OverrideRow,
  type OvMention,
  type OGroup,
} from "../../person/overrides";

const SCHEMA_081 = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../schema/pg/081_person_identity.sql",
);

// A ref that cannot collide with a real candidacy (year 2099), so cleanup is exact.
const TEST_REF = "2099_01_01:c-99-override-test";

const reachable = async (): Promise<boolean> => {
  try {
    await exec(fs.readFileSync(SCHEMA_081, "utf8")); // self-heal: ensures ref_a exists
    await allRows(
      `SELECT kind, fold_a, fold_b, ref_a, ref_b FROM person_link_override LIMIT 0`,
    );
    return true;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb ? false : "Postgres unreachable / override table absent";

beforeAll(async () => {
  if (!haveDb) return;
  await allRows(`DELETE FROM person_link_override WHERE ref_a = $1`, [
    TEST_REF,
  ]);
});

afterAll(async () => {
  if (haveDb)
    await allRows(`DELETE FROM person_link_override WHERE ref_a = $1`, [
      TEST_REF,
    ]);
  await end();
});

// Fold a real Cyrillic name through THE normalizer, so the test's synthetic mentions share the
// exact fold two same-name people would — no JS approximation of the transliteration.
const foldName = async (name: string): Promise<string> => {
  const [r] = await allRows<{ f: string }>(
    `SELECT translit_bg_latin($1) AS f`,
    [name],
  );
  return r.f;
};

test.skipIf(skip)(
  "a ref-level split override separates a same-name gold mis-merge",
  async () => {
    const fold = await foldName("Моника Георгиева Василева");

    // The mis-merge: a real MP and TWO candidacies bound to its mp id — one legitimately, one
    // a different same-named Monika whom matchMp() mis-bound. All three share the fold AND the
    // gold hardId, so the resolver's Tier-0 union has collapsed them onto one exact_id person.
    const mp: OvMention = {
      id: "mp:9999999",
      source: "mp",
      ref: "9999999",
      hardId: "mp:9999999",
      nameFold: fold,
    };
    const good: OvMention = {
      id: "candidate:2021_04_04:c-1-monika",
      source: "candidate",
      ref: "2021_04_04:c-1-monika",
      hardId: "mp:9999999",
      nameFold: fold,
    };
    const bad: OvMention = {
      id: `candidate:${TEST_REF}`,
      source: "candidate",
      ref: TEST_REF,
      hardId: "mp:9999999",
      nameFold: fold,
    };
    const mentions = [mp, good, bad];
    const misMerged: OGroup[] = [
      { ids: mentions.map((m) => m.id), confidence: "exact_id" },
    ];

    // Baseline: with no override the three stay one person — the mis-merge is real.
    const before = applyOverrides(misMerged, mentions, EMPTY_OVERRIDES);
    assert.equal(before.length, 1, "baseline should be one collapsed person");

    // Operator action: insert a ref-level split (what `npm run person:override -- split --ref`
    // writes), then load it back through the resolver's own SELECT + parser.
    await allRows(
      `INSERT INTO person_link_override (kind, ref_a, note, decided_by)
       VALUES ('split', $1, 'data-test: different Monika than mp-9999999', 'test')`,
      [TEST_REF],
    );
    const parsed = parseOverrides(
      await allRows<OverrideRow>(
        `SELECT kind, fold_a, fold_b, ref_a, ref_b FROM person_link_override WHERE ref_a = $1`,
        [TEST_REF],
      ),
    );
    assert.ok(parsed.refSplits.has(TEST_REF), "ref-split loaded from PG");

    const after = applyOverrides(misMerged, mentions, parsed);

    // The wrong candidacy is now its own person, off the MP.
    const badGroup = after.find((g) => g.ids.includes(bad.id));
    assert.ok(badGroup, "the wrong candidacy still exists as a person");
    assert.deepEqual(
      badGroup!.ids,
      [bad.id],
      "the wrong candidacy is isolated on its own person",
    );
    assert.ok(
      !after.some((g) => g.ids.includes(mp.id) && g.ids.includes(bad.id)),
      "the wrong candidacy no longer shares the MP's person (gold union vetoed)",
    );
    // The MP keeps its legitimate candidacy — the split is surgical, not a scorched-earth split.
    const mpGroup = after.find((g) => g.ids.includes(mp.id))!;
    assert.ok(
      mpGroup.ids.includes(good.id),
      "the MP keeps its correctly-bound candidacy",
    );
  },
);
