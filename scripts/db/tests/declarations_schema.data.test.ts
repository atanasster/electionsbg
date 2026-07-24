// Migration-safety gate for 089_declarations.sql: the closed-vocabulary CHECK
// constraints in the SQL must stay in lock-step with the TypeScript unions the
// parser emits. The declaration loader (T2.2) copies the parser's category /
// event-kind strings straight into these columns, so a value the parser can
// produce but the CHECK rejects would abort the load — and a value the CHECK
// allows but the app's union does not know is a silently unrenderable row.
//
// This reads the CHECK definitions out of Postgres rather than re-stating them,
// so it fails if EITHER side drifts. Auto-skips when Postgres is down or the
// declaration table has not been migrated yet — exactly like the other
// *.data.test.ts gates, so CI (no container) skips it.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";

// The two unions the columns mirror, transcribed from src/data/dataTypes.ts.
// Kept here as literals on purpose: if someone edits the union, this list must
// be edited too, and THAT edit is the prompt to also migrate the CHECK.
const ASSET_CATEGORIES = [
  "real_estate",
  "vehicle",
  "cash",
  "bank",
  "receivable",
  "debt",
  "investment",
  "security",
] as const;

const EVENT_KINDS = [
  "disposal_property",
  "disposal_vehicle",
  "third_party_expense",
  "guarantee",
] as const;

const reachable = async (): Promise<boolean> => {
  try {
    await allRows("SELECT 1");
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.declaration_asset') IS NOT NULL AS ok",
    );
    return Boolean(t?.ok);
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb ? false : "Postgres unreachable / 089 not migrated";

afterAll(async () => {
  await end();
});

// Pull the literals a `col IN ('a','b',…)` CHECK enumerates, straight from the
// constraint definition Postgres stores.
const checkedValues = async (conname: string): Promise<Set<string>> => {
  const [row] = await allRows<{ def: string }>(
    `SELECT pg_get_constraintdef(oid) AS def
       FROM pg_constraint WHERE conname = $1`,
    [conname],
  );
  assert.ok(row, `constraint ${conname} not found`);
  return new Set([...row.def.matchAll(/'([^']+)'/g)].map((m) => m[1]));
};

test.skipIf(skip)(
  "declaration_asset.category CHECK exactly equals MpAssetCategory",
  async () => {
    const checked = await checkedValues("declaration_asset_category_check");
    assert.deepEqual(
      [...checked].sort(),
      [...ASSET_CATEGORIES].sort(),
      "the CHECK and the MpAssetCategory union have drifted apart — a loader " +
        "would either be rejected or write a value the app cannot render",
    );
  },
);

test.skipIf(skip)(
  "declaration_event.kind CHECK exactly equals DeclarationEventKind",
  async () => {
    const checked = await checkedValues("declaration_event_kind_check");
    assert.deepEqual([...checked].sort(), [...EVENT_KINDS].sort());
  },
);

test.skipIf(skip)(
  "declaration.tier is the coarse four-value label, not a person_role.source value",
  async () => {
    const checked = await checkedValues("declaration_tier_check");
    assert.deepEqual([...checked].sort(), ["exec", "magistrate", "mp", "muni"]);
    // The whole point of G13: tier is NOT a source key. If someone "fixes" it to
    // official_exec/official_muni thinking the join is tier=source, that join
    // still would not work (exec fans out to president/mep/…) — so guard the
    // coarse vocabulary explicitly.
    assert.ok(
      !checked.has("official_exec"),
      "tier must stay the coarse label; the resolve join keys on subject_ref=ref",
    );
  },
);

// person_id is nullable BY DESIGN for the load window (G13). A NOT NULL here
// would deadlock the cold bootstrap, so pin it.
test.skipIf(skip)(
  "declaration.person_id is nullable (the G13 load window)",
  async () => {
    const [col] = await allRows<{ nullable: string }>(
      `SELECT is_nullable AS nullable FROM information_schema.columns
      WHERE table_name = 'declaration' AND column_name = 'person_id'`,
    );
    assert.equal(col?.nullable, "YES");
  },
);
