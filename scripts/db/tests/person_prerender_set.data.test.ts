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
import { allRows, end, isServingDatabase } from "../lib/pg";
import {
  officialsForStaticPages,
  OFFICIALS_STATIC_PAGE_LIMIT,
} from "@/lib/officialCategoryLabels";
import {
  computePersonSlugs,
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

// skipIf prints a bare `↓` with no reason, so a gate that can never run here reads exactly
// like a passing one. Name it. The continuity + cap invariants are ALSO enforced as
// post-conditions inside computePersonSlugs, which is what actually runs on every mint.
if (haveDb && !isServingDatabase())
  console.warn(
    "[person_prerender_set.data.test] not the serving database — skipping the continuity " +
      "check (it resolves officials slugs against this DB and looks them up in a manifest " +
      "minted from Cloud SQL). The emitter enforces continuity itself at write time.",
  );

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
//
// SERVING DATABASE ONLY: this maps officials slugs through the connected DB's
// officials_person_slug() and looks the results up in a manifest minted from Cloud SQL.
// person_slug_lock is per-database, so against local Postgres the two name different people
// and every divergent slug reads as a dropped continuity target. See "WHICH DATABASE MAY
// WRITE THIS FILE" in emit_prerender_slugs.ts.
test.skipIf(skip || !isServingDatabase())(
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

// (1b) The EXEC prerender set stays within the officials cap (that is what holds the deploy
// ceiling flat). Local officials (card.kind === 'local') are a deliberate, staging-measured
// addition on top (docs/plans/local-person-links-v1.md Phase 4), so they are excluded here.
test.skipIf(skip)(
  "the exec prerender set stays within the officials cap",
  async () => {
    const manifest = JSON.parse(
      fs.readFileSync(MANIFEST, "utf-8"),
    ) as PersonSlugEntry[];
    const execPrer = manifest.filter(
      (e) => e.prerender && e.card?.kind !== "local",
    );
    assert.ok(
      execPrer.length <= OFFICIALS_STATIC_PAGE_LIMIT,
      `${execPrer.length} exec prerendered exceeds the ${OFFICIALS_STATIC_PAGE_LIMIT} cap — the ` +
        `deploy file ceiling (§0.5) is not being held flat`,
    );
    // Every prerender entry must carry a card, or buildPersonRoutes emits nothing for it.
    const cardless = manifest.filter((e) => e.prerender && !e.card);
    assert.deepEqual(
      cardless.map((e) => e.slug).slice(0, 5),
      [],
      `${cardless.length} prerender entries have no card — the prerenderer skips them, so ` +
        `the sitemap <loc> would point at a page that was not built (soft-404)`,
    );
  },
);

// (2) Determinism: two consecutive computations produce the identical prerender set.
// Catches a dropped ORDER BY / tiebreak, which churns the manifest silently.
//
// computePersonSlugs, NOT emitPersonSlugs: this gate runs under test:data against the LOCAL
// Postgres, and emitting would WRITE data/person/prerender_slugs.json from a database that
// does not serve prod. That is how 640 local-only slugs got into the committed manifest —
// see "WHICH DATABASE MAY WRITE THIS FILE" in emit_prerender_slugs.ts. A test must not
// mutate the artifact it is checking.
test.skipIf(skip)("two emits produce an identical prerender set", async () => {
  const set = (p: PersonSlugEntry[] | null): string[] =>
    (p ?? [])
      .filter((e) => e.prerender)
      .map((e) => e.slug)
      .sort();
  const first = set(await computePersonSlugs());
  const second = set(await computePersonSlugs());
  assert.deepEqual(
    second,
    first,
    "the prerender set differs between two runs — the top-N boundary is non-deterministic",
  );
});
