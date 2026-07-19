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
               AND (r.confidence = 'exact_id' OR r.source IN ('tr', 'ngo')))`,
    );
    assert.equal(
      Number(r.bad),
      0,
      "found a cross-source common-name merge with no gold key or shared-company bridge (potential namesake collapse)",
    );
  },
);

// Every TR bridge is LICENSED by exactly one of the two safe mechanisms, never a bare
// name guess:
//   Bridge A (shared company) — the EIK is one the person is genuinely linked to via a
//     curated source (magistrate holdings / company_politicians); the match is the strong
//     shared-uic corroborant.
//   Bridge B (unique full name) — the person is globally unique (namesake_risk<=1) and
//     their full-name fold matches a TR officer/owner ON THAT EXACT company; the company
//     appears once for that name, so it is unambiguously them.
// A tr/ngo role satisfying NEITHER is an unlicensed attribution and must never exist.
// (NGO board seats bridge exactly like company officerships — same shared-uic / unique-name
// mechanism — so both facets carry the same licensing invariant.)
test.skipIf(skip)("every tr/ngo role is a licensed bridge (A or B)", async () => {
  const [r] = await allRows<{ bad: string }>(
    `SELECT count(*) bad
       FROM person_role r JOIN person p USING (person_id)
      WHERE r.source IN ('tr', 'ngo')
        AND r.ref NOT IN (   -- Bridge A: curated company link
          SELECT eik FROM magistrate_company WHERE eik IS NOT NULL AND NOT eik_ambiguous
          UNION SELECT eik FROM company_politicians)
        AND NOT (            -- Bridge B: unique full-name match on that exact entity
          p.namesake_risk <= 1
          AND EXISTS (
            SELECT 1 FROM tr_person_roles t
             WHERE t.uic = r.ref AND t.name_fold = p.name_fold))`,
  );
  assert.equal(Number(r.bad), 0, "found an unlicensed tr/ngo role");
});

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

// The profile's procuredEur must equal Σ current_amount_eur over the person's DISTINCT
// company EIKs — a manager+owner double role on one company must not double-count.
test.skipIf(skip)("person_by_slug procuredEur is EIK-deduped", async () => {
  const [pick] = await allRows<{ slug: string }>(
    `SELECT p.slug FROM person p
       JOIN person_role r USING (person_id)
       JOIN contracts c ON c.contractor_eik = r.ref
      WHERE r.source = 'tr' AND p.is_public_figure
      GROUP BY p.slug ORDER BY sum(c.current_amount_eur) DESC NULLS LAST LIMIT 1`,
  );
  if (!pick) return; // no procuring companies in this corpus
  const [{ profile }] = await allRows<{ profile: { procuredEur: number } }>(
    `SELECT person_by_slug($1) AS profile`,
    [pick.slug],
  );
  const [{ expected }] = await allRows<{ expected: string }>(
    `SELECT COALESCE(round(sum(e.eur)::numeric, 2), 0) expected FROM (
       SELECT (SELECT sum(current_amount_eur) FROM contracts WHERE contractor_eik = r.ref) eur
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
