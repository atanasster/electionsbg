// Correctness gate for the disposals / third-party-expenses feed (093). These rows are
// verbatim register facts about NAMED individuals — what they sold, who paid for their
// travel — so the controls are about attribution and about not asserting more than the
// register says.
//
// Auto-skips when Postgres is down or the events are not loaded.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";

const reachable = async (): Promise<boolean> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.declaration_event') IS NOT NULL AS ok",
    );
    if (!t?.ok) return false;
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM declaration_event",
    );
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb ? false : "Postgres unreachable / no declaration events";

afterAll(async () => {
  await end();
});

// ATTRIBUTION. A disposal we cannot attribute to a named, public, active person must never
// reach the site-wide feed — it would be an unsourced claim about nobody in particular.
test.skipIf(skip)(
  "the site-wide feed only carries attributed public people",
  async () => {
    const [{ r }] = await allRows<{ r: { slug: string }[] }>(
      "SELECT declaration_events_feed(NULL, 200) AS r",
    );
    assert.ok(r.length > 0, "expected a non-empty feed");
    const slugs = [...new Set(r.map((x) => x.slug))];
    const [{ n }] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM unnest($1::text[]) s
      WHERE NOT EXISTS (SELECT 1 FROM person p
                         WHERE p.slug = s AND p.status = 'active'
                           AND p.is_public_figure)`,
      [slugs],
    );
    assert.equal(
      Number(n),
      0,
      "the feed carries a non-public or unknown person",
    );
  },
);

// The feed must not present an UNPRICED row (value 0 in this corpus) as a transaction
// worth nothing, and must not rank one.
test.skipIf(skip)("the feed excludes unpriced rows", async () => {
  const [{ r }] = await allRows<{ r: { valueEur: number }[] }>(
    "SELECT declaration_events_feed(NULL, 200) AS r",
  );
  assert.ok(
    r.every((x) => x.valueEur > 0),
    "the feed ranked a zero/unpriced event",
  );
});

// DETERMINISM. Two identical calls must return the same rows in the same order, or the
// top-N reshuffles named individuals between runs (reference_pg_payload_determinism).
test.skipIf(skip)(
  "the feed is deterministic across identical calls",
  async () => {
    const call = async () => {
      const [{ r }] = await allRows<{ r: unknown[] }>(
        "SELECT declaration_events_feed('disposal_vehicle', 50) AS r",
      );
      return JSON.stringify(r);
    };
    assert.equal(await call(), await call());
  },
);

// The limit is clamped in the FUNCTION, not only in the HTTP route — a second caller
// must not be able to widen it.
test.skipIf(skip)("the feed clamps its own limit", async () => {
  const [{ r }] = await allRows<{ r: unknown[] }>(
    "SELECT declaration_events_feed(NULL, 100000) AS r",
  );
  assert.ok(r.length <= 200, `feed returned ${r.length} rows, expected <= 200`);
});

// NO INVENTED EVENT YEAR. The payload carries the period the register states (fiscalYear,
// nullable) — never declaration_year - 1, which is only correct for annual filings and
// would mislabel the year of a named person's transaction on every Entry/Vacate/Other.
test.skipIf(skip)(
  "the payload states the filing period, not a derived event year",
  async () => {
    const [{ r }] = await allRows<{
      r: { year: number; fiscalYear: number | null }[];
    }>("SELECT declaration_events_feed(NULL, 200) AS r");
    assert.ok(r.length > 0);
    assert.ok(
      r.every((x) => "fiscalYear" in x),
      "fiscalYear missing from the payload",
    );
    assert.ok(
      !r.some(
        (x) => (x as unknown as { eventYear?: number }).eventYear != null,
      ),
      "a derived eventYear is still being published",
    );
    // Where the register states a period on an ANNUAL filing it is year-1; on the one-off
    // filings it is the same year — which is exactly why it must not be computed.
    assert.ok(
      r.some((x) => x.fiscalYear === x.year || x.fiscalYear === x.year - 1),
      "fiscalYear does not track the filing year in either shape",
    );
  },
);

// THE INTERESTS FORMS ARE BEING READ. Two of the three declaration forms the register
// publishes are интереси filings with their own table numbering, and one of them (Dekl3)
// numbers its tables 1-9 — colliding with the asset form. Read against the asset map they
// published phantom holdings (565 filings, 808 fake assets, one €3.58bn "security" that
// was a loan contract number); the entry form (Dekl2) parsed to nothing at all. This is
// the corpus-level guard that the fix is still in place after a reload — the parser's own
// behaviour is pinned in scripts/declarations/parse_declaration.test.ts.
test.skipIf(skip)("the interests forms reach the corpus", async () => {
  const rows = await allRows<{ kind: string; n: string; valued: string }>(
    `SELECT kind, count(*) n, count(value_eur) valued FROM declaration_event
      WHERE kind IN ('interest_contract', 'related_person', 'early_repayment')
      GROUP BY kind`,
  );
  const byKind = new Map(rows.map((r) => [r.kind, r]));
  for (const kind of [
    "interest_contract",
    "related_person",
    "early_repayment",
  ]) {
    assert.ok(
      Number(byKind.get(kind)?.n ?? 0) > 0,
      `no ${kind} events — the interests forms are being dropped again`,
    );
  }
  // The two name-only tables state a relationship, never a sum. A value on one of them
  // would mean a cell was read as money that is not money — the exact shape of the
  // €3.58bn artifact.
  for (const kind of ["interest_contract", "related_person"]) {
    assert.equal(
      Number(byKind.get(kind)!.valued),
      0,
      `${kind} carries a declared value; that table has no money column`,
    );
  }
});

// The early-repayment amount comes from the declarant's own "Размер на задължението" /
// "Равностойност в лв." pair, NEVER from the free-text "правно основание" cell beside it.
// One declarant typed their loan CONTRACT NUMBER there, and reading it as a price is what
// put €3.58bn on a person's profile.
test.skipIf(skip)(
  "no early repayment is valued from a free-text cell",
  async () => {
    const [r] = await allRows<{ n: string; largest: string }>(
      `SELECT count(*) n, COALESCE(round(max(value_eur)), 0) largest
       FROM declaration_event WHERE kind = 'early_repayment'`,
    );
    // A debt an individual settles ahead of term is a mortgage at most. Anything past this
    // is a mis-read cell, not a repayment.
    assert.ok(
      Number(r.largest) < 5_000_000,
      `the largest early repayment is €${r.largest} across ${r.n} rows — that is a mis-read cell`,
    );
  },
);
