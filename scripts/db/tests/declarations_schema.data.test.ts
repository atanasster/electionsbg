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
  // Asset form (tables 2, 3.5, 13, 14).
  "disposal_property",
  "disposal_vehicle",
  "third_party_expense",
  "guarantee",
  // The two INTERESTS forms (Dekl2 / Dekl3) — see detectFormKind in
  // scripts/declarations/parse_declaration.ts.
  "interest_contract",
  "related_person",
  "early_repayment",
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

// ---------------------------------------------------------------------------
// The root-element discriminator must stay EXHAUSTIVE.
//
// `ROOT_TO_KIND` (scripts/declarations/parse_declaration.ts) is a closed map over a
// register that has already added forms once, and the failure is silent BY DESIGN: an
// unrecognised root parses no tables, so the filing still publishes its year, institution
// and source link while losing all its content. Every row count reconciles. That is the
// exact signature of the Dekl2 failure — 4,331 filings publishing nothing for two years
// with nothing red anywhere.
//
// This pins the DISCRIMINATOR against the raw cache rather than a downstream row count.
// A count-based gate ("filings with zero rows of every kind must not jump") needs a
// hard-coded baseline — 3,601 of 47,983 today — that drifts with every ingest and that a
// genuinely blank filing moves legitimately. The set of root elements does not drift: it
// changes only when the register introduces a form, which is the event worth failing on.
//
// Reads raw_data/, which is gitignored, so it self-skips on a machine without the cache
// (CI) exactly like the Postgres gates skip without a database.
const RAW_DIRS = ["raw_data/officials", "raw_data/declarations"];
const KNOWN_ROOTS = ["PublicPerson", "PublicPersonDekl2", "PublicPersonDekl3"];

test("every declaration root in the raw cache is one the parser knows", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const dirs = RAW_DIRS.filter((d) => fs.existsSync(d));
  if (dirs.length === 0) return; // no raw cache on this machine — nothing to check

  const seen = new Map<string, { count: number; sample: string }>();
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(p);
      } else if (e.name.endsWith(".xml")) {
        // The root is within the first few hundred bytes, after the prolog and the
        // stylesheet PI. Read a slice rather than the whole 48k-file corpus.
        const fd = fs.openSync(p, "r");
        const buf = Buffer.alloc(512);
        const n = fs.readSync(fd, buf, 0, 512, 0);
        fs.closeSync(fd);
        const m = /<(PublicPerson\w*)[\s>]/.exec(
          buf.subarray(0, n).toString("utf-8"),
        );
        const root = m ? m[1] : "(none)";
        const prior = seen.get(root);
        if (prior) prior.count++;
        else seen.set(root, { count: 1, sample: p });
      }
    }
  };
  for (const d of dirs) walk(d);

  assert.ok(seen.size > 0, "raw cache present but no declaration XML found");
  const unknown = [...seen.entries()].filter(([r]) => !KNOWN_ROOTS.includes(r));
  assert.deepEqual(
    unknown,
    [],
    `the register publishes a form the parser does not know, and it is parsing NO tables ` +
      `for it: ${unknown
        .map(([r, v]) => `<${r}> ×${v.count} (e.g. ${v.sample})`)
        .join(
          ", ",
        )}. Add it to ROOT_TO_KIND and write its table map — do NOT let it fall ` +
      `through to another form's numbering, which is the bug this whole layer exists for.`,
  );
});
