// Correctness gate for declared stakes → public contracts (096).
//
// This surface publishes "this named official's company holds public contracts" off a
// declaration form THAT CARRIES NO EIK, so every link is inferred. A wrong inference is a
// fabricated conflict of interest attached to a real person's name.
//
// TESTING DISCIPLINE — read before adding a case here.
//
// The first version of this file passed every test while four critical defects were live,
// because each test was written IN TERMS OF THE PIPELINE'S OWN EXPRESSIONS: the gate-B test
// re-ran the matview's own EXISTS clause against the matview's own output; the gate-A test
// called declared_company_norm() to check declared_company_norm()'s result, which made it
// structurally incapable of noticing that the function truncated "БОКАД" to "БОК" and
// resolved a declarant to an unrelated company. That is the same trap the reverted T3.7 work
// fell into (see its note in docs/plans/persons-declarations-audit-v1.md) — there by
// re-implementing the arithmetic, here by re-implementing the filter.
//
// So the rule for this file: EXPECTATIONS ARE COMPUTED INDEPENDENTLY, in TypeScript, from
// raw table rows — never by re-running the SQL under test. A test that calls
// declared_company_norm, or repeats the matview's WHERE clause, is not a test.
//
// Auto-skips when Postgres is down or the stakes are not loaded.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";

const reachable = async (): Promise<boolean> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.declaration_stake_company') IS NOT NULL AS ok",
    );
    if (!t?.ok) return false;
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM declaration_stake_company",
    );
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb ? false : "Postgres unreachable / no resolved stakes";

afterAll(async () => {
  await end();
});

// An INDEPENDENT normaliser. Deliberately NOT a port of declared_company_norm's regex: it
// tokenises on whitespace and drops a legal form only when it is a WHOLE trailing token,
// which is the property the SQL is supposed to have. If the SQL ever again strips letters
// off the end of a real word, the two disagree and the tests below fail.
const LEGAL_FORMS = new Set([
  "ЕООД",
  "ООД",
  "ЕАД",
  "АД",
  "АДСИЦ",
  "ЕТ",
  "КД",
  "КДА",
  "СД",
  "ДЗЗД",
]);

const normIndependently = (raw: string): string => {
  const words = raw
    .replace(/[„“”"'`.,]/g, " ")
    .toUpperCase()
    .split(/\s+/)
    .filter((w) => w.length > 0);
  // Strip at most ONE trailing form: the SQL pattern is $-anchored, so it can match only
  // once. Popping repeatedly here would make the oracle disagree with a correct
  // implementation on the rare "X ООД ЕООД".
  //
  // A name that is NOTHING BUT a legal form ("АД", "СД" — 5 such rows exist) reduces to the
  // empty string, matching the SQL's NULL. That is the wanted behaviour: a bare legal form
  // is not a usable match key and must never resolve anything.
  if (words.length >= 1 && LEGAL_FORMS.has(words[words.length - 1])) words.pop();
  return words.join(" ");
};

// THE NORMALISER ITSELF, against the independent oracle over real registry names.
//
// This test exists because the output-level gate-A test below CANNOT catch a broken
// normaliser: when the regex truncates "БОКАД" to "БОК", gates B and C happen to reject the
// resulting false match, so nothing wrong reaches the matview and every downstream assertion
// still passes. Verified by mutation — reintroducing the original `\s*` regex leaves all
// output-level tests green. The defect is only visible by interrogating the function.
test.skipIf(skip)(
  "declared_company_norm strips only whole trailing legal-form tokens",
  async () => {
    // Every registry name that ends in the LETTERS of a legal form — the exact population
    // the anchor bug mangles — plus a broad sample for general agreement.
    const rows = await allRows<{ name: string; sql: string | null }>(`
      SELECT name, declared_company_norm(name) AS sql
        FROM tr_companies
       WHERE entity_class = 'company'
         AND (name ~ '(АД|ОД|ЕТ|КД|СД)$' OR uic LIKE '1%')
       -- ORDER BY, so the sample is the SAME 40k rows every run. A bare LIMIT let the
       -- planner return different rows each time, which made this gate flaky.
       ORDER BY uic
       LIMIT 40000
    `);
    assert.ok(rows.length > 1000, "sample too small to be meaningful");
    const disagree = rows.filter((r) => {
      const oracle = normIndependently(r.name);
      const got = r.sql ?? "";
      return oracle !== got;
    });
    assert.deepEqual(
      disagree
        .slice(0, 15)
        .map(
          (d) =>
            `"${d.name}" => SQL "${d.sql}" vs "${normIndependently(d.name)}"`,
        ),
      [],
      `${disagree.length} registry names normalise differently than a whole-token strip`,
    );
  },
);

// GATE A. Every resolved pair must agree on the name once whole-token legal forms come off.
// This is the test that would have caught "БОК ООД" → БОКАД and "Травъл План ООД" →
// ТРАВЪЛ ПЛАНЕТ, both of which the expression-level version passed.
test.skipIf(skip)(
  "every resolved company actually bears the declared name",
  async () => {
    const rows = await allRows<{
      declared: string;
      registry: string;
      uic: string;
    }>(`
      SELECT DISTINCT sc.company_name AS declared, c.name AS registry, sc.uic
        FROM declaration_stake_company sc
        JOIN tr_companies c ON c.uic = sc.uic
    `);
    assert.ok(rows.length > 0, "no resolved companies — fixture is empty");
    const mismatched = rows.filter(
      (r) => normIndependently(r.declared) !== normIndependently(r.registry),
    );
    assert.deepEqual(
      mismatched.map((m) => `"${m.declared}" => "${m.registry}" (${m.uic})`),
      [],
      "a declared name resolved to a company that does not bear that name",
    );
  },
);

// GATE A, part two: the resolution must be unique under the independent key as well. A name
// borne by two trading companies must have been DROPPED, not resolved to one of them.
test.skipIf(skip)(
  "no resolved name matches two trading companies",
  async () => {
    const declared = await allRows<{ company_name: string }>(
      "SELECT DISTINCT company_name FROM declaration_stake_company",
    );
    const registry = await allRows<{ name: string }>(
      "SELECT name FROM tr_companies WHERE entity_class = 'company'",
    );
    const byNorm = new Map<string, number>();
    for (const c of registry) {
      const k = normIndependently(c.name);
      byNorm.set(k, (byNorm.get(k) ?? 0) + 1);
    }
    const ambiguous = declared
      .map((d) => d.company_name)
      .filter((n) => (byNorm.get(normIndependently(n)) ?? 0) > 1);
    assert.deepEqual(
      ambiguous,
      [],
      "an ambiguous declared name was resolved instead of dropped",
    );
  },
);

// GATE C: a declarant whose folded name is shared by another active person cannot be placed
// at an EIK by a name match, so they must not be published. Computed from `person` directly.
test.skipIf(skip)("no published declarant has an active namesake", async () => {
  const rows = await allRows<{ slug: string; fold: string; shared: string }>(`
    SELECT DISTINCT p.slug, p.name_fold AS fold,
           (SELECT count(*) FROM person p2
             WHERE p2.name_fold = p.name_fold AND p2.status = 'active') AS shared
      FROM declaration_stake_company sc
      JOIN person p ON p.person_id = sc.person_id
  `);
  const risky = rows.filter((r) => Number(r.shared) > 1);
  assert.deepEqual(
    risky.map((r) => `${r.slug} (${r.shared} share "${r.fold}")`),
    [],
    "a namesake-ambiguous person was published — gate C is not holding",
  );
});

// THE MONEY, recomputed in TypeScript from raw contract rows. This is what catches the annex
// double-count (a 'contractAmendment' row added on top of an already post-annex amount_eur)
// and the €0 consortium-member placeholders — neither of which any expression-level test saw.
test.skipIf(skip)(
  "served totals match an independent sum over solo, non-annex contracts",
  async () => {
    const served = await allRows<{
      slug: string;
      eik: string;
      total: string;
      count: string;
      first_year: string;
      last_year: string;
      while_eur: string;
    }>(`
      WITH target AS MATERIALIZED (
        SELECT DISTINCT p.slug
          FROM declaration_stake_company sc
          JOIN person p ON p.person_id = sc.person_id
      )
      SELECT t.slug,
             e ->> 'eik' AS eik,
             e ->> 'totalEur' AS total,
             e ->> 'contractCount' AS count,
             e ->> 'firstYear' AS first_year,
             e ->> 'lastYear' AS last_year,
             e ->> 'whileDeclaredEur' AS while_eur
        FROM target t
        CROSS JOIN LATERAL jsonb_array_elements(person_stake_procurement(t.slug)) e
    `);
    assert.ok(served.length > 0, "nothing served — fixture is empty");

    // Raw rows for exactly those EIKs, with NO filtering applied server-side.
    const eiks = [...new Set(served.map((s) => s.eik))];
    const raw = await allRows<{
      contractor_eik: string;
      tag: string;
      consortium_role: string | null;
      amount_eur: number | null;
      yr: string | null;
    }>(
      `SELECT contractor_eik, tag, consortium_role, amount_eur,
              nullif(left(COALESCE(nullif(date_signed, ''), date), 4), '') AS yr
         FROM contracts WHERE contractor_eik = ANY($1)`,
      [eiks],
    );

    for (const s of served) {
      const mine = raw.filter(
        (r) =>
          r.contractor_eik === s.eik &&
          r.tag === "contract" &&
          r.consortium_role !== "member",
      );
      const expTotal = Math.round(
        mine.reduce((a, r) => a + (r.amount_eur ?? 0), 0),
      );
      const lo = Number(s.first_year);
      const hi = Number(s.last_year);
      const expWhile = Math.round(
        mine
          .filter((r) => {
            const y = r.yr && /^\d{4}$/.test(r.yr) ? Number(r.yr) : null;
            return y != null && y >= lo && y <= hi;
          })
          .reduce((a, r) => a + (r.amount_eur ?? 0), 0),
      );
      const where = `${s.slug}/${s.eik}`;
      // The server rounds the SUM, as does this expectation, so they must agree exactly — a
      // drift would mean the server rounded per row instead
      // (reference_procurement_eur_sum_basis).
      assert.equal(Number(s.total), expTotal, `totalEur wrong for ${where}`);
      assert.equal(
        Number(s.count),
        mine.length,
        `contractCount wrong for ${where}`,
      );
      assert.equal(
        Number(s.while_eur),
        expWhile,
        `whileDeclaredEur wrong for ${where}`,
      );
    }
  },
);

// A company whose entire procurement record is annexes or €0 placeholders must not surface
// at all — the block's premise is "this company holds public contracts".
test.skipIf(skip)("no served company has a nil contract take", async () => {
  const rows = await allRows<{ slug: string; eik: string }>(`
    WITH target AS MATERIALIZED (
      SELECT DISTINCT p.slug
        FROM declaration_stake_company sc
        JOIN person p ON p.person_id = sc.person_id
    )
    SELECT t.slug, e ->> 'eik' AS eik
      FROM target t
      CROSS JOIN LATERAL jsonb_array_elements(person_stake_procurement(t.slug)) e
     WHERE COALESCE((e ->> 'totalEur')::numeric, 0) <= 0
  `);
  assert.deepEqual(
    rows.map((r) => `${r.slug}/${r.eik}`),
    [],
    "a company with no contract value was published under a conflict-of-interest heading",
  );
});

// The rendered period and the counted period must be the same span. The UI draws
// firstYear–lastYear as a range, so the arithmetic has to cover it contiguously; a discrete
// set of filed years would silently omit the gaps a reader sees included.
test.skipIf(skip)(
  "the aligned span is contiguous, matching the rendered range",
  async () => {
    const rows = await allRows<{
      slug: string;
      eik: string;
      lo: string;
      hi: string;
      expected: string;
      got: string;
    }>(`
    WITH target AS MATERIALIZED (
      SELECT DISTINCT p.slug, p.person_id
        FROM declaration_stake_company sc
        JOIN person p ON p.person_id = sc.person_id
    ),
    served AS (
      SELECT t.slug, t.person_id,
             e ->> 'eik' AS eik,
             (e ->> 'firstYear')::int AS lo,
             (e ->> 'lastYear')::int AS hi,
             (e ->> 'whileDeclaredCount')::int AS got
        FROM target t
        CROSS JOIN LATERAL jsonb_array_elements(person_stake_procurement(t.slug)) e
    )
    SELECT s.slug, s.eik, s.lo::text, s.hi::text, s.got::text AS got,
           (SELECT count(*) FROM contracts c
             WHERE c.contractor_eik = s.eik AND c.tag = 'contract'
               AND c.consortium_role IS DISTINCT FROM 'member'
               AND left(COALESCE(nullif(c.date_signed, ''), c.date), 4) ~ '^\\d{4}$'
               AND left(COALESCE(nullif(c.date_signed, ''), c.date), 4)::int
                   BETWEEN s.lo AND s.hi)::text AS expected
      FROM served s
  `);
    assert.ok(rows.length > 0, "nothing served — fixture is empty");
    const wrong = rows.filter((r) => r.got !== r.expected);
    assert.deepEqual(
      wrong.map(
        (r) =>
          `${r.slug}/${r.eik} ${r.lo}-${r.hi}: got ${r.got}, span has ${r.expected}`,
      ),
      [],
      "the aligned count does not cover the rendered span contiguously",
    );
  },
);

// The raw parse must stay a faithful record of the XML. The form has no EIK column, so a
// non-NULL uic in declaration_stake means inference leaked back into the source table.
test.skipIf(skip)(
  "the inferred EIK never leaks into declaration_stake",
  async () => {
    const [r] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM declaration_stake WHERE uic IS NOT NULL",
    );
    assert.equal(
      Number(r.n),
      0,
      "declaration_stake.uic was written — inference must stay in the derived layer",
    );
  },
);

// Payload determinism (reference_pg_payload_determinism): the same call must be byte-stable,
// or a redeploy churns the diff and the changelog misreports what changed.
test.skipIf(skip)("the payload is byte-stable across calls", async () => {
  const [r] = await allRows<{ same: boolean; n: string }>(`
    WITH target AS MATERIALIZED (
      SELECT DISTINCT p.slug
        FROM declaration_stake_company sc
        JOIN person p ON p.person_id = sc.person_id
    ),
    two AS (
      SELECT person_stake_procurement(t.slug)::text AS a,
             person_stake_procurement(t.slug)::text AS b
        FROM target t
    )
    SELECT bool_and(a = b) AS same, count(*) AS n FROM two
  `);
  assert.ok(Number(r.n) > 0, "no slugs exercised");
  assert.equal(r.same, true, "the payload is not byte-stable");
});

// §6 PRIVACY GATE. A person who is not active + public must get an empty payload even
// though the matview holds their rows — the gate lives in the serving function.
test.skipIf(skip)(
  "the serving function enforces the privacy gate",
  async () => {
    const hidden = await allRows<{ slug: string; r: unknown[] }>(`
    WITH target AS MATERIALIZED (
      SELECT DISTINCT p.slug
        FROM declaration_stake_company sc
        JOIN person p ON p.person_id = sc.person_id
       WHERE p.status <> 'active' OR NOT p.is_public_figure
       LIMIT 50
    )
    SELECT t.slug, person_stake_procurement(t.slug) AS r FROM target t
  `);
    const leaked = hidden.filter((h) => (h.r as unknown[]).length > 0);
    assert.deepEqual(
      leaked.map((l) => l.slug),
      [],
      "a non-public / non-active person was served stake rows",
    );
  },
);
