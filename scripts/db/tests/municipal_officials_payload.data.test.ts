// The WIRE SHAPE of the two municipal-officials index routes.
//
// WHY: both payloads were trimmed to exactly what their consumers read (`role`
// and `district` dropped — see the T4 commit), and nothing enforces that. The
// client types describe the shape, but a type cannot see the SQL: adding a key to
// a jsonb_build_object is invisible to `tsc`, and removing one only fails where
// the field is dereferenced — which for an unread field is nowhere. So a
// re-added field silently re-inflates a ~1 MB payload, and a removed one breaks a
// consumer at runtime with a green build.
//
// These call the REAL route functions from functions/db_routes.js against the
// local database rather than re-implementing their SQL, so the assertion is on
// what actually goes over the wire.
//
// Each route builds ~1 MB of jsonb in a single aggregate, but the whole file
// measures ~0.5 s — cheap enough that asserting the real payload rather than a
// copy of it costs nothing worth optimising.
//
// All three assertions were verified to FAIL against injected regressions: a
// re-added `role` key, a removed `municipality` key, and an inverted role
// priority in the ORDER BY.
//
// Auto-skips when Postgres is down or the matview is absent — like the other
// *.data.test.ts gates.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { allRows, dbReachable, end } from "../lib/pg";

// functions/ is CommonJS and outside the SPA's module graph.
const require_ = createRequire(import.meta.url);
const { DB_ROUTES } = require_("../../../functions/db_routes.js") as {
  DB_ROUTES: Record<
    string,
    (
      dbRows: (sql: string, params?: unknown[]) => Promise<unknown[]>,
      q?: Record<string, unknown>,
    ) => Promise<{ body: { entries: Record<string, unknown>[] } }>
  >;
};

/** The route's `dbRows` contract, backed by the pipeline's own pool. */
const dbRows = (sql: string, params: unknown[] = []) => allRows(sql, params);

const reachable = async (): Promise<boolean> => {
  if (!(await dbReachable())) return false;
  try {
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.municipal_officials_table') IS NOT NULL AS ok",
    );
    if (!t?.ok) return false;
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM municipal_officials_table",
    );
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb
  ? false
  : "Postgres unreachable / municipal_officials_table empty";

afterAll(async () => {
  await end();
});

/** Assert every entry's key set, allowing declared-optional keys to be absent.
 *  `jsonb_strip_nulls` removes a null personSlug, so "optional" here means
 *  "absent on some rows", never "sometimes an unexpected extra". */
const assertKeys = (
  entries: Record<string, unknown>[],
  required: string[],
  optional: string[] = [],
): void => {
  assert.ok(entries.length > 0, "route returned no entries");
  const allowed = new Set([...required, ...optional]);

  const seen = new Set<string>();
  for (const e of entries) for (const k of Object.keys(e)) seen.add(k);

  // Extras are the expensive direction — an unread field re-added to a ~1 MB
  // payload costs every visitor and nothing complains.
  assert.deepEqual(
    [...seen].filter((k) => !allowed.has(k)).sort(),
    [],
    `unexpected key(s) on the wire — if this is deliberate, add it to the ` +
      `route's consumer and to this list; if not, it is dead payload`,
  );

  // Missing required keys break a consumer at runtime with a green build.
  const missing = required.filter((k) => !entries.every((e) => k in e));
  assert.deepEqual(missing, [], "required key absent on at least one entry");
};

test.skipIf(skip)(
  "municipal-officials-name-index emits exactly {slug, name, municipality}",
  async () => {
    const { body } = await DB_ROUTES["municipal-officials-name-index"](dbRows);
    // Consumer: useMunicipalOfficialsByName → ChmiFeedScreen reads `.slug`;
    // `name` and `municipality` are the name-map keys. `role` and `district` are
    // deliberately NOT here — role still drives the route's ORDER BY.
    assertKeys(body.entries, ["slug", "name", "municipality"]);
  },
);

test.skipIf(skip)(
  "municipal-officials-search-index emits exactly {slug, name, municipality, personSlug?}",
  async () => {
    const { body } =
      await DB_ROUTES["municipal-officials-search-index"](dbRows);
    // Consumer: useSearchItems builds each search item from these four.
    // personSlug is optional — jsonb_strip_nulls drops it for an official that
    // did not resolve to exactly one public person.
    assertKeys(body.entries, ["slug", "name", "municipality"], ["personSlug"]);

    const linked = body.entries.filter((e) => e.personSlug).length;
    assert.ok(
      linked > 0,
      "no entry carries personSlug — the person-layer fold resolved nothing, so " +
        "every search hit would link to /officials instead of /person",
    );
  },
);

test.skipIf(skip)(
  "the name index is ordered so a namesake resolves to the senior role",
  async () => {
    // THE reason dropping `role` from the payload was safe. The client builds a
    // first-wins byName map, so the ROUTE's ORDER BY is what decides which of two
    // same-named officials a lookup returns. Nothing else asserts that, and the
    // payload no longer carries the field it sorts on — so if the ORDER BY were
    // dropped, every check would still pass and ChmiFeedScreen would quietly
    // start linking to a councillor instead of the mayor.
    const dupes = await allRows<{ name: string; senior_slug: string }>(
      `WITH ranked AS (
         SELECT name, official_slug,
                row_number() OVER (
                  PARTITION BY name
                  ORDER BY CASE role
                             WHEN 'mayor' THEN 0
                             WHEN 'council_chair' THEN 1
                             WHEN 'deputy_mayor' THEN 2
                             WHEN 'councillor' THEN 3
                             ELSE 4
                           END, official_slug
                ) AS rn,
                count(*) OVER (PARTITION BY name) AS n
           FROM municipal_officials_table
       )
       SELECT name, official_slug AS senior_slug
         FROM ranked WHERE rn = 1 AND n > 1
         ORDER BY name
         LIMIT 25`,
    );
    if (!dupes.length) return; // no namesakes in this corpus — nothing to prove

    const { body } = await DB_ROUTES["municipal-officials-name-index"](dbRows);
    // Mirror the client's build: first occurrence of a name wins.
    const firstByName = new Map<string, string>();
    for (const e of body.entries)
      if (!firstByName.has(e.name as string))
        firstByName.set(e.name as string, e.slug as string);

    const wrong = dupes
      .filter((d) => firstByName.get(d.name) !== d.senior_slug)
      .map(
        (d) =>
          `${d.name}: got ${firstByName.get(d.name)}, want ${d.senior_slug}`,
      );
    assert.deepEqual(
      wrong,
      [],
      "first-wins lookup does not land on the senior role — the route's ORDER BY " +
        "no longer matches the priority the client depends on",
    );
  },
);
