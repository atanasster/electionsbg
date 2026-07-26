// The /person prerender selection (T1.4). The manifest scripts/person/emit_prerender_slugs.ts
// writes decides which /person pages get a static, indexable body — and getting the SET
// wrong is silent: the count stays net-neutral while individual indexed URLs quietly lose
// their SEO body to a soft-404. Two invariants, both learned the hard way in review:
//
//   1. CONTINUITY. Every person the retired /officials top-N pages 301 to MUST be in the
//      prerender set, or that redirect lands on the bare SPA shell. Count-neutral is not
//      set-neutral: 5,000 officials POSITIONS collapse to ~4,487 PERSONS, and a fresh
//      person-grain top-5,000 dropped 114 of them near the boundary. The emitter now
//      force-includes the old set's redirect targets; this pins that it worked.
//   2. DETERMINISM. The top-N boundary must be reproducible across matview refreshes, or
//      the manifest, the prerendered pages and the sitemap churn run-to-run. Guaranteed by
//      the ORDER BY + officialsForStaticPages's slug tiebreak.
//
// Auto-skips when Postgres is down or unloaded — like the other *.data.test.ts gates.
//
//   npm run test:data

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";
import {
  officialsForStaticPages,
  OFFICIALS_STATIC_PAGE_LIMIT,
} from "@/lib/officialCategoryLabels";
import {
  emitPersonSlugs,
  type PersonSlugEntry,
} from "../../person/emit_prerender_slugs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const MANIFEST = path.join(ROOT, "data/person/prerender_slugs.json");
const OLD_RANKINGS = path.join(ROOT, "data/officials/assets-rankings.json");

const reachable = async (): Promise<boolean> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regproc('officials_person_slug') IS NOT NULL AS ok",
    );
    if (!t?.ok) return false;
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM officials_rankings_table WHERE is_exec",
    );
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb ? false : "Postgres unreachable / officials_rankings empty";

afterAll(async () => {
  await end();
});

const prerenderSlugs = (): Set<string> => {
  const manifest = JSON.parse(
    fs.readFileSync(MANIFEST, "utf-8"),
  ) as PersonSlugEntry[];
  return new Set(manifest.filter((e) => e.prerender).map((e) => e.slug));
};

// (1) Continuity — the invariant the plan actually requires ("no indexed URL loses its
// SEO body"). Every person the retired officials top-N maps to is prerendered.
test.skipIf(skip)(
  "the prerender set covers every person the retired officials top-N mapped to",
  async () => {
    if (!fs.existsSync(OLD_RANKINGS)) return; // continuity source retired (post-T1.5)
    const old = JSON.parse(fs.readFileSync(OLD_RANKINGS, "utf-8")) as {
      topOfficials?: {
        slug: string;
        category: "hospital_head"; // widened by the helper's generic; shape only
        netWorthEur?: number | null;
      }[];
    };
    const oldSlugs = officialsForStaticPages(
      old.topOfficials ?? [],
      OFFICIALS_STATIC_PAGE_LIMIT,
    ).map((o) => o.slug);
    const mapped = await allRows<{ person_slug: string | null }>(
      `SELECT DISTINCT officials_person_slug(s) AS person_slug
         FROM unnest($1::text[]) AS s`,
      [oldSlugs],
    );
    // A continuity person only counts if they still have a card (still an active, public
    // exec official) — one who lost that is correctly allowed to drop.
    const [{ n: withCard }] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM officials_rankings_table WHERE is_exec`,
    );
    assert.ok(Number(withCard) > 0, "no exec officials to check against");

    const prer = prerenderSlugs();
    const cardSlugs = new Set(
      (
        await allRows<{ slug: string }>(
          "SELECT slug FROM officials_rankings_table WHERE is_exec",
        )
      ).map((r) => r.slug),
    );
    const dropped = mapped
      .map((m) => m.person_slug)
      .filter((s): s is string => !!s && cardSlugs.has(s))
      .filter((s) => !prer.has(s));
    assert.deepEqual(
      dropped.slice(0, 5),
      [],
      `${dropped.length} persons the retired officials pages 301 to are NOT prerendered — ` +
        `their /officials URL now soft-404s at /person. The continuity union in ` +
        `emit_prerender_slugs.ts has regressed.`,
    );
  },
);

// (1b) …and still net-neutral: the set never exceeds the cap it replaces.
test.skipIf(skip)(
  "the prerender set stays within the officials cap",
  async () => {
    const prer = prerenderSlugs();
    assert.ok(
      prer.size <= OFFICIALS_STATIC_PAGE_LIMIT,
      `${prer.size} prerendered exceeds the ${OFFICIALS_STATIC_PAGE_LIMIT} cap — the deploy ` +
        `file ceiling (§0.5) is not being held flat`,
    );
    // Every prerender entry must carry a card, or buildPersonRoutes emits nothing for it.
    const manifest = JSON.parse(
      fs.readFileSync(MANIFEST, "utf-8"),
    ) as PersonSlugEntry[];
    const cardless = manifest.filter((e) => e.prerender && !e.card);
    assert.deepEqual(
      cardless.map((e) => e.slug).slice(0, 5),
      [],
      `${cardless.length} prerender entries have no card — the prerenderer skips them, so ` +
        `the sitemap <loc> would point at a page that was not built (soft-404)`,
    );
  },
);

// (2) Determinism: two consecutive emits produce the identical prerender set. Catches a
// dropped ORDER BY / tiebreak, which churns the manifest silently.
test.skipIf(skip)("two emits produce an identical prerender set", async () => {
  await emitPersonSlugs();
  const first = [...prerenderSlugs()].sort();
  await emitPersonSlugs();
  const second = [...prerenderSlugs()].sort();
  assert.deepEqual(
    second,
    first,
    "the prerender set differs between two runs — the top-N boundary is non-deterministic",
  );
});
