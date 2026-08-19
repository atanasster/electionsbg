// Gate for „В страната" / „В чужбина" — WHERE a declared money row sits.
//
// THE RULE. Tables 5 („Банкови влогове") and 8 („Вложения в инвестиционни и пенсионни
// фондове") carry a domestic/abroad cell pair the register does not validate. It is free
// text — 5,691 distinct spellings on the „В страната" side, 597 on the other — and the two
// columns contradict each other often enough that no boolean can represent the answer:
// 346 rows leave both blank, ~130 tick both, and ~93 SPLIT one amount across the two.
// classifyHeldPlace (scripts/declarations/held_abroad.ts) resolves it at PARSE time into a
// tri-state that is STORED, so nothing re-derives the rule at query time.
//
// WHY THIS TEST. Three things about the shape are easy to get backwards, and the first two
// were in the original specification of this work:
//
//   1. TABLE 4 („Налични парични средства") HAS NEITHER COLUMN, and its Cell Num=7 is
//      „Произход на средствата". Reading the pair off table 4 does not yield a blank — it
//      yields the funds origin, so all 25,717 cash rows would publish as held in a country
//      called „заплата".
//   2. The pre-2018 form carries the pair on TABLE 7 at cells 6/7, not 7/8. columnResolver
//      already shifts it (EGN_COLUMN.bank = 6), so this holds only as long as the pair is
//      passed through `col()` like every other cell.
//   3. NULL IS NOT 'domestic' AND NOT 'unknown'. NULL means the row's table has no such
//      question; 'unknown' means the filing answered unintelligibly. Folding either into
//      „held in Bulgaria" publishes a claim about a named person that nobody made.
//
// Auto-skips when Postgres is down or the corpus is empty.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";
import { classifyHeldPlace } from "../../declarations/held_abroad";

const n = (v: unknown): number => Number(v ?? 0);

const reachable = async (): Promise<boolean> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.declaration_asset') IS NOT NULL AS ok",
    );
    if (!t?.ok) return false;
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM declaration_asset",
    );
    return n(c.n) > 0;
  } catch {
    return false;
  }
};

// A database whose corpus predates the backfill has held_scope NULL everywhere. That is a
// legitimate state — 089 defines NULL as "this row's table has no such question", so such a
// database serves exactly what it served before — but every assertion below would then pass
// vacuously. Skip with a DISTINCT reason, so "the corpus has no provenance yet" can never
// read as "the rule is enforced".
const stamped = async (): Promise<boolean> => {
  const [c] = await allRows<{ n: string }>(
    "SELECT count(*) n FROM declaration_asset WHERE held_scope IS NOT NULL",
  );
  return n(c.n) > 0;
};

const haveDb = await reachable();
const haveProvenance = haveDb ? await stamped() : false;
const skip = !haveDb
  ? "Postgres unreachable / declaration_asset empty"
  : !haveProvenance
    ? "declaration_asset.held_scope is entirely NULL — run scripts/declarations/backfill_asset_held_abroad.ts --apply, then db:load:declarations:pg"
    : false;

afterAll(async () => {
  await end();
});

// ---------------------------------------------------------------------------
// 1. Provenance. The pair exists on exactly two tables, and the vocabulary is closed.
// ---------------------------------------------------------------------------
test.skipIf(skip)(
  "held_scope is populated on tables 5 and 8 and NOWHERE else",
  async () => {
    const rows = await allRows<{ table_num: string | null; n: string }>(
      `SELECT table_num, count(*) n FROM declaration_asset
        WHERE held_scope IS NOT NULL GROUP BY 1 ORDER BY 1`,
    );
    assert.deepEqual(
      rows.map((r) => r.table_num).sort(),
      ["5", "8"],
      `held_scope must exist only on tables 5 and 8, got ${JSON.stringify(rows)}. ` +
        `Table 4 is the trap: its Cell Num=7 is „Произход на средствата", not „В страната".`,
    );
    for (const r of rows) assert.ok(n(r.n) > 0);
  },
);

test.skipIf(skip)(
  "every table 4 (cash) row has a NULL held_scope",
  async () => {
    // Stated separately from the test above because this is the specific defect that would
    // publish 25,717 cash rows as held in a country named after the declarant's salary.
    const [c] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM declaration_asset
        WHERE table_num = '4' AND (held_scope IS NOT NULL OR held_country IS NOT NULL)`,
    );
    assert.equal(
      n(c.n),
      0,
      "table 4 carries no В страната / В чужбина columns at all — any value here means the parser read Произход на средствата as a place",
    );
  },
);

test.skipIf(skip)("the held_scope vocabulary is closed", async () => {
  const rows = await allRows<{ held_scope: string }>(
    `SELECT DISTINCT held_scope FROM declaration_asset WHERE held_scope IS NOT NULL`,
  );
  const got = rows.map((r) => r.held_scope).sort();
  assert.deepEqual(
    got,
    ["abroad", "domestic", "unknown"],
    `unexpected held_scope value(s): ${JSON.stringify(got)}. 089 carries no CHECK on purpose — a value a future parser adds must land as data rather than abort the COPY — so this test is the gate.`,
  );
});

// ---------------------------------------------------------------------------
// 2. The country is a SEPARATE and much narrower question than the scope.
// ---------------------------------------------------------------------------
test.skipIf(skip)(
  "a country is never attached to a row that is not abroad",
  async () => {
    const [c] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM declaration_asset
        WHERE held_country IS NOT NULL AND held_scope IS DISTINCT FROM 'abroad'`,
    );
    assert.equal(
      n(c.n),
      0,
      "held_country may only be set on held_scope = 'abroad'",
    );
  },
);

test.skipIf(skip)(
  "most abroad rows name no country — a null country is NOT evidence of being domestic",
  async () => {
    const [c] = await allRows<{ abroad: string; named: string }>(
      `SELECT count(*) FILTER (WHERE held_scope = 'abroad') abroad,
              count(*) FILTER (WHERE held_scope = 'abroad' AND held_country IS NOT NULL) named
         FROM declaration_asset`,
    );
    const abroad = n(c.abroad);
    const named = n(c.named);
    assert.ok(abroad > 0, "the corpus must contain abroad rows");
    assert.ok(named > 0, "some abroad rows must name a country");
    // „да" in the „В чужбина" column says abroad and names nowhere — 1,576 rows of it. This
    // asserts the gap is REAL and large, so that a future surface reporting „where" cannot
    // quietly present the named subset as the whole of the money held abroad.
    assert.ok(
      named < abroad / 2,
      `expected the named-country subset to be a small minority of abroad rows, got ${named}/${abroad} — if this ever flips, the copy on any "where is the money" surface has to be revisited`,
    );
  },
);

// ---------------------------------------------------------------------------
// 3. Mutation check. The assertions above are all satisfiable by an implementation that
//    resolved the pair differently, so re-derive the stored value from the stored RAW cells
//    and require agreement. This is what the raw columns are for.
// ---------------------------------------------------------------------------
test.skipIf(skip)(
  "every stored held_scope re-derives from the stored raw cells",
  async () => {
    const rows = await allRows<{
      held_scope: string;
      held_country: string | null;
      held_raw_in_country: string | null;
      held_raw_abroad: string | null;
      n: string;
    }>(
      `SELECT held_scope, held_country, held_raw_in_country, held_raw_abroad, count(*) n
         FROM declaration_asset WHERE held_scope IS NOT NULL
        GROUP BY 1,2,3,4`,
    );
    assert.ok(rows.length > 100, "expected a wide variety of raw fillings");
    const bad: string[] = [];
    let checked = 0;
    for (const r of rows) {
      const want = classifyHeldPlace(r.held_raw_in_country, r.held_raw_abroad);
      checked += n(r.n);
      if (
        want.scope !== r.held_scope ||
        (want.country ?? null) !== r.held_country
      )
        bad.push(
          `(${JSON.stringify(r.held_raw_in_country)}, ${JSON.stringify(r.held_raw_abroad)}) ` +
            `stored ${r.held_scope}/${r.held_country} but the rule says ${want.scope}/${want.country} — ${r.n} rows`,
        );
    }
    assert.deepEqual(
      bad.slice(0, 10),
      [],
      `stored classification disagrees with classifyHeldPlace on ${bad.length} distinct fillings — the corpus predates a rule change; re-run backfill_asset_held_abroad.ts --apply then reload`,
    );
    assert.ok(checked > 1000, "the sweep must actually cover the corpus");
  },
);

// ---------------------------------------------------------------------------
// 4. Non-vacuity + a ceiling on how much the rule declines to answer. 'unknown' is a real
//    answer, but a rule that started answering it everywhere would be indistinguishable
//    from one that works, since nothing downstream errors on it.
// ---------------------------------------------------------------------------
test.skipIf(skip)(
  "the corpus resolves overwhelmingly, and 'unknown' stays a residue",
  async () => {
    const [c] = await allRows<{
      total: string;
      dom: string;
      abroad: string;
      unknown: string;
    }>(
      `SELECT count(*) total,
              count(*) FILTER (WHERE held_scope = 'domestic') dom,
              count(*) FILTER (WHERE held_scope = 'abroad')   abroad,
              count(*) FILTER (WHERE held_scope = 'unknown')  unknown
         FROM declaration_asset WHERE held_scope IS NOT NULL`,
    );
    const total = n(c.total);
    assert.ok(total > 50_000, `expected the full money corpus, got ${total}`);
    // Measured 2026-08-19: 95.5% domestic, 4.1% abroad, 0.4% unknown over 76,953 rows.
    assert.ok(
      n(c.unknown) / total < 0.03,
      `'unknown' is ${((100 * n(c.unknown)) / total).toFixed(2)}% of money rows — the rule has stopped resolving the ordinary fillings`,
    );
    assert.ok(
      n(c.abroad) / total > 0.01 && n(c.abroad) / total < 0.2,
      `abroad is ${((100 * n(c.abroad)) / total).toFixed(2)}% of money rows — outside the range the corpus has ever shown`,
    );
    assert.ok(
      n(c.dom) > n(c.abroad),
      "most declared money is held in Bulgaria",
    );
  },
);

// ---------------------------------------------------------------------------
// 5. The worked example this whole change came from — Иво Христов Петков's 2026 filing,
//    whose 228,100 EUR account is the one the register marks „Белгия" and the corpus held
//    as indistinguishable from his five domestic ones. See
//    docs/audits/actualno-hristov-koprinkov-yotova-2026-08-19.md.
// ---------------------------------------------------------------------------
test.skipIf(skip)("the Belgian account is distinguishable", async () => {
  const rows = await allRows<{
    amount: string;
    held_scope: string;
    held_country: string | null;
  }>(
    `SELECT a.amount, a.held_scope, a.held_country
       FROM declaration_asset a JOIN declaration d USING (declaration_id)
      WHERE d.source_url LIKE '%2228B9610E35233424%' AND a.table_num = '5'
      ORDER BY a.seq`,
  );
  if (rows.length === 0) return; // filing not in this database's tier selection
  const belgian = rows.filter((r) => r.held_country === "Белгия");
  assert.equal(belgian.length, 1, "exactly one account is declared in Belgium");
  assert.equal(n(belgian[0].amount), 228100);
  assert.ok(
    rows.filter((r) => r.held_scope === "domestic").length >= 5,
    "his other accounts stay domestic",
  );
});
