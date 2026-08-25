// Tier-3 (Postgres-native) invariants over the resolved person tables — the §7d
// migration-safety gate for the person resolver (scripts/person/resolve_persons.ts).
// Asserts the data-version-independent rules that must hold no matter which sources
// were resolved, most importantly the zero-false-public-merge invariant.
//
//   npm run test:data
//
// Requires the Postgres store + a resolver run (`npx tsx scripts/person/resolve_persons.ts`);
// auto-skips when Postgres is unreachable or the person table is absent/empty — so CI
// (no container) skips it, exactly like the other *.data.test.ts gates.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";
// BRIDGE_B_CTE is gone: this file no longer re-derives a footprint from the seven-table join
// the resolver attaches through — see the note below for why that question was unanswerable
// here. FOOTPRINT_CAP and TIER_V_SERVED_IDENTITIES_SQL stay, and both are THRESHOLDS/VOCABULARIES
// with one home: the stored footprint is still checked against the cap, and the identity-class
// test below is the second consumer tierV.ts exists to keep in step with the resolver.
import { FOOTPRINT_CAP } from "../../person/bridgeB";
import { TIER_V_SERVED_IDENTITIES_SQL } from "../../person/tierV";
import { reportSkip } from "../../lib/report_skip";

const reachable = async (): Promise<boolean> => {
  try {
    await allRows("SELECT 1");
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.person') IS NOT NULL AS ok",
    );
    if (!t?.ok) return false;
    const [c] = await allRows<{ n: string }>("SELECT count(*) n FROM person");
    return Number(c.n) > 0; // resolver has run
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb ? false : "Postgres unreachable / person table empty";
reportSkip(import.meta.url, skip);

afterAll(async () => {
  await end();
});

// The headline invariant: a person that merges roles from DIFFERENT sources on a common
// name (namesake_risk > 1) must be licensed by a NAME-INDEPENDENT link — either a GOLD KEY
// (some role confidence='exact_id', a shared parliament MP id) or a SHARED-COMPANY bridge
// (a `tr` role). A cross-source merge is the defamation-critical one — it claims "this
// donor IS this magistrate", "this candidate IS this official" — so on a colliding fold a
// name-based corroborant (party+place) never licenses it; only the name-independent ones
// do. A `tr` role is such a proof: a TR mention has no hardId, no party/place, and Tier-2
// needs namesake<=1, so at namesake>1 it could ONLY have merged via the strong shared-uic
// corroborant (see scripts/person/cluster.ts). (A SAME-source common-name merge — one
// candidate with several candidacies for the same party+oblast, patronymic-consistent — is
// allowed: it only asserts "ran more than once", and the patronymic-conflict veto keeps
// genuinely different people apart.)
//
// ONE name-based exception, added deliberately: the party-office licence. A NATIONAL PARTY
// OFFICE (the register's `party_leader` category — chair, deputy, statutory representative)
// is held by a handful of people per party, so an IDENTICAL full name sharing a canonical
// party with such a seat identifies a person the way party+place cannot. It is the only
// evidence available for the class it exists for: a party chair or a minister has an
// institution and no oblast, so weak-both can never fire, and Слави Трифонов's declared
// wealth sat on a person row disjoint from /person/mp-3056 for exactly that reason. The
// carve-out is re-derived from the DATA, not asserted — the officer role and another
// source's role must agree on the same canonical party — and stays capped at the
// PARTY_OFFICE_NAMESAKE_CAP in cluster.ts, so a mass name ("Георги Иванов Георгиев", 198)
// is still refused however well the party matches.
test.skipIf(skip)(
  "no cross-source merge on a common name without a name-independent link",
  async () => {
    const [r] = await allRows<{ bad: string }>(
      `SELECT count(*) bad
         FROM (SELECT person_id FROM person_role GROUP BY 1
                HAVING count(DISTINCT source) > 1) m
         JOIN person p USING (person_id)
        WHERE p.namesake_risk > 1
          AND NOT EXISTS (
            SELECT 1 FROM person_role r
             WHERE r.person_id = p.person_id
               AND (r.confidence = 'exact_id' OR r.source IN ('tr', 'ngo')))
          AND NOT EXISTS (
            SELECT 1 FROM person_role office
              JOIN person_role other
                ON other.person_id = office.person_id
               AND other.source <> office.source
               AND other.party = office.party
             WHERE office.person_id = p.person_id
               AND office.role = 'party_leader'
               AND office.party IS NOT NULL
               AND p.namesake_risk <= 12)`,
    );
    assert.equal(
      Number(r.bad),
      0,
      "found a cross-source common-name merge with no gold key or shared-company bridge (potential namesake collapse)",
    );
  },
);

// Every tr/ngo role is LICENSED by exactly one of three safe mechanisms, never a bare name
// guess — and since 2026-08-25 the licence is a STORED FACT rather than something this gate
// re-derives. Plan: docs/plans/person-role-unlicensed-bridge-v1.md.
//
//   Bridge A (curated company link) — the EIK is one a curated source genuinely links the
//     person to (magistrate_company / company_politicians). Written by the roleRows COPY,
//     which is the only path such a mention takes into person_role.
//   Bridge B (people-unique public 3-part fold) — a public figure whose fold maps to exactly
//     ONE known person AND which the Commerce Registry itself records as one person, whose
//     whole SMALL footprint (≤ FOOTPRINT_CAP) is attached on the exact entity.
//   Bridge V (money-linked private owner, TIER-V) — a person-shaped fold that was not already
//     a person, is money-linked, and holds ≤ FOOTPRINT_CAP firms. Minted PRIVATE with a
//     NAME-ONLY identity.
//
// ⚠️ WHY THIS STOPPED RE-DERIVING, AND WHY THAT IS THE WHOLE POINT.
//
// Until 2026-08-25 this test recomputed each licence at TEST time from seven tables —
// tr_officers, tr_person_roles, contracts, agri_subsidies, fund_beneficiaries,
// company_politicians, magistrate_company — every one of which is reloaded on its own
// schedule, independently of person_role.
//
// ⚠️ BUT ONLY ONE OF THE SIX CLAUSES WAS ACTUALLY TIME-DEPENDENT, and conflating them is how
// a fix becomes a regression. The identity-SHAPE clauses (3-part fold, public/private,
// identity_confidence) read `person`, which is DELETEd and re-COPYd in the SAME TRANSACTION
// as person_role — same vintage by construction, incapable of the decay diagnosed here. The
// registry-uniqueness clause reads a COMMITTED, git-tracked TSV. All four failed 0 roles.
// What failed 409 was the FOOTPRINT, alone. So the footprint became a stored fact and the
// same-vintage clauses were KEPT, below — retiring them too would have traded a red gate for
// a quiet one, and a B↔V swap would sit 28,329 roles' worth of private, name-only licence on
// public figures with nothing failing.
//
// For that one clause the old form was not asserting an invariant. It was asserting that two
// corpora were the same vintage, which is FALSE on any machine that has run tr:daily-refresh
// since its last resolve — i.e. every machine following the documented daily pipeline, every
// day.
//
// Measured 2026-08-25: person_role was written 2026-08-22 18:56; db:load:tr:pg reloaded the
// TR corpus 2026-08-24 22:20 with 1,885 new companies; and 443 roles across 63 people came
// back "unlicensed". Every one of them had been attached under a footprint of 2..5 — inside
// the cap — and their folds had since grown to 6..11. The resolver was blameless: across the
// whole non-Bridge-A tr/ngo layer (82,247 people) NO person holds more than FOOTPRINT_CAP
// distinct EIKs, so the cap has never once been exceeded at attach time.
//
// A gate that is red-by-default is a gate nobody reads — the danger this file's own Bridge-V
// note already warned about, now describing its steady state. So the licence is recorded ON
// the role by the writer that makes the attachment (081 person_role.bridge /
// bridge_footprint) and checked here as a stored fact, which is time-invariant. Whether the
// corpus has since MOVED under those licences is a different question, and a different gate:
// person_role_bridge_freshness.data.test.ts — step 5 of the plan, NOT YET WRITTEN. Until it
// lands, NOTHING carries the drift signal that this file used to report as 443 red roles.
//
// ⚠️ IT SKIPS ON A CORPUS THAT HAS NOT BEEN RE-RESOLVED, with its own distinct reason. 081
// ships no backfill (the vintage the resolver saw is unrecoverable), so `bridge` is NULL
// everywhere until the next db:resolve:persons. "The corpus carries no licences yet" must
// never read as "the licences are enforced" — hence a separate skip string, not the
// database-absent one.
// ⚠️ TRY/CATCH, like `reachable()` above, and for a case that guard does not cover: a
// database that is perfectly REACHABLE and simply has no `bridge` column — which is every
// serving database, including Cloud SQL, until 081 is applied there. An unguarded
// module-scope query raises 42703 during COLLECTION, so the file does not skip, it fails to
// load — and a suite that cannot collect a gate reports differently from one that skips it.
const licenceCount = async (): Promise<number | null> => {
  try {
    const [r] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM person_role
        WHERE source IN ('tr', 'ngo') AND bridge IS NOT NULL`,
    );
    return Number(r.n);
  } catch {
    return null; // 42703 — 081's bridge block has not reached this database
  }
};
const lic = haveDb ? await licenceCount() : 0;
const skipLicence = !haveDb
  ? skip
  : lic === null
    ? "person_role has no `bridge` column — apply 081_person_identity.sql to this database."
    : lic > 0
      ? false
      : "person_role.bridge is entirely NULL — no resolve has run since 081 added it. " +
        "Run `npm run db:resolve:persons` (and its repair chain) to populate the licences.";
// `haveDb &&` so the database-absent case is announced ONCE, by line 39, rather than twice
// under two different strings for one cause.
reportSkip(import.meta.url, haveDb && skipLicence);

test.skipIf(skipLicence)(
  "every tr/ngo role carries the licence it was attached under",
  async () => {
    const [r] = await allRows<{
      unlicensed: string;
      bad_footprint: string;
      total: string;
      stray: string;
    }>(
      `SELECT
         count(*) FILTER (WHERE source IN ('tr', 'ngo') AND bridge IS NULL) AS unlicensed,
         count(*) FILTER (WHERE source IN ('tr', 'ngo') AND bridge IN ('B', 'V')
                            AND (bridge_footprint IS NULL
                                 OR bridge_footprint NOT BETWEEN 1 AND $1)) AS bad_footprint,
         count(*) FILTER (WHERE source IN ('tr', 'ngo'))                    AS total,
         count(*) FILTER (WHERE source NOT IN ('tr', 'ngo')
                            AND (bridge IS NOT NULL
                                 OR bridge_footprint IS NOT NULL))          AS stray
        FROM person_role`,
      [FOOTPRINT_CAP],
    );
    assert.equal(
      Number(r.unlicensed),
      0,
      `${r.unlicensed} of ${r.total} tr/ngo roles carry no bridge. Each attributes a COMPANY ` +
        `to a NAMED INDIVIDUAL, so an unlicensed one is an attribution nobody can account ` +
        `for. Either a writer in resolve_persons.ts stopped stamping (see ` +
        `resolve_persons_bridge_columns.test.ts) or the column was dropped from its copyRows ` +
        `list, which blanks the whole corpus at once.`,
    );
    // The converse, which 081's header states and the resolver implements as a ternary but
    // nothing gated: a licence belongs ONLY on a company attribution. An mp seat, a candidacy
    // or a filing is the person's own record — a bridge stamped there is meaningless, and
    // 081's CHECK permits it because the vocabulary is closed but the SCOPE is not.
    assert.equal(
      Number(r.stray),
      0,
      `${r.stray} non-tr/ngo roles carry a bridge. Only a company attribution is licensed; ` +
        `a licence on an mp/candidate/official row is a category error the CHECK cannot see.`,
    );
    // ⚠️ The cap is read from bridgeB.ts, never restated. It has ONE home precisely so the
    // resolver and this gate cannot disagree about it — the COMMON_NAME_TR_ROWS class.
    assert.equal(
      Number(r.bad_footprint),
      0,
      `${r.bad_footprint} B/V roles carry a footprint outside 1..${FOOTPRINT_CAP}. A stored ` +
        `footprint IS the number the cap was compared against, so one outside the cap means ` +
        `a writer recorded a measurement no cap ever accepted.`,
    );
  },
);

// Bridge A is the one licence whose evidence is CHECKABLE at any time, so it is re-derived
// here deliberately, unlike B and V.
//
// ⚠️ IT DOES DECAY, and an earlier draft of this comment claimed it did not.
// `company_politicians` is TRUNCATE+rebuilt by db:load:tr:pg from `person_role` INNER JOIN
// procurement money, so it moves with BOTH the person layer and the contracts corpus — 505 of
// the 756 curated EIKs come from it alone. This arm therefore carries a bounded amount of the
// same cross-vintage coupling the rest of the file just retired, which is why the failure
// message leads with decay rather than with a bad stamp. It is kept because the population is
// small (~2,644 roles) and the evidence is the strongest of the three: a register named this
// company for this person. Step 5 reports the drift; this only fails if a link is gone.
test.skipIf(skipLicence)("every Bridge-A role is still curated", async () => {
  const [r] = await allRows<{ bad: string; total: string }>(
    `SELECT count(*) FILTER (WHERE NOT EXISTS (
              SELECT 1 FROM (
                SELECT eik FROM magistrate_company
                 WHERE eik IS NOT NULL AND NOT eik_ambiguous
                UNION SELECT eik FROM company_politicians) a
               WHERE a.eik = r.ref)) AS bad,
            count(*) AS total
       FROM person_role r
      WHERE r.source IN ('tr', 'ngo') AND r.bridge = 'A'`,
  );
  assert.equal(
    Number(r.bad),
    0,
    `${r.bad} of ${r.total} roles are stamped Bridge A but their EIK is no longer in ` +
      `magistrate_company ∪ company_politicians. ⚠️ THE STAMP IS NOT THE LIKELY CULPRIT. ` +
      `company_politicians is TRUNCATE+rebuilt by db:load:tr:pg from person_role INNER JOIN ` +
      `contracts money, so a curated link leaves the set when the person layer or the ` +
      `contracts corpus moves — decay, not a bad stamp. Re-run \`npm run db:resolve:persons\` ` +
      `to re-derive the stamps against the current curated set. Only if the person layer is ` +
      `already current is the stamp itself wrong. (Measured propagation ceiling on the ` +
      `2026-08-25 corpus: 19 rows / 17 EIKs.)`,
  );
});

// THE IDENTITY-SHAPE HALF OF THE LICENCE, which never decayed and must not have been retired
// with the footprint. `person` is DELETEd and re-COPYd in the SAME TRANSACTION as person_role,
// so every column read here is the resolver's own vintage — there is no cross-corpus coupling
// to remove, and no reading of these clauses can go stale between two loaders.
//
// What it catches that the stored licence alone cannot: a B↔V SWAP. Both values are legal, both
// carry a footprint inside the cap, and every other assertion in this file passes — while 28,329
// roles would be publishing the PRIVATE, name-only licence on public figures and 168,585 the
// public-figure licence on private owners. The licence has to sit on the class that earned it.
test.skipIf(skipLicence)(
  "each licence sits on the identity class it licenses",
  async () => {
    const [r] = await allRows<{
      v_public: string;
      b_private: string;
      bad_shape: string;
      v_identity: string;
      b_shared: string;
    }>(
      `SELECT
         count(*) FILTER (WHERE r.bridge = 'V' AND p.is_public_figure)       AS v_public,
         count(*) FILTER (WHERE r.bridge = 'B' AND NOT p.is_public_figure)   AS b_private,
         count(*) FILTER (WHERE r.bridge IN ('B','V') AND p.name_parts <> 3) AS bad_shape,
         count(*) FILTER (WHERE r.bridge = 'V'
                            AND p.identity_confidence
                                NOT IN (${TIER_V_SERVED_IDENTITIES_SQL}))    AS v_identity,
         -- Registry-uniqueness, the guard bridgeB.ts calls out as having admitted 1,995 folds
         -- the registry says are 2+ people. Its source is a COMMITTED, git-tracked TSV, so it
         -- is static — re-reading it here couples this gate to nothing.
         count(*) FILTER (WHERE r.bridge = 'B'
                            AND NOT EXISTS (SELECT 1 FROM tr_name_fold_people f
                                             WHERE f.name_fold = p.name_fold
                                               AND f.people_n = 1))          AS b_shared
        FROM person_role r JOIN person p USING (person_id)
       WHERE r.source IN ('tr', 'ngo')`,
    );
    assert.equal(
      Number(r.v_public),
      0,
      `${r.v_public} roles carry the Tier-V licence on a PUBLIC figure. Bridge V mints a person ` +
        `PRIVATE with a name-only identity, so on a public figure it is not the licence that ` +
        `was earned — and the profile renders a different caveat for each.`,
    );
    assert.equal(
      Number(r.b_private),
      0,
      `${r.b_private} roles carry Bridge B on a non-public person. BRIDGE_B_CTE's \`elig\` ` +
        `requires is_public_figure, so this licence could not have been issued.`,
    );
    assert.equal(
      Number(r.bad_shape),
      0,
      `${r.bad_shape} B/V roles sit on a person without a 3-part name — both bridges require ` +
        `one, because a 2-part fold is far too common to identify anybody.`,
    );
    assert.equal(
      Number(r.v_identity),
      0,
      `${r.v_identity} Tier-V roles sit on a person outside the served identity list ` +
        `(${TIER_V_SERVED_IDENTITIES_SQL}). That list is the LICENCE — it says whose companies ` +
        `may appear on a public page — and it lives once, in scripts/person/tierV.ts.`,
    );
    assert.equal(
      Number(r.b_shared),
      0,
      `${r.b_shared} Bridge-B roles sit on a fold the Commerce Registry does NOT record as one ` +
        `person. That guard demands POSITIVE evidence (people_n = 1); an unmeasured fold is not ` +
        `evidence of uniqueness, and this is the bridge where being wrong puts a stranger's ` +
        `companies on a named public figure's page.`,
    );
  },
);

// NON-VACUITY, and it is not optional. Every assertion above is satisfied by a corpus in
// which every tr/ngo role carries the same constant licence — which is exactly what a writer
// that stamped one value for everything would produce. All three bridges must actually occur,
// and the two that are footprint-capped must actually carry footprints.
test.skipIf(skipLicence)("all three bridges still occur", async () => {
  const rows = await allRows<{
    bridge: string;
    n: string;
    fps: string;
    distinct_fp: string;
  }>(
    `SELECT bridge, count(*)::text n,
            count(bridge_footprint)::text fps,
            count(DISTINCT bridge_footprint)::text distinct_fp
       FROM person_role WHERE source IN ('tr', 'ngo') AND bridge IS NOT NULL
      GROUP BY bridge ORDER BY bridge`,
  );
  assert.deepEqual(
    rows.map((r) => r.bridge),
    ["A", "B", "V"],
    `the licence column is not discriminating — found ${JSON.stringify(
      rows.map((r) => `${r.bridge}=${r.n}`),
    )}. A single constant across the corpus satisfies every assertion above while recording ` +
      `nothing.`,
  );
  for (const r of rows.filter((x) => x.bridge !== "A")) {
    assert.equal(
      r.n,
      r.fps,
      `${r.bridge}: ${r.fps} of ${r.n} roles carry a footprint. A licence without the ` +
        `measurement it rests on passes 081's CHECK (the constraint is ` +
        `\`footprint IS NULL OR …\`) and silently costs the freshness gate its baseline.`,
    );
    // A footprint is a MEASUREMENT, so it must VARY. One value across a whole bridge is what
    // a writer stamping a literal produces, and it passes every other assertion here: a
    // constant inside the cap is in range, present on every row, and self-consistent. It is
    // also the baseline the freshness gate subtracts from, so a constant makes every future
    // drift reading wrong — uniformly, plausibly, with nothing red. Measured on a realistic
    // stamp both B and V span several distinct values, so > 1 is a floor with no flake risk.
    assert.ok(
      Number(r.distinct_fp) > 1,
      `${r.bridge}: all ${r.n} roles store the SAME bridge_footprint. A constant is not a ` +
        `measurement — check the writer stamps f.n_uic / v.n_uic rather than a literal.`,
    );
  }
  // Bridge A must carry NONE — it is not footprint-capped, and 081's CHECK refuses one.
  const a = rows.find((x) => x.bridge === "A");
  if (a) assert.equal(Number(a.fps), 0, "a Bridge-A role carries a footprint");
});

// The two defamation-sensitive curated sources carry the STRICTEST attach rule, and it must
// be enforced, not just intended:
//   ds (State Security findings) — attach ONLY via the mpId gold key, so every role is
//     exact_id; a name-ambiguous designee is held, never publicly attributed.
//   regulator — attach via the mpId gold key OR a globally-unique name, so every role is
//     exact_id OR sits on a namesake_risk<=1 person; a common name is never pinned to one seat.
test.skipIf(skip)("every ds role is gold-key licensed (exact_id)", async () => {
  const [r] = await allRows<{ bad: string }>(
    `SELECT count(*) bad FROM person_role WHERE source = 'ds' AND confidence <> 'exact_id'`,
  );
  assert.equal(
    Number(r.bad),
    0,
    "found a ds role not attached via the mpId gold key",
  );
});
test.skipIf(skip)(
  "every regulator role is gold-key OR globally-unique",
  async () => {
    const [r] = await allRows<{ bad: string }>(
      `SELECT count(*) bad
         FROM person_role rr JOIN person p USING (person_id)
        WHERE rr.source = 'regulator'
          AND rr.confidence <> 'exact_id'
          AND p.namesake_risk > 1`,
    );
    assert.equal(
      Number(r.bad),
      0,
      "found a regulator seat pinned to a common namesake",
    );
  },
);

test.skipIf(skip)(
  "every person has a non-null fold and a blocking key",
  async () => {
    const [r] = await allRows<{ bad: string }>(
      `SELECT count(*) bad FROM person
      WHERE name_fold IS NULL OR given_fold IS NULL OR family_fold IS NULL
         OR given_fold = '' OR family_fold = ''`,
    );
    assert.equal(Number(r.bad), 0);
  },
);

test.skipIf(skip)("every person has at least one role", async () => {
  const [r] = await allRows<{ bad: string }>(
    `SELECT count(*) bad FROM person p
      WHERE NOT EXISTS (SELECT 1 FROM person_role r WHERE r.person_id = p.person_id)`,
  );
  assert.equal(Number(r.bad), 0);
});

test.skipIf(skip)(
  "every active person's roles carry a public-safe confidence",
  async () => {
    const [r] = await allRows<{ bad: string }>(
      `SELECT count(*) bad
         FROM person p JOIN person_role r USING (person_id)
        WHERE p.status = 'active'
          AND r.confidence NOT IN ('exact_id', 'high', 'manual')`,
    );
    assert.equal(Number(r.bad), 0);
  },
);

// A review candidate is a "these might be the same person" flag, so a group is only
// meaningful when it spans >= 2 DISTINCT persons — a single-person group would be noise
// (mentions that actually merged, or all-dropped tr mentions, must not surface here).
test.skipIf(skip)("every review group spans >= 2 persons", async () => {
  const [r] = await allRows<{ bad: string }>(
    `SELECT count(*) bad FROM (
       SELECT group_key FROM person_review_candidate
        GROUP BY group_key HAVING count(*) < 2) x`,
  );
  assert.equal(Number(r.bad), 0, "found a review group with < 2 persons");
});

// §6 PRIVACY GATE: the serving functions must NEVER return a non-servable person (a
// donor-only individual has no public page). Guards person_by_slug + person_by_name +
// person_search against leaking a private person by slug, name, or search.
//
// The gate is `is_public_figure OR identity_confidence = 'verified'` (082:18), NOT
// `is_public_figure` alone — a verified identity is servable whether or not it is a
// public figure, and 53,203 of the 54,486 non-public persons are exactly that. Selecting
// on the narrower predicate picked a servable person 97.6% of the time, so this passed
// only because the unordered LIMIT 1 happened to return one of the other 1,283. It was
// a coin-flip on the physical row order, and adding an unrelated test file elsewhere in
// the suite was enough to flip it. ORDER BY makes the pick deterministic.
test.skipIf(skip)("serving functions never leak a private person", async () => {
  const [priv] = await allRows<{ slug: string; name: string }>(
    `SELECT slug, display_name AS name FROM person
      WHERE NOT is_public_figure AND identity_confidence <> 'verified'
      ORDER BY slug LIMIT 1`,
  );
  if (!priv) return; // no non-servable persons in this corpus
  const [r] = await allRows<{
    by_slug: unknown;
    by_name: unknown;
    in_search: string;
  }>(
    `SELECT person_by_slug($1) AS by_slug,
            person_by_name($2) AS by_name,
            (SELECT count(*) FROM jsonb_array_elements(person_search($2, 50))
              WHERE value->>'slug' = $1) AS in_search`,
    [priv.slug, priv.name],
  );
  assert.equal(r.by_slug, null, "person_by_slug leaked a private person");
  assert.equal(r.by_name, null, "person_by_name leaked a private person");
  assert.equal(
    Number(r.in_search),
    0,
    "person_search surfaced a private person",
  );
});

// (person_search ranking/recall, the party badge + mpId, and the /candidate URL resolution
// live in the dedicated person_search.data.test.ts gate.)

// person_by_slug (082) is the /person/{slug} payload. For any bridged person it must
// resolve EVERY distinct tr EIK to one `companies` entry, and expose only public-safe
// roles — a page must never render a bare EIK or a review-confidence role.
test.skipIf(skip)("person_by_slug resolves the full tr footprint", async () => {
  const [pick] = await allRows<{ slug: string }>(
    `SELECT p.slug FROM person p JOIN person_role r USING (person_id)
      WHERE r.source = 'tr' GROUP BY p.slug
      ORDER BY count(DISTINCT r.ref) DESC LIMIT 1`,
  );
  if (!pick) return; // no tr bridges in this corpus
  const [{ profile }] = await allRows<{ profile: Record<string, unknown> }>(
    `SELECT person_by_slug($1) AS profile`,
    [pick.slug],
  );
  const [{ eiks }] = await allRows<{ eiks: string }>(
    `SELECT count(DISTINCT ref) eiks FROM person_role
      WHERE source = 'tr' AND person_id = (SELECT person_id FROM person WHERE slug = $1)`,
    [pick.slug],
  );
  const companies = profile.companies as { eik: string; roles: string[] }[];
  assert.equal(
    companies.length,
    Number(eiks),
    "companies must cover every distinct tr EIK",
  );
  assert.ok(
    companies.every((c) => c.eik && Array.isArray(c.roles) && c.roles.length),
    "each company carries an eik and >=1 role",
  );
  const roles = profile.roles as { confidence: string }[];
  assert.ok(
    roles.every((r) => ["exact_id", "high", "manual"].includes(r.confidence)),
    "profile exposes only public-safe roles",
  );
});

// The profile's procuredEur must equal Σ amount_eur over the person's DISTINCT company EIKs
// — a manager+owner double role on one company must not double-count. Basis is
// `amount_eur WHERE tag='contract'` (the current post-annex sum matching person_by_slug and
// SIGMA — reference_procurement_eur_sum_basis / 078).
test.skipIf(skip)("person_by_slug procuredEur is EIK-deduped", async () => {
  const [pick] = await allRows<{ slug: string }>(
    `SELECT p.slug FROM person p
       JOIN person_role r USING (person_id)
       JOIN contracts c ON c.contractor_eik = r.ref AND c.tag = 'contract'
      WHERE r.source = 'tr' AND p.is_public_figure
      GROUP BY p.slug ORDER BY sum(c.amount_eur) DESC NULLS LAST LIMIT 1`,
  );
  if (!pick) return; // no procuring companies in this corpus
  const [{ profile }] = await allRows<{ profile: { procuredEur: number } }>(
    `SELECT person_by_slug($1) AS profile`,
    [pick.slug],
  );
  const [{ expected }] = await allRows<{ expected: string }>(
    `SELECT COALESCE(round(sum(e.eur)::numeric, 2), 0) expected FROM (
       SELECT (SELECT sum(amount_eur) FROM contracts
                WHERE contractor_eik = r.ref AND tag = 'contract') eur
       FROM person_role r
       WHERE r.source = 'tr'
         AND r.person_id = (SELECT person_id FROM person WHERE slug = $1)
       GROUP BY r.ref) e`,
    [pick.slug],
  );
  assert.equal(
    Number(profile.procuredEur),
    Number(expected),
    "procuredEur must be the EIK-deduped sum",
  );
});

// person_connections (084): every related person must be a PUBLIC figure (§6 — never a
// private co-owner), the payload always carries the disclaimer, and the association-noise
// guard holds — no edge may run through a company with > 6 public officers.
test.skipIf(skip)(
  "person_connections is public-safe + noise-guarded",
  async () => {
    const [pick] = await allRows<{ slug: string }>(
      `WITH tr AS (
       SELECT DISTINCT r.person_id, r.ref eik FROM person_role r
        JOIN person p USING (person_id)
       WHERE r.source='tr' AND p.is_public_figure AND p.status='active'),
     co AS (SELECT eik FROM tr GROUP BY eik HAVING count(*) BETWEEN 2 AND 6)
     SELECT pp.slug FROM tr JOIN co USING (eik) JOIN person pp USING (person_id) LIMIT 1`,
    );
    if (!pick) return; // no public shared-company edges in this corpus
    const [{ conn }] = await allRows<{
      conn: {
        related: { slug: string; companies: { eik: string }[] }[];
        disclaimer: string;
      };
    }>(`SELECT person_connections($1) AS conn`, [pick.slug]);

    assert.ok(
      conn.disclaimer && conn.disclaimer.length > 0,
      "disclaimer present",
    );

    // Every related person resolves to an active public figure.
    const relSlugs = conn.related.map((r) => r.slug);
    if (relSlugs.length) {
      const [{ bad }] = await allRows<{ bad: string }>(
        `SELECT count(*) bad FROM unnest($1::text[]) s
        WHERE NOT EXISTS (
          SELECT 1 FROM person p
           WHERE p.slug = s AND p.is_public_figure AND p.status='active')`,
        [relSlugs],
      );
      assert.equal(
        Number(bad),
        0,
        "a related person is not an active public figure",
      );

      // No edge runs through an association (> 6 public officers).
      const eiks = [
        ...new Set(conn.related.flatMap((r) => r.companies.map((c) => c.eik))),
      ];
      const [{ noisy }] = await allRows<{ noisy: string }>(
        `SELECT count(*) noisy FROM (
         SELECT r.ref FROM person_role r JOIN person p USING (person_id)
          WHERE r.source='tr' AND p.is_public_figure AND p.status='active'
            AND r.ref = ANY($1::text[])
          GROUP BY r.ref HAVING count(DISTINCT r.person_id) > 6) x`,
        [eiks],
      );
      assert.equal(
        Number(noisy),
        0,
        "an edge runs through an association (noise guard failed)",
      );
    }
  },
);
