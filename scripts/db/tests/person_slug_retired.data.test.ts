// The two T1.4 prerequisites recorded in docs/plans/persons-pg-retirement-v1.md:
// retired-/person-slug redirects (103), and the bound on Bridge-B growth.
//
// Both exist because T0.1b merged 154 person rows. That merge was correct, but it had two
// consequences that only become dangerous when T1.4 prerenders and sitemaps /person:
//
//   1. The 154 losing slugs began 404ing with nothing to redirect them. Harmless while
//      /person is unpublished; the moment those URLs are indexed, bookmarked, or sitting in
//      the browser-local watchlist (which stores slugs, T3.10), the NEXT merge silently
//      breaks indexed pages. Migration 099 exists to stop a slug DRIFTING; nothing stopped
//      one from disappearing.
//   2. Bridge-B roles grew +151, because collapsing duplicate person rows makes their name
//      fold people-unique and the bridge stops abstaining. That is the guard working rather
//      than loosening — but it is the defamation-sensitive surface, so the bound is pinned
//      here rather than assumed.
//
// Auto-skips when Postgres is down or unloaded — like the other *.data.test.ts gates.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";

// Gated on Postgres being REACHABLE, not on migration 103 having been applied. Folding
// "table missing" into the skip — the obvious shape — makes a never-applied migration
// indistinguishable from "the database is down", and every assertion below skips GREEN.
// The person probe already establishes that PG is up, so a missing table is a FAILURE.
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

// ---- retired slug redirects (103) -------------------------------------------

// A redirect must never shadow a live page. This is the invariant that makes it safe to
// seed the table generously: person_slug_redirect() only answers for slugs that resolve to
// nobody, so a wider seed can never turn a real person's page into a 301.
test.skipIf(skip)("a live slug never redirects", async () => {
  const [n] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM person p
      WHERE person_slug_redirect(p.slug) IS NOT NULL`,
  );
  assert.equal(
    Number(n.n),
    0,
    "a live person's slug resolves to a redirect — person_slug_redirect would 301 a real page away",
  );
});

// Every redirect must land somewhere real. A retired slug pointing at another dead slug is
// a 404 with extra steps, and it is exactly what a merge chain (A→B, later B→C) produces if
// the mapping is not recomputed against the final person.
test.skipIf(skip)("every redirect target is a live person", async () => {
  const dead = await allRows<{ slug: string; target_slug: string }>(
    `SELECT r.slug, r.target_slug FROM person_slug_retired r
      WHERE NOT EXISTS (SELECT 1 FROM person p WHERE p.slug = r.target_slug)
      LIMIT 5`,
  );
  assert.deepEqual(
    dead,
    [],
    "retired slugs point at targets that do not exist — a merge chain was not resolved to the final person",
  );
});

// EXISTENCE IS NOT ENOUGH, and the gate above cannot tell the difference. A person
// row can exist while being unservable (status <> 'active', or not a public
// figure): §6 refuses those, and person_slug_redirect() / officials_person_slug()
// return NULL for them. So a redirect re-pointed at one passes the existence check
// above while still 301ing into a 404 — the check turns green and the visitor's
// experience does not change. That is precisely the shape collapse_slug_chains.ts
// would have introduced had it judged liveness by existence, so pin the stronger
// invariant here rather than trusting the writer to keep choosing correctly.
test.skipIf(skip)("every redirect target is actually SERVABLE", async () => {
  const unservable = await allRows<{ slug: string; target_slug: string }>(
    `SELECT r.slug, r.target_slug FROM person_slug_retired r
      WHERE NOT EXISTS (
              SELECT 1 FROM person p
               WHERE p.slug = r.target_slug
                 AND p.status = 'active' AND p.is_public_figure)
      LIMIT 5`,
  );
  assert.deepEqual(
    unservable,
    [],
    "retired slugs point at people we refuse to serve — the 301 lands on a 404, " +
      "which the existence check above cannot see",
  );
});

// Only slugs. mp refs are numeric ids, candidate refs are '{election}:mp-{id}' and
// magistrate refs are the declarant's Cyrillic name — none was ever a URL, and seeding them
// put 3,113 names like "Мария Венциславова Милушева" into this table on the first attempt.
//
// The trailing hash is BASE36, not hex: `hash6` in resolve_persons.ts is
// `h.toString(36).slice(0, 6)`. The pattern read `[0-9a-f]{6}` while this table held only
// officials slugs, whose hashes happen to be hex — but that rejects 42,654 of the 114,983
// live person slugs, e.g. `rosen-rusev-a0a8lm`. It first bit when the 2007 de-duplication
// retired 112 name-hash slugs. An optional `-<n>` tail is the resolver's collision suffix
// (`angel-petrov-11iyk1-2`).
//
// Two more live shapes the hash pattern alone does not describe, both found by asking the
// `person` table what it actually serves rather than by reasoning about the slug builder —
// the same way the base36 fix above was found, and the reason this test now derives its
// alternation from that question instead of a guess:
//
//   - `mp-<id>` is the ANCHOR slug a person keyed to a parliament seat keeps
//     (resolve_persons.ts ~1446). 2,193 live persons carry it, e.g. `/person/mp-10`
//     (Ангел Вълчев Тюркеджиев) — there is no name-hash segment at all. Retiring one is
//     therefore correct and must not read as corruption; §A3's continuity merge retired 13.
//   - The collision suffix can STACK (`…-1c2334-2-3`, `…-18v2cg-2-2`) when a slug that
//     already carried one collides again. 11 live persons are on such a slug, so the tail
//     repeats rather than appearing at most once.
//
// Still narrow enough to catch everything the header names: a Cyrillic name has no matching
// characters, a candidate ref carries a colon, and a bare numeric id matches neither branch
// (the `mp-` one requires the literal prefix).
//
// Held in pieces because the name-body comparison at the foot of this file needs the SAME
// grammar read the other way round, and the two drifted once already: the hash was fixed to
// base36 here and left hex there, so every base36 hash carrying a letter past `f` stayed
// glued to the name body and no such row could ever match its target.
const NAME_BODY = String.raw`[a-z0-9]+(-[a-z0-9]+)*`;
const HASH = String.raw`[a-z0-9]{6}`;
const COLLISION = String.raw`(-[0-9]+)*`;
const SLUG_SHAPE = String.raw`^(${NAME_BODY}-${HASH}|mp-[0-9]+)${COLLISION}$`;

// The name body alone — the slug MINUS its hash and every collision suffix. `\1` is the
// capture, so `regexp_replace(slug, NAME_BODY_ONLY, '\1')` yields the body and returns an
// `mp-<id>` anchor (which has no name body) unchanged — ids run to 4 digits, so none is
// mistakable for a 6-character hash. Those rows are excluded from the comparison anyway.
//
// It matches the WHOLE slug rather than anchoring at the tail, and that is load-bearing
// rather than stylistic. A tail pattern `(-[a-z0-9]{6})?(-[0-9]+)*$` has two parses of
// `blagomir-rubinov-kotsev-549167`, because a 6-digit hash is also a valid collision suffix
// and `kotsev` is also a valid hash — and the one it prefers eats the surname, reading a
// pure re-hash as a 3-part→2-part rename. It is not a corner: hex hashes are all-digit 6% of
// the time and Bulgarian `-ov`/`-ev` surnames transliterate to exactly six characters
// constantly, so it mis-read 482 rows here. Anchoring at `^` forces the hash to be the last
// segment before the suffixes, which is what the grammar actually says.
const NAME_BODY_ONLY = String.raw`^(${NAME_BODY})-${HASH}${COLLISION}$`;

test.skipIf(skip)("only slug-shaped keys are stored", async () => {
  const bad = await allRows<{ slug: string }>(
    `SELECT slug FROM person_slug_retired WHERE slug !~ $1 LIMIT 5`,
    [SLUG_SHAPE],
  );
  assert.deepEqual(bad, [], "non-slug keys reached the redirect table");
});

// The pattern above is only trustworthy while it still describes what `person` serves. A
// slug shape invented later (or a builder change) would otherwise be caught here as
// "corruption" on its first retirement, exactly as `mp-*` was — a failure that points at the
// test rather than at the data, which is the most expensive kind to debug.
test.skipIf(skip)(
  "the slug-shape pattern still matches every live person slug",
  async () => {
    const bad = await allRows<{ slug: string }>(
      `SELECT slug FROM person WHERE slug !~ $1 LIMIT 5`,
      [SLUG_SHAPE],
    );
    assert.deepEqual(
      bad,
      [],
      "live /person slugs do not match SLUG_SHAPE — widen it (and check the redirect assertion above still means what it says)",
    );
  },
);

// Migration 103 must actually be applied. With PG proven up, a missing table is a failure,
// not a reason to skip.
test.skipIf(skip)("migration 103 is applied", async () => {
  const [t] = await allRows<{ ok: boolean }>(
    "SELECT to_regclass('public.person_slug_retired') IS NOT NULL AS ok",
  );
  assert.ok(
    t?.ok,
    "person_slug_retired does not exist — migration 103 was never applied",
  );
});

// The mapping is not empty — an empty table means the resolver hook and the backfill both
// silently did nothing, which looks identical to "no merges have happened yet".
test.skipIf(skip)("the redirect mapping is populated", async () => {
  const [n] = await allRows<{ n: string }>(
    "SELECT count(*) n FROM person_slug_retired",
  );
  assert.ok(
    Number(n.n) > 0,
    "person_slug_retired is empty — neither the backfill nor the resolver hook wrote anything",
  );
});

// THE T1.4 BLOCKER, pinned. Every slug the lock has ever served must either belong to a
// live person or have a redirect — that is the whole contract, and it was violated for
// 20,057 slugs while every other assertion in this file passed.
//
// The hole was structural, not a typo: the resolver computes retirements by diffing the
// lock keyed on mention_id, and an officials mention id IS `official:<slug>`. A re-slug
// therefore ORPHANS the old lock row instead of diffing it — a new row appears under the
// new mention id, and nothing ever revisits the old one. `officialSlug()` rehashes on any
// register re-spelling (a re-cased name, a dropped "д-р"), so this recurs; it is not a
// one-off of the 2026-07-24 canonical-slug migration.
//
// It stayed invisible because /person is neither prerendered nor sitemapped yet. T1.4
// changes exactly that, which is why this assertion has to exist BEFORE those 5,000 pages
// are published rather than after Google has collected the 404s.
//
// Fix when this fails: FIRST find out which source the orphans came from —
//
//   SELECT split_part(l.mention_id, ':', 1) AS source, count(DISTINCT l.slug)
//     FROM person_slug_lock l
//    WHERE NOT EXISTS (SELECT 1 FROM person p WHERE p.slug = l.slug)
//      AND NOT EXISTS (SELECT 1 FROM person_slug_retired r WHERE r.slug = l.slug)
//    GROUP BY 1;
//
// because the two causes need OPPOSITE fixes and the officials one used to be documented
// here as if it were the only one:
//
//   * `official_exec` / `official_muni` — a re-slug. The human is still in the corpus under
//     a new ref, so a redirect exists and is mandatory: rebuild the map with
//     `migrate_slug_normalisation.ts --redirects <map>` and load it with
//     `npm run person:slug-redirects -- <map>`.
//   * `magistrate` — a ROSTER TURNOVER, and that path cannot fix it. It is officials-only
//     twice over: load_slug_redirects.ts rejects the keys outright (OFFICIALS_SLUG wants a
//     6-HEX hash, and these carry resolve_persons.ts's base36 one — `albena-koleva-ugig7i`),
//     and it resolves targets through person_officials_sources(). There is also nothing to
//     redirect TO: measured 2026-08-11, 439 of 454 had no person row, no person_role and no
//     declaration anywhere, and the other 15 had only NAMESAKES ("Николай Иванов Николов" is
//     ~17 distinct people), so a name-matched redirect would attribute one human's judicial
//     record to another. The cause is upstream — see the roster comment in
//     scripts/judiciary/__write_magistrate_holdings.ts. The magistrate roster must RETAIN
//     departed magistrates at their last filing; if this fires for `magistrate` again, that
//     retention has regressed. magistrate_roster_retention.data.test.ts pins it directly and
//     will fail first.
//
// Liveness is read from `person` here, and from the in-memory `liveSlugs` in
// resolve_persons.ts's sibling warning. That difference is deliberate, not drift: the
// resolver runs BEFORE it rebuilds `person`, so the table still holds the previous run's
// rows and would mask the orphan the current run just created. By the time this test runs,
// the rebuild has happened and `person` is the truth.
test.skipIf(skip)(
  "no slug the lock has served is dead without a redirect",
  async () => {
    const orphans = await allRows<{ slug: string }>(
      `SELECT DISTINCT l.slug
       FROM person_slug_lock l
      WHERE NOT EXISTS (SELECT 1 FROM person p WHERE p.slug = l.slug)
        AND NOT EXISTS (SELECT 1 FROM person_slug_retired r WHERE r.slug = l.slug)
      LIMIT 5`,
    );
    assert.deepEqual(
      orphans,
      [],
      "lock slugs have no live person and no redirect — /person URLs that once resolved " +
        "now 404. See scripts/person/load_slug_redirects.ts",
    );
  },
);

// The redirect table has to be big enough to actually cover the re-slug, not just the 154
// merge-derived rows T1.4a seeded. A regression that reverted the backfill would leave the
// table populated (so the assertion above about non-emptiness still passes) while 20k URLs
// silently 404 again — the count is what tells the two apart.
test.skipIf(skip)(
  "the re-slug backfill is present, not just the merge seed",
  async () => {
    const [n] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM person_slug_retired",
    );
    // Half of the 20,767 the re-slug contributed: loose enough that ordinary merge churn
    // never trips it, tight enough that losing the backfill always does — without it the
    // table falls back to 103's own 2,347-row merge seed.
    assert.ok(
      Number(n.n) > 10000,
      `person_slug_retired holds only ${n.n} rows — the 2026-07-24 officials re-slug ` +
        `contributed 20,767, so the backfill has been lost. Restore it with:\n` +
        `  npm run person:slug-redirects -- raw_data/person/officials_reslug_2026_07_24.json`,
    );
  },
);

// ---- Bridge-B bounds --------------------------------------------------------

// Bridge-B attaches a name-matched company footprint to a person, so its guards are the
// thing standing between a public figure and someone else's companies. Two of them are
// load-bearing and neither is enforced by a constraint: the fold must map to exactly ONE
// person, and the footprint must be within FOOTPRINT_CAP. If either stops excluding
// anything, the bridge has silently widened.
test.skipIf(skip)(
  "the Bridge-B footprint cap still excludes people",
  async () => {
    const [row] = await allRows<{ over: string; within: string }>(
      `WITH elig AS (
       SELECT p.person_id, p.name_fold
         FROM person p
        WHERE p.name_parts = 3 AND p.is_public_figure
          AND NOT EXISTS (SELECT 1 FROM person p2
                           WHERE p2.name_fold = p.name_fold
                             AND p2.person_id <> p.person_id)
     ),
     counted AS (
       SELECT e.person_id,
              (SELECT count(DISTINCT t.uic) FROM tr_person_roles t
                WHERE t.name_fold = e.name_fold) AS n
         FROM elig e
     )
     SELECT count(*) FILTER (WHERE n > 5)            AS over,
            count(*) FILTER (WHERE n BETWEEN 1 AND 5) AS within
       FROM counted`,
    );
    assert.ok(
      Number(row.over) > 0,
      "the <=5 company cap excludes nobody — FOOTPRINT_CAP has been raised or removed, and large name-matched footprints are now attaching to people",
    );
    assert.ok(
      Number(row.within) > 0,
      "no person is within the cap — the bridge is attaching nothing at all",
    );
  },
);

// The people-uniqueness guard. A fold carrying two persons must never be eligible: that is
// the case where a name-matched company genuinely cannot be attributed. This is also the
// guard whose behaviour CHANGED in T0.1b — merging duplicates made folds unique and the
// bridge correctly stopped abstaining — so it is worth pinning that it still abstains where
// it should.
test.skipIf(skip)("ambiguous folds stay out of Bridge-B", async () => {
  const [n] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM (
       SELECT name_fold FROM person
        WHERE name_parts = 3 AND is_public_figure
        GROUP BY name_fold HAVING count(*) > 1) x`,
  );
  assert.ok(
    Number(n.n) > 0,
    "every 3-part public fold is now people-unique — either the corpus changed shape or the uniqueness guard is no longer excluding anyone",
  );
});

// A redirect landing on *a* live servable person is not the same as landing on the RIGHT
// one. Every assertion above would pass for a map loaded against the wrong corpus: each row
// would still point at a real, servable, wrong human. This is the cheap structural check
// that distinguishes them — an officials slug's body is its name, so a rename should almost
// always preserve it.
//
// Measured 2026-08-11 over the 24,574 non-mp rows: 24,289 agree (98.8%) — 23,546 on the
// name body outright, 743 more once a patronymic is allowed to appear (see below). mp-*
// targets are excluded: their body is an id, not a name, so the comparison is meaningless
// for them.
//
// The 285 residuals are NOT one class, and the majority is not what this comment used to
// claim. ~206 are the same patronymic merge as the 743 with a TRANSLITERATION difference on
// top, because the two slug builders disagree on `й` and `ъ` — `stoil-stoychev` →
// `stoil-vasilev-stoichev`, `valentin-yordanov` → `valentin-vasilev-iordanov`,
// `aleksandar-minev` → `aleksandr-duhomirov-minev`. The rest are the genuinely-renamed shapes
// the original note describes (a dropped "д-р" title, a register typo corrected
// Руфат→Руфад, a real surname change asena-hristova-stoimenova-* →
// asena-hristova-serbezova-*), plus 7 rows whose SOURCE is an `mp-<id>` anchor and so has no
// name body to compare either.
//
// Modelling the transliteration too is deliberately NOT done: this is the cheap structural
// check, and a second transliteration table maintained here would be a third copy of a rule
// that already exists twice in the slug builders.
test.skipIf(skip)(
  "retired slugs redirect to a person of the same name",
  async () => {
    // Agreement is checked on the NAME BODY — the slug minus its hash and collision
    // suffixes (NAME_BODY_ONLY). Stripping only the hash mis-reads
    // `abil-ismet-abil-ae3d82-2` as a different name from `abil-ismet-abil-ae3d82` and
    // scores an obviously-correct `X-2 → X` redirect as a mismatch; a merge wave surfaced
    // 383 of those at once, all verified to be the collision shape with ZERO
    // genuinely-different names among them.
    //
    // A 2-part body also agrees with a 3-part target that keeps it as its OUTER pair —
    // `abidin-hadzhimehmed` → `abidin-mehmed-hadzhimehmed`, `adrian-adamov` →
    // `adrian-valentinov-adamov`. That is one human acquiring the patronymic the register
    // had omitted, and the body comparison cannot model an insertion in the middle; 743 rows
    // are this. Given AND family must both survive, so it never merges `angel-angelov` into
    // some other Angelov: it admits a strictly-more-specified name, not a similar one.
    const [r] = await allRows<{ agree: string; total: string }>(
      `WITH body AS (
         SELECT string_to_array(regexp_replace(r.slug,        $1, '\\1'), '-') AS s,
                string_to_array(regexp_replace(r.target_slug, $1, '\\1'), '-') AS t
           FROM person_slug_retired r
          WHERE r.target_slug NOT LIKE 'mp-%'
       )
       SELECT count(*) FILTER (
                WHERE s = t
                   OR (cardinality(s) = 2 AND cardinality(t) = 3
                       AND s[1] = t[1] AND s[2] = t[3])) AS agree,
              count(*) AS total
         FROM body`,
      [NAME_BODY_ONLY],
    );
    const ratio = Number(r.agree) / Number(r.total);
    // 98.8% measured, so this fires at ~491 disagreeing rows against today's 285 — enough
    // headroom for ordinary rename churn, tight enough that a map loaded against the wrong
    // corpus (which sends the ratio to near zero) can never sit under it. When it does fire,
    // read the disagreements before touching the floor: `s` vs `t` above is the whole
    // diagnostic, and every class found so far was a gap in this comparison rather than a
    // bad redirect.
    assert.ok(
      ratio > 0.98,
      `only ${r.agree}/${r.total} retired slugs share a name body with their target ` +
        `(${(ratio * 100).toFixed(1)}%) — a redirect map loaded against the wrong corpus ` +
        `sends this to near zero`,
    );
  },
);
