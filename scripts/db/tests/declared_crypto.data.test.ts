// The declared-crypto layer: is_crypto_asset (090) and person_crypto_table (159).
//
// Plan: docs/plans/declared-crypto-v1.md
//
// THE FIRST TEST IS THE POINT OF THE WHOLE DESIGN. is_crypto_asset classifies by rule
// ("the unit of account is not money") rather than by a ticker allowlist, precisely so a
// coin nobody has heard of yet classifies itself. The cost of that choice is that a NEW
// FIAT SPELLING — the register is full of Cyrillic-homoglyph typos like ЕUR and ВGN, and
// of hand-typed units like „шв. фр." — would silently publish somebody's bank balance as a
// crypto holding. So every distinct non-fiat unit in the corpus must be classified
// DELIBERATELY: present in an exclusion list, or accepted as crypto and listed here. That
// makes the residue loud instead of silent, which is the "no silent caps" rule applied to
// a classifier.
//
// Auto-skips when Postgres is down or the declaration corpus is empty — like the other
// *.data.test.ts gates.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";

const haveDb = await dbReachable();
const declLoaded =
  haveDb &&
  Number(
    (
      await allRows<{ n: string }>(
        "SELECT count(*) n FROM declaration_asset",
      ).catch(() => [{ n: "0" }])
    )[0]?.n ?? 0,
  ) > 0;
const skip = !haveDb
  ? "Postgres unreachable"
  : !declLoaded
    ? "declaration corpus is empty"
    : false;

afterAll(async () => {
  await end();
});

/** Every non-fiat unit the corpus currently carries that is NOT crypto, with why. Adding a
 *  name here is a decision; the test below forces that decision to be made rather than
 *  defaulted. */
const KNOWN_NON_CRYPTO_UNITS: Record<string, string> = {
  // Precious metal — a non-money unit that is not crypto. PAX Gold, a gold-BACKED token
  // held on an exchange, is deliberately NOT in this list.
  XAU: "gold, ISO 4217 code",
  злато: "gold, spelled out",
  "инвестиционно злато": "investment gold",
  // Fiat the declarant typed by hand, including Cyrillic homoglyphs.
  ЕUR: "EUR with a Cyrillic Е",
  ВGN: "BGN with a Cyrillic В",
  УСД: "USD in Cyrillic",
  евро: "EUR spelled out",
  Евро: "EUR spelled out",
  ЕВРО: "EUR spelled out",
  лева: "BGN spelled out",
  ЛЕВА: "BGN spelled out",
  лв: "BGN abbreviated",
  "шв. фр.": "Swiss francs, abbreviated",
  // A BGN mistype, provable as one: the row's €/unit is exactly the 1.95583 peg.
  ФЖХ: "BGN mistype (converts at the peg)",
  едно: "the word 'one' on a debt row",
  // A mis-keyed numeric cell, not a unit.
  "9448": "numeric garbage",
};

test.skipIf(skip)(
  "every non-fiat declared unit is classified deliberately",
  async () => {
    const rows = await allRows<{ currency: string; crypto: boolean }>(
      `SELECT DISTINCT a.currency,
              is_crypto_asset(a.category, NULL, NULL, a.currency) AS crypto
         FROM declaration_asset a
        WHERE asset_unit_norm(a.currency) <> ''
          AND asset_unit_norm(a.currency) NOT IN ('BGN','EUR','USD','GBP','CHF')`,
    );
    const undecided = rows
      .filter((r) => !r.crypto && !(r.currency in KNOWN_NON_CRYPTO_UNITS))
      .map((r) => r.currency);
    assert.deepEqual(
      undecided,
      [],
      `A declared unit outside the fiat set is being treated as NOT crypto, and nothing ` +
        `here says why. Either it is a new fiat spelling / metal / garbage cell — add it ` +
        `to KNOWN_NON_CRYPTO_UNITS with the reason — or is_crypto_asset (090) is ` +
        `wrongly excluding a real coin. Units: ${undecided.join(", ")}`,
    );
    // And the converse: a unit this list calls non-crypto must not be classified as crypto.
    const contradicted = rows
      .filter((r) => r.crypto && r.currency in KNOWN_NON_CRYPTO_UNITS)
      .map((r) => r.currency);
    assert.deepEqual(
      contradicted,
      [],
      "listed non-crypto unit classified as crypto",
    );
  },
);

test.skipIf(skip)("the classifier discriminates at all", async () => {
  // Guards against a body that returns a constant — which would make the residue test
  // above pass vacuously (nothing left undecided because nothing is ever non-crypto).
  const [r] = await allRows<{ yes: string; no: string }>(
    `SELECT count(*) FILTER (WHERE is_crypto_asset(category, description, detail, currency)) yes,
            count(*) FILTER (WHERE NOT is_crypto_asset(category, description, detail, currency)) no
       FROM declaration_asset`,
  );
  assert.ok(Number(r.yes) > 0, "no asset row classifies as crypto");
  assert.ok(Number(r.no) > 0, "every asset row classifies as crypto");
});

test.skipIf(skip)(
  "gold is not crypto, but a gold-backed token is",
  async () => {
    // The one carve-out that has to be an EXACT match rather than a substring: „PAX Gold"
    // contains „Gold", and a substring rule on the metal names would drop a real holding.
    const [r] = await allRows<{ metal: boolean; token: boolean }>(
      `SELECT is_crypto_asset('investment', NULL, NULL, 'инвестиционно злато') AS metal,
            is_crypto_asset('investment', NULL, NULL, 'PAX Gold') AS token`,
    );
    assert.equal(r.metal, false, "investment gold classified as crypto");
    assert.equal(r.token, true, "PAX Gold (a token) classified as not-crypto");
  },
);

test.skipIf(skip)("a liability is never a crypto holding", async () => {
  const [r] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM declaration_asset
      WHERE category IN ('debt','credit_limit')
        AND is_crypto_asset(category, description, detail, currency)`,
  );
  assert.equal(Number(r.n), 0);
});

test.skipIf(skip)("an exchange equity is not a crypto holding", async () => {
  // „акции · Coinbase" is a share in a listed company, not a coin. It survives only because
  // rule B matches the word „crypto"/„крипто", which „Coinbase" does not contain — a
  // fragile-looking property, so it is pinned.
  const [r] = await allRows<{ crypto: boolean }>(
    `SELECT is_crypto_asset('security', 'акции', 'Coinbase', 'BGN') AS crypto`,
  );
  assert.equal(r.crypto, false);
});

test.skipIf(skip)("person_crypto_table is populated and scoped", async () => {
  const rows = await allRows<{ scope: string; n: string; people: string }>(
    `SELECT scope, count(*) n, count(DISTINCT person_slug) people
       FROM person_crypto_table GROUP BY scope ORDER BY scope`,
  );
  assert.deepEqual(
    rows.map((r) => r.scope),
    ["all", "latest"],
    "person_crypto_table must carry exactly the two scope buckets",
  );
  for (const r of rows)
    assert.ok(Number(r.n) > 0, `${r.scope} bucket is empty`);
  const [all, latest] = rows;
  assert.ok(
    Number(latest.n) <= Number(all.n),
    "latest must be a subset of all",
  );
  assert.equal(
    latest.people,
    all.people,
    "every person with any crypto history must appear in the latest bucket",
  );
});

test.skipIf(skip)(
  "the latest bucket is one period-year per person",
  async () => {
    // This is what makes the default view's SUM honest: a holding is re-declared on every
    // filing that covers it, so more than one period-year per person in `latest` would
    // double-count on the page's headline figure.
    const rows = await allRows<{ person_slug: string; years: string }>(
      `SELECT person_slug, count(DISTINCT period_year) years
       FROM person_crypto_table WHERE scope = 'latest'
      GROUP BY person_slug HAVING count(DISTINCT period_year) > 1`,
    );
    assert.deepEqual(rows, []);
  },
);

test.skipIf(skip)("no filing contributes twice to one scope", async () => {
  // The de-duplication the whole basis exists for: person_wealth_year picks ONE declaration
  // per (person, period_year), so two filings covering the same year can never both land
  // here. Before that join the raw corpus summed 19% high.
  const rows = await allRows<{
    person_slug: string;
    period_year: number;
    n: string;
  }>(
    `SELECT person_slug, period_year, count(DISTINCT declaration_id) n
       FROM person_crypto_table WHERE scope = 'all'
      GROUP BY person_slug, period_year HAVING count(DISTINCT declaration_id) > 1`,
  );
  assert.deepEqual(rows, []);
});

test.skipIf(skip)(
  "the quantity is resolved from the right column per filing shape",
  async () => {
    // Table 8 (`investment`) declares the coin AS the currency and the count in `amount`;
    // table 9 (`security`) puts the count in `share` and uses `amount` for the acquisition
    // PRICE in leva. Reading `amount` on a table-9 row would print „140 696 ADA" for a
    // holding of 518 000 ADA that cost 140 696 лв — a wrong number that looks plausible.
    const bad = await allRows<{
      holding_key: string;
      quantity: number;
      value_eur: number;
    }>(
      `SELECT c.holding_key, c.quantity, c.value_eur
       FROM person_crypto_table c
       JOIN declaration_asset a
         ON a.declaration_id = c.declaration_id
        AND a.seq = split_part(c.holding_key, '-', 2)::int
      WHERE c.scope = 'all'
        AND c.category = 'security'
        AND a.share ~ '^[[:space:]]*[0-9]+([.,][0-9]+)?[[:space:]]*$'
        AND c.quantity IS DISTINCT FROM replace(btrim(a.share), ',', '.')::double precision`,
    );
    assert.deepEqual(bad, [], "a table-9 quantity did not come from `share`");

    // And the table-8 arm carries its unit, which is the only thing naming the coin there.
    const [r] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM person_crypto_table
      WHERE scope = 'all' AND category = 'investment'
        AND (quantity IS NULL OR quantity_unit IS NULL)`,
    );
    assert.equal(
      Number(r.n),
      0,
      "a table-8 crypto row lost its quantity or its unit",
    );
  },
);

test.skipIf(skip)(
  "money and quantity are not numeric (node-postgres would stringify them)",
  async () => {
    // A PG `numeric` reaches the client as a STRING, which renders every money cell on the
    // page BLANK while the value is present and correct in the payload — invisible to every
    // row count and to any assertion made through SQL. Same trap 120 documents.
    // pg_catalog, not information_schema: a MATERIALIZED VIEW is not standard SQL and has no
    // information_schema.columns rows at all, so that query returns zero and the loop below
    // would pass vacuously.
    const rows = await allRows<{ column_name: string; data_type: string }>(
      `SELECT a.attname AS column_name, format_type(a.atttypid, a.atttypmod) AS data_type
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
      WHERE c.relname = 'person_crypto_table'
        AND a.attname IN ('value_eur', 'quantity')`,
    );
    assert.equal(rows.length, 2);
    for (const r of rows)
      assert.equal(
        r.data_type,
        "double precision",
        `${r.column_name} must not be numeric`,
      );
  },
);

test.skipIf(skip)(
  "the profile block and the register agree on a person's holdings",
  async () => {
    // person_declarations().cryptoCount drives whether the „Криптоактиви" block mounts, and
    // person_crypto_table drives the register. They are built from the same classifier but by
    // different paths, so a change to one that misses the other would show a person coins on
    // one surface and none on the other.
    const rows = await allRows<{
      person_slug: string;
      block: string;
      register: string;
    }>(
      `WITH reg AS (
       SELECT person_slug, declaration_id, count(*) n
         FROM person_crypto_table WHERE scope = 'all' GROUP BY 1, 2
     )
     SELECT r.person_slug, d.n::text AS block, r.n::text AS register
       FROM reg r
       JOIN LATERAL (
         SELECT (e->>'cryptoCount')::int n
           FROM jsonb_array_elements(person_declarations(r.person_slug)) e
          WHERE (e->>'id')::bigint = r.declaration_id
       ) d ON true
      WHERE d.n <> r.n`,
    );
    assert.deepEqual(rows, []);
  },
);
