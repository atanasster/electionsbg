// The REGISTRY basis for „Политически връзки" (migration 200) — and above all, what it REFUSES.
//
// WHY THIS GATE IS UNUSUALLY DEFENSIVE. These two functions put a living politician's name
// beside a private individual's or a named company's, on a page that publishes it. A wrong row
// here is not a wrong number; it is a false claim about people. So most of what follows asserts
// that something does NOT appear.
//
// The defect that motivated the whole thing: `/person/ГЕОРГИ ГЕОРГИЕВ МАНОЛОВ` published
// „Политически връзки (0)" directly beneath a connection check naming Антон Йорданов Адамов,
// народен представител в 45 НС, as a co-съдружник in two of his companies. The old block reads
// `company_politicians` (008), which is procurement-derived, and neither company ever won a
// public contract — so the zero was structural.
//
// The defect this file's own subject shipped and had to fix: the first cut of
// `company_office_links` hopped through „Заличено обстоятелство.", the register's deleted-fact
// PLACEHOLDER and the largest name fold in the corpus, returning 74 links of which 72 were
// fabricated. That is the single worst thing either function could emit, and the last three
// tests exist for it.
//
// Auto-skips when Postgres is down, when migration 200 is absent, or when the TR corpus is
// unloaded — each with its own reason, because „the guard is enforced" and „nothing was
// checked" must never look the same.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";
import { reportSkip } from "../../lib/report_skip";

/** The reference person and company: Манолов, and МЛГ ЕООД where he is sole owner. */
const SUBJECT = "ГЕОРГИ ГЕОРГИЕВ МАНОЛОВ";
const SUBJECT_EIK = "113581389";
/** The MP the old block could not see. `person_role` holds ONE tr row for him. */
const MP_SLUG = "mp-3026";
/** The register's deleted-fact placeholder — an officer row at SUBJECT_EIK itself. */
const PLACEHOLDER = "Заличено обстоятелство.";

const haveDb = await dbReachable();
const applied =
  haveDb &&
  Number(
    (
      await allRows<{ n: string }>(
        "SELECT count(*) n FROM pg_proc WHERE proname = 'person_office_links'",
      ).catch(() => [{ n: "0" }])
    )[0]?.n ?? 0,
  ) > 0;
const trLoaded =
  applied &&
  Number(
    (
      await allRows<{ n: string }>(
        "SELECT count(*) n FROM tr_name_fold_people",
      ).catch(() => [{ n: "0" }])
    )[0]?.n ?? 0,
  ) > 0;
const skip = !haveDb
  ? "Postgres unreachable"
  : !applied
    ? "migration 200 not applied — run: npx tsx scripts/db/apply_functions.ts 200_person_office_links.sql"
    : !trLoaded
      ? "tr_name_fold_people is empty — run db:load:tr-name-fold-people:pg (the registry-uniqueness guard demands POSITIVE evidence, so with it empty both functions correctly return nothing)"
      : false;
reportSkip(import.meta.url, skip);

afterAll(async () => {
  await end();
});

// ── it answers the question the procurement block structurally cannot ────────────────────

test.skipIf(skip)(
  "the person arm finds the MP the money basis misses",
  async () => {
    const [r] = await allRows<{ n: number; basis: string; slugs: string }>(
      `SELECT (p->>'count')::int AS n, p->>'basis' AS basis,
            (SELECT string_agg(DISTINCT e->>'slug', ',' ORDER BY e->>'slug')
               FROM jsonb_array_elements(p->'links') e) AS slugs
       FROM (SELECT person_office_links($1) p) q`,
      [SUBJECT],
    );
    assert.ok((r?.n ?? 0) > 0, "no registry links for the reference subject");
    assert.equal(
      r?.basis,
      "registry",
      "the basis must be declared in the payload",
    );
    assert.ok(
      (r?.slugs ?? "").split(",").includes(MP_SLUG),
      `${MP_SLUG} is not among the links (${r?.slugs}) — the arm no longer finds the MP it exists for`,
    );
  },
);

test.skipIf(skip)(
  "the company arm reaches him through the bridge person",
  async () => {
    const [r] = await allRows<{ n: number; basis: string; via: string }>(
      `SELECT (p->>'count')::int AS n, p->>'basis' AS basis,
              (SELECT string_agg(DISTINCT e->>'viaName', ',') FROM
                 jsonb_array_elements(p->'links') e
                WHERE e->>'slug' = $2) AS via
         FROM (SELECT company_office_links($1) p) q`,
      [SUBJECT_EIK, MP_SLUG],
    );
    assert.ok(
      (r?.n ?? 0) > 0,
      "no indirect registry links for the reference company",
    );
    assert.equal(r?.basis, "registry-indirect");
    // The bridge must be NAMED: the whole claim is „your own owner is co-registered with
    // this politician", and a row without the bridge is unverifiable.
    assert.ok(
      (r?.via ?? "").length > 0,
      "the MP is linked with no bridge person named — the claim is then uncheckable",
    );
  },
);

test.skipIf(skip)(
  "the procurement basis still cannot see it — the two are different questions",
  async () => {
    // Non-vacuity for the two tests above, and the reason this migration exists rather than
    // a widening of 008. If `company_politicians` ever DOES cover these companies, the new
    // arm has stopped being the only path and this file's premise needs re-reading.
    const [r] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM company_politicians
        WHERE eik IN (SELECT DISTINCT e->>'uic'
                        FROM jsonb_array_elements(person_office_links($1)->'links') e)`,
      [SUBJECT],
    );
    assert.equal(
      Number(r?.n),
      0,
      "company_politicians now covers the shared companies — the structural zero this " +
        "migration answers no longer exists, so re-check whether it is still needed",
    );
  },
);

// ── what it REFUSES ──────────────────────────────────────────────────────────────────────

test.skipIf(skip)("a CANDIDATE is not a political link", async () => {
  // ⚠️ THE GUARD MOST LIKELY TO BE LOST. `is_public_figure` alone admits 7,578 people whose
  // only public role is having STOOD for election — the largest bucket. „Политическа
  // връзка" resting on a 2007 candidacy is an overclaim about a named private individual.
  const [r] = await allRows<{ sources: string | null }>(
    `SELECT string_agg(DISTINCT s, ',') AS sources FROM (
         SELECT jsonb_array_elements(e->'offices')->>'source' AS s
           FROM jsonb_array_elements(person_office_links($1)->'links') e) x`,
    [SUBJECT],
  );
  const sources = (r?.sources ?? "").split(",").filter(Boolean);
  assert.ok(sources.length > 0, "no offices reported at all");
  for (const banned of ["candidate", "tr", "ngo", "ds", "public_sector"]) {
    assert.ok(
      !sources.includes(banned),
      `office source "${banned}" reached the payload — see 200's header for why each is excluded`,
    );
  }
});

test.skipIf(skip)(
  "every office source in OFFICE_SOURCES is HELD office, and the list is the only one",
  async () => {
    // Static-ish: reads the function's own array so a future edit cannot quietly add
    // `candidate` back. Corpus-wide rather than per-subject, so it does not depend on which
    // offices the reference person's links happen to hold.
    const [r] = await allRows<{ srcs: string[] }>(
      "SELECT office_link_sources() AS srcs",
    );
    const got = [...(r?.srcs ?? [])].sort();
    assert.deepEqual(
      got,
      [
        "diplomat",
        "local",
        "magistrate",
        "mep",
        "mp",
        "official_exec",
        "official_muni",
        "president",
        "regulator",
      ],
      "OFFICE_SOURCES changed. Adding a source widens what the site calls a political link " +
        "about named people — re-read 200's header before re-cutting this list.",
    );
  },
);

test.skipIf(skip)(
  "a fold the registry says is several people is REFUSED",
  async () => {
    // Registry-uniqueness, and it must be POSITIVE evidence: `EXISTS (… people_n = 1)`, never
    // `NOT EXISTS (… > 1)`. Unmeasured is not evidence of uniqueness, and this surface names
    // a politician. Asserted over the whole eligible population, not one example.
    const [r] = await allRows<{ leaked: string; checked: string }>(
      `WITH cand AS (
         SELECT p.name_fold FROM person p
          WHERE p.is_public_figure AND p.status = 'active' AND p.name_parts = 3
            AND EXISTS (SELECT 1 FROM tr_officers o WHERE o.name_fold = p.name_fold))
       SELECT count(*) AS checked,
              count(*) FILTER (WHERE EXISTS (SELECT 1 FROM office_holder_by_fold(c.name_fold)))
                AS leaked
         FROM cand c
        WHERE NOT EXISTS (SELECT 1 FROM tr_name_fold_people f
                           WHERE f.name_fold = c.name_fold AND f.people_n = 1)`,
    );
    assert.ok(
      Number(r?.checked ?? 0) > 0,
      "no folds lack a people_n = 1 record — the assertion below is vacuous",
    );
    assert.equal(
      Number(r?.leaked),
      0,
      `${r?.leaked} of ${r?.checked} folds WITHOUT positive registry evidence still resolve ` +
        "to an office-holder — the guard has become NOT EXISTS (… > 1), which silently means " +
        "„assume one person“ for a fold the counter has never observed",
    );
  },
);

test.skipIf(skip)("a fold shared by two person rows is REFUSED", async () => {
  // People-uniqueness, over the WHOLE `person` table: a fold shared with a private or
  // 2-part person is ambiguous too. Same scope, same reason, as BRIDGE_B_CTE.
  const [r] = await allRows<{ leaked: string; checked: string }>(
    `WITH dup AS (
         SELECT p.name_fold FROM person p
          GROUP BY p.name_fold HAVING count(*) > 1)
       SELECT count(*) AS checked,
              count(*) FILTER (WHERE EXISTS (SELECT 1 FROM office_holder_by_fold(d.name_fold)))
                AS leaked
         FROM dup d`,
  );
  assert.ok(Number(r?.checked ?? 0) > 0, "no shared folds — vacuous");
  assert.equal(
    Number(r?.leaked),
    0,
    `${r?.leaked} of ${r?.checked} folds held by MORE THAN ONE person row still resolve to ` +
      "an office-holder — the arm is naming a name, not a person",
  );
});

test.skipIf(skip)("the guards refuse a large, non-trivial share", async () => {
  // A guard that refuses nothing is not a guard. Measured 2026-09-21: 28,097 public 3-part
  // figures present in tr_officers → 8,238 identifiable office-holders, i.e. 70.7% refused.
  // The floor is deliberately far below that: this asserts the guards BITE, not a number.
  const [r] = await allRows<{ before: string; after: string }>(
    `SELECT (SELECT count(*) FROM person p
                WHERE p.is_public_figure AND p.status='active' AND p.name_parts=3
                  AND EXISTS (SELECT 1 FROM tr_officers o WHERE o.name_fold=p.name_fold))
                AS before,
              (SELECT count(*) FROM person p
                WHERE p.is_public_figure AND p.status='active' AND p.name_parts=3
                  AND EXISTS (SELECT 1 FROM tr_officers o WHERE o.name_fold=p.name_fold)
                  AND EXISTS (SELECT 1 FROM office_holder_by_fold(p.name_fold))) AS after`,
  );
  const before = Number(r?.before);
  const after = Number(r?.after);
  assert.ok(before > 0 && after > 0, "nothing to compare");
  assert.ok(
    after < before * 0.9,
    `the guards refuse only ${(((before - after) / before) * 100).toFixed(1)}% ` +
      `(${before} → ${after}). Measured 2026-09-21 it was 70.7%; a collapse here means a ` +
      "uniqueness or office guard has stopped discriminating",
  );
});

// ── the placeholder, which is the bug this shipped with ──────────────────────────────────

test.skipIf(skip)(
  "the deleted-fact placeholder is never a bridge",
  async () => {
    // ⚠️ THE FIRST CUT OF `company_office_links` HOPPED THROUGH IT. „Заличено обстоятелство."
    // is an officer row at the reference company, and the largest name fold in the corpus,
    // so hopping through it linked МЛГ ЕООД to 72 politicians it has no connection to —
    // every one a fabricated claim about a named company.
    const [r] = await allRows<{ n: number; via: string | null }>(
      `SELECT (p->>'count')::int AS n,
              (SELECT string_agg(DISTINCT e->>'viaName', ' | ')
                 FROM jsonb_array_elements(p->'links') e
                WHERE e->>'viaName' ILIKE $2) AS via
         FROM (SELECT company_office_links($1) p) q`,
      [SUBJECT_EIK, `%${PLACEHOLDER}%`],
    );
    assert.equal(
      r?.via,
      null,
      `„${PLACEHOLDER}" is being used as a bridge person (${r?.via}) — it is the register's ` +
        "deleted-fact placeholder, not a human, and every link through it is fabricated",
    );
  },
);

test.skipIf(skip)(
  "the placeholder is an officer at the reference company — so the guard is load-bearing",
  async () => {
    // Non-vacuity for the test above: if the placeholder ever stops appearing at this EIK,
    // that test passes for free and the guard could be deleted unnoticed.
    const [r] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM tr_officers
        WHERE uic = $1 AND tr_fold_is_placeholder(name_fold)`,
      [SUBJECT_EIK],
    );
    assert.ok(
      Number(r?.n) > 0,
      `„${PLACEHOLDER}" is no longer an officer row at ${SUBJECT_EIK}, so the bridge test ` +
        "above no longer proves anything — pick another reference company that has one",
    );
  },
);

test.skipIf(skip)(
  "neither arm ever names the placeholder as an office-holder",
  async () => {
    // The other side of the same guard: not just as a bridge, but as the linked person.
    const [r] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM office_holder_by_fold(translit_bg_latin($1))",
      [PLACEHOLDER],
    );
    assert.equal(
      Number(r?.n),
      0,
      "the deleted-fact placeholder resolves to an office-holder — a `person` row exists on " +
        "that fold AND the explicit guard in office_holder_by_fold has been removed",
    );
  },
);

test.skipIf(skip)("an empty fold names nobody", async () => {
  // The OTHER non-person, and a different one: „the register recorded no name at all" is not
  // „the register recorded that a fact was deleted". 192's comment requires both at each site.
  const [r] = await allRows<{ n: string }>(
    "SELECT count(*) n FROM office_holder_by_fold('')",
  );
  assert.equal(
    Number(r?.n),
    0,
    "the empty name fold resolves to an office-holder",
  );
});

// ── cost ─────────────────────────────────────────────────────────────────────────────────

test.skipIf(skip)(
  "the company arm stays cheap on the widest reachable company",
  async () => {
    // Two hops, so the cost scales with the officers' combined footprint. Measured
    // 2026-09-21 on the worst case in the corpus (EIK 200397116, 6 officers whose folds span
    // 1,354 companies): 21,690 buffers / 17.3 ms, all index scans. The reference company is
    // 1,255 / 2.8 ms. `/company/:eik` is crawler-walked under the pool's 10 s
    // statement_timeout, so a plan change that loses an index here matters.
    const [{ eik }] = await allRows<{ eik: string }>(
      `SELECT o.uic AS eik
         FROM tr_officers o
         JOIN company_officer_counts c ON c.uic = o.uic
         JOIN officer_name_counts n ON n.name_fold = o.name_fold
        WHERE c.officer_count <= 6
          AND o.name_fold <> ''
          AND NOT tr_fold_is_placeholder(o.name_fold)
        GROUP BY o.uic
        ORDER BY sum(n.company_count) DESC, o.uic
        LIMIT 1`,
    );
    const rows = await allRows<{ "QUERY PLAN": string }>(
      "EXPLAIN (ANALYZE, BUFFERS, TIMING OFF) SELECT company_office_links($1)",
      [eik],
    );
    const plan = rows.map((r) => r["QUERY PLAN"]).join("\n");
    const buffers = [...plan.matchAll(/shared hit=(\d+)(?: read=(\d+))?/g)]
      .map((m) => Number(m[1]) + Number(m[2] ?? 0))
      .reduce((a, b) => Math.max(a, b), 0);
    assert.ok(
      buffers < 80000,
      `company_office_links('${eik}') reads ${buffers} buffers (measured 2026-09-21: ~21,700 ` +
        `on this worst case). The ceiling is generous — blowing it means a hop stopped ` +
        `being an index scan.\n${plan}`,
    );
  },
);
