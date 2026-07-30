// Collapse merge chains in person_slug_retired, so every redirect lands on a LIVE
// person in one hop.
//
// WHY THIS IS NEEDED, and why neither writer can do it alone. Two things write
// person_slug_retired, and both write only the pairs they personally know about:
//
//   * load_slug_redirects.ts resolves the NEW slug of the map it was handed, and
//   * resolve_persons.ts upserts the retirements its lock diff produced.
//
// Neither revisits rows an EARLIER run wrote. So when a later run retires a slug
// that was already somebody's target, the earlier row is silently left pointing at
// a slug that is now dead:
//
//   2026-07-24 map:  …ivanov1-da0219 -> …ivanov1-94805e     (94805e live then)
//   2026-07-29 map:  …ivanov1-94805e -> …ivanov-b85a89      (94805e now retired)
//   result:          …ivanov1-da0219 -> …ivanov1-94805e     → 404 with extra steps
//
// CLAUDE.md says the dated maps "compose" because the loader upserts. They compose
// in the sense that rows accumulate — not in the sense that older targets stay
// valid, which is the part that matters to a visitor. This is the missing half.
//
// Idempotent, cheap, and safe to call after every write: on a corpus with no chains
// it updates nothing.

import { allRows } from "../db/lib/pg";

/** Chains are pathological past a couple of hops; the bound is what makes a cycle
 *  (A→B→A, which a split override could produce) terminate instead of spin. */
const MAX_DEPTH = 16;

/**
 * What counts as a usable redirect target. NOT bare existence in `person`.
 *
 * ⚠️ This is the §6 privacy gate, and it has to match
 * load_slug_redirects.ts's own target resolution and 103's serving functions
 * exactly. A person row can exist while being unservable (`status <> 'active'` or
 * not a public figure), and `officials_person_slug()` / `person_slug_redirect()`
 * return NULL for those — so re-pointing a chain at one produces a redirect that
 * still 404s, while the data gate (which only checks existence in `person`) turns
 * GREEN. That is strictly worse than the broken row it replaces: it trades a loud
 * failure for a silent one. Measured: using bare existence flipped the gate 1 → 0
 * while the serving function still returned NULL.
 */
const SERVABLE = `p.status = 'active' AND p.is_public_figure`;

export type ChainCollapse = {
  /** Rows re-pointed at the live end of their chain. */
  repointed: number;
  /** How many rows still point at an unservable target — the TRUE total, not the
   *  length of the sample below. */
  stillDeadCount: number;
  /** A handful of the above, for the message. Judged by SERVABLE, not by bare
   *  existence. */
  stillDead: { slug: string; target_slug: string }[];
};

/**
 * Re-point every retired slug whose target is itself retired at the first LIVE
 * person its chain reaches.
 *
 * Walks only from rows that are actually broken (target not servable but IS a
 * retired slug), so the recursion starts from a handful of rows rather than all
 * ~23k. Picks the SHALLOWEST servable target — "follow the redirects until a real
 * page" — and never writes a target we would refuse to serve, so a chain that
 * dead-ends is reported rather than papered over with a guess.
 */
export const collapseSlugRedirectChains = async (): Promise<ChainCollapse> => {
  const updated = await allRows<{ slug: string }>(
    `WITH RECURSIVE walk(slug, target, depth) AS (
       SELECT r.slug, r.target_slug, 1
         FROM person_slug_retired r
        WHERE NOT EXISTS (
                SELECT 1 FROM person p WHERE p.slug = r.target_slug AND ${SERVABLE})
          AND EXISTS (SELECT 1 FROM person_slug_retired h WHERE h.slug = r.target_slug)
       UNION ALL
       SELECT w.slug, h.target_slug, w.depth + 1
         FROM walk w
         JOIN person_slug_retired h ON h.slug = w.target
        WHERE w.depth < $1
          -- Do not walk back onto the row we started from: a two-node cycle would
          -- otherwise burn the whole depth budget.
          AND h.target_slug <> w.slug
     ),
     landing AS (
       SELECT DISTINCT ON (w.slug) w.slug, w.target
         FROM walk w
        WHERE EXISTS (
                SELECT 1 FROM person p WHERE p.slug = w.target AND ${SERVABLE})
        ORDER BY w.slug, w.depth
     )
     UPDATE person_slug_retired r
        SET target_slug = l.target
       FROM landing l
      WHERE r.slug = l.slug
        AND r.target_slug IS DISTINCT FROM l.target
      RETURNING r.slug`,
    // Bound as a parameter rather than interpolated. It is a module numeric const
    // today, so interpolation is safe — but this is the shape that stops being
    // safe the moment someone makes the depth configurable from a CLI flag.
    [MAX_DEPTH],
  );

  // Reported against the SERVABLE definition, which is a superset of the data
  // gate's bare-existence check — so this warns about rows the gate would pass but
  // that still 301 into a page we refuse to serve.
  const stillDead = await allRows<{ slug: string; target_slug: string }>(
    `SELECT r.slug, r.target_slug
       FROM person_slug_retired r
      WHERE NOT EXISTS (
              SELECT 1 FROM person p WHERE p.slug = r.target_slug AND ${SERVABLE})
      ORDER BY r.slug
      LIMIT 5`,
  );

  // Counted separately from the sample: `stillDead.length` maxes out at the LIMIT,
  // so reporting it as the total would silently cap every warning at "5".
  const [{ n }] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM person_slug_retired r
      WHERE NOT EXISTS (
              SELECT 1 FROM person p WHERE p.slug = r.target_slug AND ${SERVABLE})`,
  );

  return { repointed: updated.length, stillDeadCount: Number(n), stillDead };
};

/** Run the collapse and report it the way the two callers already report their own
 *  counts. Kept here so both log the same thing. */
export const collapseSlugRedirectChainsVerbose = async (): Promise<void> => {
  const { repointed, stillDeadCount, stillDead } =
    await collapseSlugRedirectChains();
  if (repointed)
    console.log(
      `  ${repointed} redirect(s) re-pointed past a retired target (merge chain collapsed)`,
    );
  // Warn rather than throw: person_slug_retired.data.test.ts is the gate that
  // fails the pipeline on this, and it reports every row rather than a sample.
  if (stillDeadCount)
    console.warn(
      `  ⚠ ${stillDeadCount} redirect(s) still target a slug we will not serve — the ` +
        `chain has no active + public end, so these 301 into a 404 ` +
        `(e.g. ${stillDead
          .slice(0, 3)
          .map((r) => `${r.slug} -> ${r.target_slug}`)
          .join(", ")})`,
    );
};
