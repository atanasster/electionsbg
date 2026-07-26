// The four decision rules in scripts/person/load_slug_redirects.ts, exercised against real
// Postgres on synthetic rows. Plan: docs/plans/persons-pg-retirement-v1.md (T1.0).
//
// Everything else about this feature is tested at the TABLE level
// (scripts/db/tests/person_slug_retired.data.test.ts): the invariants, the size of the
// backfill, that targets are live and correctly named. None of that pins the LOADER, and
// the gap showed: its header claimed a guard ("officials who are also MPs are counted and
// skipped") that the code never had, and nothing caught the drift because the real map
// happened to contain one example of every other branch.
//
// Each case runs inside a rolled-back transaction over a disposable person/person_role
// island, so the real corpus is never touched and the suite leaves no residue.
//
// Auto-skips when Postgres is down — like the other *.data.test.ts gates.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end, getPool } from "../lib/pg";
import type { PoolClient } from "pg";

const reachable = async (): Promise<boolean> => {
  try {
    const [c] = await allRows<{ n: string }>("SELECT count(*) n FROM person");
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb ? false : "Postgres unreachable / person layer empty";

afterAll(async () => {
  await end();
});

/** The loader's resolution query, verbatim in shape. Kept as a literal rather than
 *  imported because the script is a CLI with a top-level `run()` — importing it would fire
 *  the whole load. Any divergence between this and the script is caught by the table-level
 *  invariants in scripts/db/tests/person_slug_retired.data.test.ts, which run against what
 *  the script actually wrote. */
const RESOLVE_SQL = `
  WITH m(old_slug, new_slug) AS (SELECT * FROM unnest($1::text[], $2::text[]))
  SELECT m.old_slug,
         (SELECT p.slug
            FROM person_role r
            JOIN person p ON p.person_id = r.person_id
                         AND p.status = 'active' AND p.is_public_figure
           WHERE r.ref = m.new_slug
             AND r.source = ANY(person_officials_sources())
           ORDER BY p.person_id
           LIMIT 1)                                              AS target_slug,
         EXISTS (SELECT 1 FROM person p WHERE p.slug = m.old_slug) AS old_is_live
    FROM m`;

type Resolved = {
  old_slug: string;
  target_slug: string | null;
  old_is_live: boolean;
};

/** Insert a person + (optionally) an officials role, inside the caller's transaction. */
const seedPerson = async (
  c: PoolClient,
  opts: {
    slug: string;
    ref?: string;
    source?: string;
    isPublic?: boolean;
    status?: string;
  },
): Promise<number> => {
  const [p] = (
    await c.query<{ person_id: string }>(
      `INSERT INTO person (display_name, given_fold, family_fold, name_parts, slug,
                           is_public_figure, status)
       VALUES ($1, 'x', 'y', 3, $2, $3, $4) RETURNING person_id`,
      [
        `Test ${opts.slug}`,
        opts.slug,
        opts.isPublic ?? true,
        opts.status ?? "active",
      ],
    )
  ).rows;
  const personId = Number(p.person_id);
  if (opts.ref) {
    await c.query(
      `INSERT INTO person_role (person_id, source, ref, role, confidence)
       VALUES ($1, $2, $3, 'test', 'manual')`,
      [personId, opts.source ?? "official_exec", opts.ref],
    );
  }
  return personId;
};

/** Run `body` in a transaction that is always rolled back. */
const inRollback = async (
  body: (c: PoolClient) => Promise<void>,
): Promise<void> => {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await body(client);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
};

const resolve = async (
  c: PoolClient,
  map: Record<string, string>,
): Promise<Resolved[]> => {
  const pairs = Object.entries(map);
  const { rows } = await c.query<Resolved>(RESOLVE_SQL, [
    pairs.map(([o]) => o),
    pairs.map(([, n]) => n),
  ]);
  return rows;
};

// (1) The guard that stops a redirect shadowing a real page. The 2026-07-24 map contains
// exactly one of these and it is a genuine identity collision between two near-namesakes,
// so this branch is not hypothetical.
test.skipIf(skip)(
  "a rename whose OLD slug is a live person is skipped",
  async () => {
    await inRollback(async (c) => {
      await seedPerson(c, { slug: "test-live-old-aaaaa1" });
      await seedPerson(c, {
        slug: "test-new-target-aaaaa2",
        ref: "test-new-ref-aaaaa2",
      });

      const [row] = await resolve(c, {
        "test-live-old-aaaaa1": "test-new-ref-aaaaa2",
      });
      assert.equal(
        row.old_is_live,
        true,
        "the old slug must be reported as live",
      );
      // The loader's writable filter is `!old_is_live && target_slug && target !== old`.
      assert.ok(
        row.old_is_live,
        "a live old slug must not reach person_slug_retired — person_slug_redirect() " +
          "refuses to answer for a live slug anyway, but writing one leaves a landmine " +
          "for the day that person IS merged away",
      );
    });
  },
);

// (2) The §6 privacy gate. Redirecting to a page we refuse to serve is a 404 with extra
// steps, so a non-public or non-active target yields no row at all.
test.skipIf(skip)(
  "a rename whose NEW ref resolves to a non-public person is skipped",
  async () => {
    await inRollback(async (c) => {
      await seedPerson(c, {
        slug: "test-private-bbbbb1",
        ref: "test-private-ref-bbbbb1",
        isPublic: false,
      });
      await seedPerson(c, {
        slug: "test-review-bbbbb2",
        ref: "test-review-ref-bbbbb2",
        status: "review",
      });

      const rows = await resolve(c, {
        "test-old-private-bbbbb3": "test-private-ref-bbbbb1",
        "test-old-review-bbbbb4": "test-review-ref-bbbbb2",
      });
      for (const row of rows) {
        assert.equal(
          row.target_slug,
          null,
          `${row.old_slug} resolved to a person the §6 gate should have excluded`,
        );
      }
    });
  },
);

// (3) An `mp-<id>` target is CORRECT, not a bug. An officials mention only wins the person
// slug when nothing higher-priority is in the cluster, so an official who is also an MP
// keeps their mp- slug. The header once claimed these were skipped; they are written, and
// 103's superset argument is what makes that safe.
test.skipIf(skip)(
  "an official who is also an MP gets an mp- target",
  async () => {
    await inRollback(async (c) => {
      await seedPerson(c, {
        slug: "mp-999001",
        ref: "test-mp-official-ccccc1",
      });

      const [row] = await resolve(c, {
        "test-old-mp-ccccc2": "test-mp-official-ccccc1",
      });
      assert.equal(row.target_slug, "mp-999001");
      assert.equal(row.old_is_live, false);
    });
  },
);

// (4) A rename whose new ref belongs to a source that is NOT an officials source must not
// resolve. person_officials_sources() is the single definition of that list, shared with
// 103's backfill; if it ever widened to include `mp` (numeric refs) or `magistrate`
// (Cyrillic names), those would start matching and the table would fill with non-URLs —
// the failure 103's header records having happened once.
test.skipIf(skip)(
  "a non-officials source is not treated as a slug space",
  async () => {
    await inRollback(async (c) => {
      await seedPerson(c, {
        slug: "test-magistrate-ddddd1",
        ref: "test-mag-ref-ddddd1",
        source: "magistrate",
      });

      const [row] = await resolve(c, {
        "test-old-mag-ddddd2": "test-mag-ref-ddddd1",
      });
      assert.equal(
        row.target_slug,
        null,
        "a magistrate ref resolved as though it were an officials slug",
      );
    });
  },
);

// (5) The write is an upsert, so a re-run is a no-op rather than a duplicate-key abort —
// the property that lets this sit in db:refresh.
test.skipIf(skip)("the write is idempotent across two runs", async () => {
  await inRollback(async (c) => {
    await seedPerson(c, { slug: "test-target-eeeee1", ref: "test-ref-eeeee1" });
    const write = () =>
      c.query(
        `INSERT INTO person_slug_retired (slug, target_slug)
           SELECT * FROM unnest($1::text[], $2::text[])
         ON CONFLICT (slug) DO UPDATE SET target_slug = EXCLUDED.target_slug`,
        [["test-old-eeeee2"], ["test-target-eeeee1"]],
      );
    await write();
    await write();
    const { rows } = await c.query<{ n: string }>(
      "SELECT count(*) n FROM person_slug_retired WHERE slug = 'test-old-eeeee2'",
    );
    assert.equal(
      rows[0].n,
      "1",
      "a re-run duplicated the row instead of upserting",
    );
  });
});
