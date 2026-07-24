// Gates for the resolver's SECOND gold key — the Сметна палата register's own per-person
// GUID, recovered from declaration.source_url (registerIdByRef in ./resolve_persons.ts).
//
// It exists because the officials slug is `hash(rawName|institution)`, so the register
// re-casing a name between harvests mints a second slug for the same declarant and
// scatters their filings across two person rows. Слави Трифонов was the live example:
// "Станислав Тодоров Трифонов" (2023/2024) and "СТАНИСЛАВ ТОДОРОВ ТРИФОНОВ" (2025) became
// two identities holding 4 and 1 declaration events, and /person/mp-3056 saw neither.
//
// Both failure modes here are silent — a split identity is still a valid, servable page,
// it just shows a fraction of the person's declared wealth — so nothing else catches them.
//
// Auto-skips when Postgres is down or the corpus is not loaded+resolved, like the other
// *.data.test.ts gates.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, end } from "../db/lib/pg";

// The register stamps every filing `<person GUID><filing sequence>.xml`.
const GUID_RE =
  "([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})";

const reachable = async (): Promise<boolean> => {
  try {
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM declaration WHERE person_id IS NOT NULL",
    );
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};

const skip = (await reachable())
  ? false
  : "Postgres unreachable / declarations not resolved";

afterAll(async () => {
  await end();
});

// The core invariant. One register person = one person row. The exclusion mirrors the
// resolver's own collision guard exactly: a subject_ref carrying MORE than one GUID is two
// register persons collapsed onto one officials slug (what scripts/officials/
// _slug_collisions.json splits by hand), so the resolver skips the key there rather than
// guessing — and those subjects can legitimately stay split until the slug is fixed.
test.skipIf(skip)("a register person resolves to one person row", async () => {
  const split = await allRows<{ guid: string; refs: string; persons: string }>(
    `WITH dg AS (
       SELECT person_id, tier, subject_ref,
              upper(substring(source_url from '${GUID_RE}')) AS guid
         FROM declaration WHERE person_id IS NOT NULL
     ), clean AS (
       SELECT subject_ref FROM dg WHERE guid IS NOT NULL
        GROUP BY subject_ref HAVING count(DISTINCT guid) = 1
     )
     SELECT guid, string_agg(DISTINCT tier || ':' || subject_ref, ' | ') AS refs,
            count(DISTINCT person_id)::text AS persons
       FROM dg WHERE guid IS NOT NULL AND subject_ref IN (SELECT subject_ref FROM clean)
      GROUP BY guid HAVING count(DISTINCT person_id) > 1
      LIMIT 5`,
  );
  assert.equal(
    split.length,
    0,
    `register person id(s) split across several person rows — the gold key is not ` +
      `reaching the resolver: ${JSON.stringify(split)}`,
  );
});

// The rebuild must not destroy the ingested corpus. `declaration` is ON DELETE SET NULL on
// purpose (the filings outlive any one resolve; phase 2 of load_declarations_pg re-attaches
// person_id) — but TRUNCATE … CASCADE ignores per-FK delete actions and truncates every
// referencing table outright, which silently wiped all 46k filings and their children on
// every resolve. Pin both halves: the FK action, and that the rebuild uses DELETE.
test.skipIf(skip)(
  "rebuilding person preserves the declaration corpus",
  async () => {
    const [fk] = await allRows<{ action: string }>(
      `SELECT confdeltype AS action FROM pg_constraint
      WHERE contype = 'f' AND confrelid = 'person'::regclass
        AND conrelid = 'declaration'::regclass`,
    );
    assert.equal(
      fk?.action,
      "n",
      "declaration.person_id must be ON DELETE SET NULL — a resolve rebuilds person, " +
        "it does not retract the filings",
    );
    const src = fs.readFileSync(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "resolve_persons.ts",
      ),
      "utf8",
    );
    assert.ok(
      !/TRUNCATE\s+person\b/i.test(src),
      "resolve_persons.ts truncates person — TRUNCATE … CASCADE overrides the SET NULL " +
        "above and takes the whole declaration tree with it; use DELETE FROM person",
    );
  },
);
