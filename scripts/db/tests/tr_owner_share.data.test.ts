// Gate for tr_owner_share (003) — the ONE definition of what percentage of a company a
// person owns, and the four surfaces that serve it: company_officers() + person_roles()
// (008), the company_person_roles matview (022) and mp_tr_roles() (150).
//
//   npm run test:data
//
// WHAT THIS EXISTS TO CATCH — TWO compounding defects, and the gate must fail on either
// one alone:
//
//   1. THE VINTAGE. The stored tr_person_roles.share divided each owner by the sum of
//      EVERY non-erased owner record, but the TR feed re-lists the whole partner set on
//      each capital change and never erases the prior vintage — so the denominator held a
//      company's cap table once per filing it had ever made.
//   2. THE CURRENCY. Since the euro changeover it also added лв and EUR as bare numbers.
//
// Corpus-wide before the fix: 10,400 companies understated (mean 50.4%) and 777
// overstated (mean 200.8%).
//
// ⚠️ THE OLD BEHAVIOUR ALSO SUMMED TO 100%, which is why it survived for years: ANY
// denominator built from its own row set is self-consistent. "The shares sum to 100" is
// therefore necessary and NOT sufficient, and the mutation check below does not use it —
// it reconciles the VIEW's own denominator against each company's registered capital,
// which is the only independent witness this corpus has.
//
// ⚠️ TWO REFERENCE COMPANIES, because neither can catch both defects. БИЛЯНА's two
// vintages carry identical лв:EUR proportions, so its percentages are invariant under the
// currency fold — a view that had stopped folding currency publishes БИЛЯНА correctly.
// МИТОТОПИЯ is the one that discriminates there.
//
// Requires the Postgres store + a loaded TR corpus (db:load:tr:pg). ⚠️ IT SKIPS ON THE
// SOURCE, NEVER ON THE TARGET — an absent or empty tr_owner_share is one of the states
// this file exists to catch, and 003's header documents the hand-written DROP … CASCADE
// that produces it. So the view's existence is ASSERTED, not folded into the skip.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, withClient, end } from "../lib/pg";
import { sumExecutionBuffers } from "../lib/explain_buffers";

/** The report that opened docs/plans/tr-owner-share-v1.md — the VINTAGE defect. */
const BILYANA = "104119056";
/** Two partners of one company filing in different currencies in one vintage — the
 *  CURRENCY defect. 40 EUR vs 60 BGN; unfolded this reads 40/60 and names the wrong
 *  majority owner. */
const MIXED_CURRENCY = "208164555";

const num = (v: unknown): number => Number(v);

// SOURCE-side probe only: is there a database, and is a TR corpus loaded in it? The
// TARGET (tr_owner_share, tr_share_eur) is deliberately absent from this predicate.
const haveDb = await dbReachable();
const ownerRows = haveDb
  ? num(
      (
        await allRows<{ n: string }>(
          "SELECT count(*) n FROM tr_person_roles WHERE role IN ('partner','sole_owner') AND erased_at IS NULL",
        ).catch(() => [{ n: "0" }])
      )[0]?.n ?? 0,
    )
  : 0;
const skip = !haveDb
  ? "Postgres unreachable"
  : ownerRows === 0
    ? "TR corpus not loaded (no active owner rows)"
    : false;

afterAll(async () => {
  await end();
});

// The current-vintage reconstruction, ONCE. It was hand-copied three times and one copy
// drifted from the view's own predicate (filtering share_amount where the view filters
// eur), which turned a currency refusal into "unexplained" — so the divergence this
// constant prevents is not hypothetical.
const CUR_CTE = `
  WITH ow AS (
    SELECT uic, name_fold, role, added_at, share_amount,
           tr_share_eur(share_amount, share_currency) AS eur,
           upper(btrim(coalesce(share_currency,''))) IN ('EUR','EURO','ЕВРО','€') AS is_eur,
           max(added_at) OVER (PARTITION BY uic) AS latest_at
      FROM tr_person_roles
     WHERE role IN ('partner','sole_owner') AND erased_at IS NULL),
  cur AS (
    SELECT * FROM ow
     WHERE latest_at IS NULL OR added_at = latest_at OR added_at IS NULL)`;

// ── The target exists ────────────────────────────────────────────────────────

test.skipIf(skip)("tr_owner_share and tr_share_eur exist", async () => {
  // Asserted rather than skipped on. 003's only supported way to retype share_pct is a
  // hand-written DROP … CASCADE, which since T2 also takes company_person_roles (022) —
  // a state that must fail loudly here rather than turn the file green by skipping.
  const [t] = await allRows<{ v: boolean; f: boolean }>(
    `SELECT to_regclass('tr_owner_share') IS NOT NULL AS v,
            to_regprocedure('tr_share_eur(numeric,text)') IS NOT NULL AS f`,
  );
  assert.ok(
    t.v,
    "tr_owner_share is missing — a DROP … CASCADE removed it (003's header)",
  );
  assert.ok(
    t.f,
    "tr_share_eur(numeric,text) is missing — apply 003_tr_search.sql",
  );
});

// ── The key, and why it needs all three columns ──────────────────────────────

test.skipIf(skip)(
  "tr_owner_share is unique on (uic, name_fold, role) so no consumer can fan out",
  async () => {
    // 022's UNIQUE INDEX on `key` catches a fan-out there; in 008's two functions the
    // same fan-out is SILENT — a duplicated officer row with a plausible percentage.
    const [d] = await allRows<{ n: string }>(`
      SELECT count(*) n FROM (
        SELECT uic, name_fold, role FROM tr_owner_share
        GROUP BY uic, name_fold, role HAVING count(*) > 1) x`);
    assert.equal(
      num(d.n),
      0,
      "tr_owner_share has duplicate (uic, name_fold, role)",
    );
  },
);

test.skipIf(skip)(
  "…and is NOT unique on (uic, name_fold), so dropping `role` from a join would fan out",
  async () => {
    // Non-vacuity for the test above: without this, a corpus where nobody holds two
    // roles at one company would let a two-column join pass forever.
    const [d] = await allRows<{ n: string }>(`
      SELECT count(*) n FROM (
        SELECT uic, name_fold FROM tr_owner_share
        GROUP BY uic, name_fold HAVING count(*) > 1) x`);
    assert.ok(
      num(d.n) > 0,
      "no (uic, name_fold) pair holds two roles — the three-column join rule is untested",
    );
  },
);

// ── The invariant ────────────────────────────────────────────────────────────

test.skipIf(skip)(
  "every company's published shares sum to 100% within the rounding residue",
  async () => {
    // ⚠️ Assert the TOLERANCE, never equality. share_pct is round(…, 4), so three equal
    // owners are 33.3333 × 3 = 99.9999 — 3,344 companies land off exact 100 by at most
    // 0.0055pp. An equality assertion fails on all of them.
    //
    // ⚠️ And this is NOT the mutation check: the defect this replaced summed to 100% too.
    const [r] = await allRows<{ bad: string; worst: string | null }>(`
      SELECT count(*) FILTER (WHERE abs(t - 100) > 0.01) AS bad,
             max(abs(t - 100)) AS worst
        FROM (SELECT uic, sum(share_pct) t FROM tr_owner_share
               WHERE share_pct IS NOT NULL GROUP BY uic) x`);
    assert.equal(
      num(r.bad),
      0,
      `companies whose shares do not sum to 100% (worst deviation ${r.worst})`,
    );
    assert.ok(num(r.worst) < 0.01, `rounding residue grew to ${r.worst}pp`);
  },
);

test.skipIf(skip)("no company publishes a share above 100%", async () => {
  const [r] = await allRows<{ n: string }>(
    "SELECT count(*) n FROM tr_owner_share WHERE share_pct > 100.0001",
  );
  assert.equal(num(r.n), 0, "a share exceeds 100%");
});

test.skipIf(skip)("no non-owner role carries a percentage", async () => {
  // tr_owner_share only admits partner/sole_owner; a manager with a percentage would
  // mean the role filter had been widened without the denominator being reconsidered.
  const [r] = await allRows<{ n: string }>(`
    SELECT count(*) n FROM tr_owner_share
     WHERE role NOT IN ('partner','sole_owner') AND share_pct IS NOT NULL`);
  assert.equal(num(r.n), 0, "a non-owner role carries an ownership percentage");
});

// ── The refusals, in precedence order ────────────────────────────────────────

test.skipIf(skip)(
  "a lone current sole_owner is 100% even with no declared amount",
  async () => {
    const [r] = await allRows<{ total: string; hundred: string }>(`
      WITH lone AS (
        SELECT uic FROM tr_owner_share GROUP BY uic
         HAVING count(*) = 1 AND bool_or(role = 'sole_owner'))
      SELECT count(*) AS total,
             count(*) FILTER (WHERE s.share_pct = 100) AS hundred
        FROM lone JOIN tr_owner_share s USING (uic)`);
    assert.ok(
      num(r.total) > 0,
      "no lone sole_owner company — refusal untested",
    );
    assert.equal(
      num(r.hundred),
      num(r.total),
      "a lone sole_owner did not publish 100%",
    );
  },
);

test.skipIf(skip)(
  "a sole_owner sharing its current vintage with partners publishes NO percentage",
  async () => {
    // The superseded-ЕООД case. Answering 100% here is what produced the 200.8% totals.
    const [r] = await allRows<{ total: string; nulls: string }>(`
      WITH mixed AS (
        SELECT uic FROM tr_owner_share GROUP BY uic
         HAVING bool_or(role = 'sole_owner') AND bool_or(role = 'partner'))
      SELECT count(*) FILTER (WHERE s.role = 'sole_owner') AS total,
             count(*) FILTER (WHERE s.role = 'sole_owner' AND s.share_pct IS NULL) AS nulls
        FROM mixed JOIN tr_owner_share s USING (uic)`);
    assert.ok(
      num(r.total) > 0,
      "no sole_owner+partner company — refusal untested",
    );
    assert.equal(
      num(r.nulls),
      num(r.total),
      "a sole_owner sharing its vintage with partners still published a percentage",
    );
  },
);

test.skipIf(skip)(
  "every refused company is attributable to a documented refusal",
  async () => {
    // ⚠️ The reason is derived from the BASE TABLE, not from share_eur. sum() skips
    // NULLs, so a person holding one valued and one unvalued record in the current
    // vintage has a NON-NULL share_eur inside a company the rule refuses — 22 such
    // groups over 16 companies exist, so reading the view alone misclassifies them.
    //
    // ⚠️ The predicates below MIRROR the view's, including `FILTER (WHERE eur IS NOT
    // NULL)` rather than `share_amount IS NOT NULL`. They agree today only because no
    // unrecognised currency exists; the moment one does — the case tr_share_eur's header
    // is written for — a share_amount-based copy would report the company as unexplained
    // and point the diagnosis away from the real cause.
    //
    // All four documented reasons are covered, including the non-positive total (0
    // companies today, but a company refused only by that must not read as unexplained).
    const [r] = await allRows<{
      refused: string;
      no_amount: string;
      restated: string;
      unexplained: string;
    }>(`${CUR_CTE},
      g AS (
        SELECT uic, name_fold, role,
               bool_or(share_amount IS NULL) AS no_amount,
               bool_or(added_at IS NULL AND latest_at IS NOT NULL) AS undated,
               count(DISTINCT is_eur) FILTER (WHERE eur IS NOT NULL) > 1 AS restated,
               bool_or(share_amount IS NOT NULL AND eur IS NULL) AS bad_currency,
               sum(eur) AS eur
          FROM cur GROUP BY uic, name_fold, role),
      per AS (
        SELECT uic, bool_or(no_amount) AS no_amount, bool_or(undated) AS undated,
               bool_or(restated) AS restated, bool_or(bad_currency) AS bad_currency,
               sum(eur) AS total_eur
          FROM g GROUP BY uic),
      ref AS (SELECT uic FROM tr_owner_share GROUP BY uic HAVING count(share_pct) = 0)
      SELECT count(*) AS refused,
             count(*) FILTER (WHERE p.no_amount) AS no_amount,
             count(*) FILTER (WHERE p.restated AND NOT p.no_amount) AS restated,
             count(*) FILTER (WHERE NOT p.no_amount AND NOT p.undated AND NOT p.restated
                                AND NOT p.bad_currency
                                AND NOT (p.total_eur IS NULL OR p.total_eur <= 0))
               AS unexplained
        FROM ref JOIN per p USING (uic)`);
    assert.ok(
      num(r.refused) > 0,
      "no company is refused — the rule is untested",
    );
    assert.equal(
      num(r.unexplained),
      0,
      `${r.unexplained} of ${r.refused} companies lost a percentage for no documented reason`,
    );
    // Both live refusals must still fire — a rule that stopped refusing would pass the
    // assertion above vacuously.
    assert.ok(num(r.no_amount) > 0, "the missing-amount refusal never fires");
    assert.ok(num(r.restated) > 0, "the restated-stake refusal never fires");
  },
);

test.skipIf(skip)(
  "one person's stake restated in both лв and EUR in a single vintage is refused, not summed",
  async () => {
    // The лв+EUR addition this view exists to remove, one level down: a holding carried
    // across the re-denomination is one stake recorded twice, and summing it publishes a
    // doubled position. 161 groups over 85 companies were published that way.
    const [r] = await allRows<{
      groups: string;
      published: string;
    }>(`${CUR_CTE},
      g AS (SELECT uic, name_fold, role FROM cur GROUP BY uic, name_fold, role
             HAVING count(DISTINCT is_eur) FILTER (WHERE eur IS NOT NULL) > 1)
      SELECT count(*) AS groups,
             count(*) FILTER (WHERE s.share_pct IS NOT NULL) AS published
        FROM g JOIN tr_owner_share s USING (uic, name_fold, role)`);
    assert.ok(
      num(r.groups) > 0,
      "no restated stake in the corpus — refusal untested",
    );
    assert.equal(
      num(r.published),
      0,
      `${r.published} restated stakes still publish a percentage built by adding лв to EUR`,
    );
  },
);

// ── The two reference cases ──────────────────────────────────────────────────

test.skipIf(skip)(
  "БИЛЯНА ООД publishes 75.5% / 24.5% on every surface that serves a share",
  async (ctx) => {
    const view = await allRows<{ name_fold: string; share_pct: string }>(
      "SELECT name_fold, share_pct FROM tr_owner_share WHERE uic = $1 ORDER BY share_pct DESC",
      [BILYANA],
    );
    // A genuinely absent company is a legitimate skip; a WRONG SHAPE is not — that is a
    // key or grouping regression, which is exactly what the first two tests are about.
    if (view.length === 0) {
      ctx.skip(`${BILYANA} is not in this corpus`);
      return;
    }
    assert.equal(
      view.length,
      2,
      `${BILYANA} should have exactly two current owners, got ${view.length}`,
    );
    assert.equal(num(view[0].share_pct).toFixed(2), "75.54");
    assert.equal(num(view[1].share_pct).toFixed(2), "24.46");

    // The four consumers must agree with the view — and with each other. A surface still
    // reading tr_person_roles.share would answer 25.57 / 8.28 here.
    const officers = await allRows<{ share: string; share_eur: string }>(
      "SELECT share, share_eur FROM company_officers($1) ORDER BY share DESC",
      [BILYANA],
    );
    assert.deepEqual(
      officers.map((o) => num(o.share).toFixed(2)),
      ["75.54", "24.46"],
      "company_officers() disagrees with tr_owner_share",
    );
    // share_eur must be the figure the percentage is built from, not a stray record.
    const totalEur = officers.reduce((a, o) => a + num(o.share_eur), 0);
    for (const o of officers)
      assert.ok(
        Math.abs((num(o.share_eur) / totalEur) * 100 - num(o.share)) < 0.01,
        "share_eur does not reconcile with the share it is printed beside",
      );

    const matview = await allRows<{ share: string }>(
      "SELECT share FROM company_person_roles WHERE uic = $1 AND active = 1 ORDER BY share DESC",
      [BILYANA],
    );
    assert.deepEqual(
      matview.map((m) => num(m.share).toFixed(2)),
      ["75.54", "24.46"],
      "company_person_roles disagrees with tr_owner_share (stale? REFRESH it)",
    );

    const person = await allRows<{ share: string }>(
      "SELECT share FROM person_roles($1) WHERE uic = $2",
      [view[0].name_fold, BILYANA],
    );
    assert.equal(
      num(person[0]?.share).toFixed(2),
      "75.54",
      "person_roles() disagrees with tr_owner_share",
    );
  },
);

test.skipIf(skip)(
  "a vintage mixing лв and EUR across two partners is folded before the percentage",
  async (ctx) => {
    // ⚠️ БИЛЯНА CANNOT CATCH THE CURRENCY DEFECT, and that is structural rather than bad
    // luck: both of its vintages carry the same лв:EUR proportions (12564:4068 and
    // 6428.58:2081.46 are both 75.54:24.46), so its percentages are invariant under the
    // fold. A view that had stopped calling tr_share_eur publishes БИЛЯНА correctly and
    // passes every other assertion in this file, while 58 companies move.
    //
    // МИТОТОПИЯ is the discriminator: 40 EUR against 60 BGN (= 30.68 EUR) in ONE vintage.
    // Unfolded that reads 40% / 60% — the MAJORITY OWNER FLIPS.
    //
    // It doubles as positive evidence for the restated-stake refusal: two DIFFERENT
    // people, one лв and one EUR in one vintage, correctly NOT refused (the predicate
    // groups per name_fold).
    const rows = await allRows<{ share_pct: string; share_eur: string }>(
      "SELECT share_pct, share_eur FROM tr_owner_share WHERE uic = $1 ORDER BY share_pct DESC",
      [MIXED_CURRENCY],
    );
    if (rows.length === 0) {
      ctx.skip(`${MIXED_CURRENCY} is not in this corpus`);
      return;
    }
    assert.equal(
      rows.length,
      2,
      `${MIXED_CURRENCY} should have two current owners`,
    );
    assert.equal(num(rows[0].share_pct).toFixed(2), "56.60");
    assert.equal(num(rows[1].share_pct).toFixed(2), "43.40");
    assert.ok(
      num(rows[0].share_eur) > num(rows[1].share_eur),
      "the EUR-filed partner is not the larger holding — лв was added to EUR as a bare number",
    );
  },
);

test.skipIf(skip)(
  "the currency fold changes a published percentage corpus-wide, not just on one company",
  async () => {
    // Keeps the property above from going vacuous if МИТОТОПИЯ ever leaves the corpus:
    // somewhere in the corpus, folding must change the answer. Compares each company's
    // published share against the ratio the SAME rows would give unfolded.
    const [r] = await allRows<{ moved: string }>(`${CUR_CTE},
      g AS (SELECT uic, name_fold, role, sum(eur) AS eur, sum(share_amount) AS raw
              FROM cur GROUP BY uic, name_fold, role),
      w AS (SELECT uic, name_fold, role,
                   100 * eur / nullif(sum(eur) OVER (PARTITION BY uic), 0) AS folded,
                   100 * raw / nullif(sum(raw) OVER (PARTITION BY uic), 0) AS unfolded
              FROM g)
      SELECT count(DISTINCT uic) AS moved FROM w
        JOIN tr_owner_share s USING (uic, name_fold, role)
       WHERE s.share_pct IS NOT NULL AND abs(w.folded - w.unfolded) > 0.01`);
    assert.ok(
      num(r.moved) > 0,
      "no published percentage differs from its unfolded ratio — the currency fold is untested",
    );
  },
);

test.skipIf(skip)(
  "no serving surface still reads the stored tr_person_roles.share",
  async (ctx) => {
    // Corpus-wide rather than one company: pick any company where the stored and derived
    // values differ and assert company_officers() reports the derived one.
    const [c] = await allRows<{ uic: string }>(`
      SELECT r.uic
        FROM tr_person_roles r
        JOIN tr_owner_share s
          ON s.uic = r.uic AND s.name_fold = r.name_fold AND s.role = r.role
       WHERE r.erased_at IS NULL AND r.share IS NOT NULL AND s.share_pct IS NOT NULL
         AND abs(r.share - s.share_pct) > 1
       ORDER BY r.uic LIMIT 1`);
    if (!c) {
      ctx.skip(
        "stored and derived shares agree everywhere — nothing to discriminate",
      );
      return;
    }
    const rows = await allRows<{
      share: string;
      derived: string;
      stored: string;
    }>(
      `SELECT o.share,
              (SELECT s.share_pct FROM tr_owner_share s
                WHERE s.uic = $1 AND s.role = o.role
                  AND s.name_fold = translit_bg_latin(o.name)) AS derived,
              (SELECT max(r.share) FROM tr_person_roles r
                WHERE r.uic = $1 AND r.role = o.role
                  AND r.name_fold = translit_bg_latin(o.name) AND r.erased_at IS NULL) AS stored
         FROM company_officers($1) o
        WHERE o.share IS NOT NULL`,
      [c.uic],
    );
    assert.ok(rows.length > 0, `company_officers(${c.uic}) published no share`);
    for (const r of rows)
      assert.equal(
        num(r.share),
        num(r.derived),
        `company_officers(${c.uic}) served the stored share (${r.stored}), not the derived one`,
      );
  },
);

test.skipIf(skip)("no FIFTH consumer reads tr_person_roles.share", async () => {
  // 003's header claims the four serving surfaces are the complete set. A catalog sweep
  // is what keeps that claim true: a new function or view reading the stored column
  // fails here until someone decides, in the style of
  // declaration_filed_position.data.test.ts's LISTING_LABEL_EXCEPTIONS.
  //
  // ⚠️ Match the bare `share` word only, and only as a COLUMN REFERENCE.
  // declaration_stake_company (096) reads tr_person_roles for `share_size` from the
  // declarations side and is not a reader of this column — but it also carries
  // `COALESCE(s.stake_kind, 'share'::text)`, a string LITERAL. So string literals are
  // stripped before the share_* column names are, or the sweep reports a false positive
  // that a reader would have to re-diagnose from scratch every time.
  const KNOWN = new Set([
    "company_officers",
    "person_roles",
    "company_person_roles",
    "mp_tr_roles",
  ]);
  const rows = await allRows<{ name: string }>(`
    SELECT p.proname AS name
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       -- prokind 'f' only: pg_get_functiondef RAISES on an aggregate ("array_agg is an
       -- aggregate function"), and public holds several, so an unfiltered sweep errors
       -- out instead of reporting.
       AND p.prokind = 'f'
       AND pg_get_functiondef(p.oid) ~ 'tr_person_roles'
       AND regexp_replace(
             regexp_replace(pg_get_functiondef(p.oid), '''[^'']*''', '', 'g'),
             'share_(pct|eur|amount|currency|size)', '', 'g') ~ '\\mshare\\M'
    UNION
    SELECT c.relname
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('v','m')
       AND pg_get_viewdef(c.oid) ~ 'tr_person_roles'
       AND regexp_replace(
             regexp_replace(pg_get_viewdef(c.oid), '''[^'']*''', '', 'g'),
             'share_(pct|eur|amount|currency|size)', '', 'g') ~ '\\mshare\\M'`);
  const extra = rows.map((r) => r.name).filter((n) => !KNOWN.has(n));
  assert.deepEqual(
    extra,
    [],
    `undeclared reader(s) of tr_person_roles.share: ${extra.join(", ")} — repoint onto tr_owner_share or add to 003's list`,
  );
});

// ── Currency vocabulary ──────────────────────────────────────────────────────

test.skipIf(skip)(
  "no owner amount is valued through the peg fallback by accident",
  async () => {
    // tr_share_eur treats anything that is not a EUR spelling as лв, and REFUSES a
    // spelling it does not recognise at all. This asserts no new currency has appeared
    // unnoticed AND that any which has is refused rather than silently pegged.
    //
    // The vocabulary mirrors tr_share_eur's own (003) — EURO / ЕВРО / € included. An
    // earlier hand-copied allowlist held only EUR, which would have turned a supported
    // euro spelling into a false failure the day the feed emitted one.
    const known = new Set([
      "(NULL)",
      "",
      "BGN",
      "BGL",
      "ЛВ",
      "ЛВ.",
      "ЛЕВА",
      "ЛЕВ",
      "EUR",
      "EURO",
      "ЕВРО",
      "€",
    ]);
    const rows = await allRows<{ cur: string; n: string }>(`
      SELECT coalesce(share_currency, '(null)') AS cur, count(*) n
        FROM tr_person_roles
       WHERE role IN ('partner','sole_owner') AND erased_at IS NULL
         AND share_amount IS NOT NULL
       GROUP BY 1 ORDER BY 2 DESC`);
    const unknown = rows.filter((r) => !known.has(r.cur.trim().toUpperCase()));
    for (const u of unknown) {
      // Scoped exactly as the outer query — an unscoped count reaches rows outside the
      // owner set and would report a currency this rule never sees.
      const [v] = await allRows<{ n: string }>(
        `SELECT count(*) n FROM tr_person_roles
          WHERE role IN ('partner','sole_owner') AND erased_at IS NULL
            AND share_currency = $1
            AND tr_share_eur(share_amount, share_currency) IS NOT NULL`,
        [u.cur],
      );
      assert.equal(
        num(v.n),
        0,
        `unrecognised currency ${u.cur} (${u.n} rows) was valued instead of refused`,
      );
    }
  },
);

// ── The mutation check ───────────────────────────────────────────────────────

test.skipIf(skip)(
  "the VIEW's denominator reconciles with registered capital far better than the all-active sum it replaced",
  async () => {
    // ⚠️ This must read tr_owner_share, or it is a calibration argument about the RULE
    // rather than a check on the IMPLEMENTATION. An earlier draft rebuilt both
    // denominators inside the test; with the vintage filter deleted from the view its
    // result was byte-identical, so it could not have caught the original defect at all.
    //
    // ⚠️ And it deliberately does NOT use "sums to 100%". The OLD denominator summed to
    // 100% too — any denominator built from its own row set does — which is exactly why
    // the defect survived. tr_companies.funds_amount is the only independent witness.
    //
    // Either currency basis is accepted on both sides: funds_currency is unpopulated
    // corpus-wide, so the registered capital may be recorded either side of the
    // re-denomination, and guessing one would measure the corpus's vintage mix rather
    // than the rule (that guess is why an earlier draft reported 67.4% instead of 95.0%).
    const [r] = await allRows<{
      n: string;
      view_sum: string;
      all_active: string;
    }>(`
      WITH act AS (SELECT uic, added_at FROM tr_person_roles
                    WHERE role='partner' AND erased_at IS NULL AND share_amount IS NOT NULL),
      multi AS (SELECT uic FROM act GROUP BY uic HAVING count(DISTINCT added_at) > 1),
      view_sum AS (SELECT s.uic, sum(s.share_eur) e FROM tr_owner_share s
                     JOIN multi USING (uic) GROUP BY s.uic),
      -- the control: the defect this replaced, hand-rolled so the two cannot regress together.
      all_sum AS (SELECT a.uic, sum(a.share_amount) e FROM tr_person_roles a
                    JOIN multi USING (uic)
                   WHERE a.role='partner' AND a.erased_at IS NULL AND a.share_amount IS NOT NULL
                   GROUP BY a.uic)
      SELECT count(*) AS n,
             count(*) FILTER (WHERE abs(v.e - c.funds_amount) <= greatest(0.02, c.funds_amount*0.005)
                                 OR abs(v.e - c.funds_amount/1.95583) <= greatest(0.02, c.funds_amount*0.005))
               AS view_sum,
             count(*) FILTER (WHERE abs(a.e - c.funds_amount) <= greatest(0.02, c.funds_amount*0.005)
                                 OR abs(a.e - c.funds_amount/1.95583) <= greatest(0.02, c.funds_amount*0.005))
               AS all_active
        FROM multi JOIN tr_companies c USING (uic)
        JOIN view_sum v USING (uic) JOIN all_sum a USING (uic)
       WHERE c.funds_amount > 0`);
    assert.ok(
      num(r.n) > 100,
      "too few multi-vintage companies to discriminate",
    );
    assert.ok(
      num(r.view_sum) > num(r.all_active) * 5,
      `the view's denominator has stopped discriminating: ${r.view_sum} vs all-active ${r.all_active} of ${r.n}`,
    );
  },
);

test.skipIf(skip)(
  "an undated owner row in a dated company refuses rather than inflating the survivors",
  async () => {
    // Constructed, because the corpus has 0 examples — a corpus-derived test is vacuous
    // here. max(added_at) ignores NULLs, so an undated row would fail `added_at =
    // latest_at` and leave BOTH sides of the fraction, silently inflating everyone else
    // while the survivors still summed to 100%.
    await withClient(async (c) => {
      await c.query("BEGIN");
      try {
        const uic = "__tr_owner_share_test__";
        await c.query(
          `INSERT INTO tr_person_roles (uic, name, role, share_amount, share_currency, added_at)
           VALUES ($1,'ТЕСТ ЕДИН ЛИЦЕ','partner',50,'EUR','2026-01-01'),
                  ($1,'ТЕСТ ДВЕ ЛИЦЕ','partner',50,'EUR','2026-01-01'),
                  ($1,'ТЕСТ ТРИ ЛИЦЕ','partner',50,'EUR',NULL)`,
          [uic],
        );
        const rows = await c.query<{ share_pct: string | null }>(
          "SELECT share_pct FROM tr_owner_share WHERE uic = $1",
          [uic],
        );
        assert.equal(
          rows.rows.length,
          3,
          "the undated owner vanished from the view",
        );
        for (const r of rows.rows)
          assert.equal(
            r.share_pct,
            null,
            "an undated owner row was dropped and the survivors were inflated to 50/50",
          );
      } finally {
        await c.query("ROLLBACK");
      }
    });
  },
);

// ── Query plans ──────────────────────────────────────────────────────────────

/**
 * ⚠️ NOT a bare /Index Cond: \(uic = /. person_roles also LEFT JOINs tr_companies on uic,
 * so that matches from tr_companies_pkey even when the view's own scan has degraded to a
 * full index scan — measured on the regressed LEFT JOIN form, 184,292 buffers with the
 * bare regex still matching. Anchor on the NODE that scans the view's base table.
 */
const VIEW_PROBE =
  /Index Scan using idx_tr_person_roles_uic on tr_person_roles \w+[^\n]*\n\s*Index Cond: \(uic = /;

test.skipIf(skip)(
  "person_roles() does not materialise the whole view",
  async (ctx) => {
    // The regression that shipped green in T2's first cut: person_roles has no constant
    // uic, so a plain LEFT JOIN made the planner build all 455k view rows to answer for
    // one person — 200,666 buffers / 1,465 ms, on a route a crawler walks under a 10 s
    // statement_timeout. Correlated, it is ~104.
    const [p] = await allRows<{ name_fold: string }>(`
      SELECT name_fold FROM tr_owner_share
       WHERE share_pct IS NOT NULL
       GROUP BY name_fold HAVING count(*) BETWEEN 2 AND 8
       ORDER BY name_fold LIMIT 1`);
    if (!p) {
      ctx.skip("no owner holds 2-8 companies — plan fixture is empty");
      return;
    }
    const plan = await allRows<{ "QUERY PLAN": string }>(
      "EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) SELECT * FROM person_roles($1)",
      [p.name_fold],
    );
    const buffers = sumExecutionBuffers(plan);
    assert.ok(
      buffers < 5000,
      `person_roles touched ${buffers} buffers — the view is being materialised`,
    );
    // The ceiling alone goes vacuous the moment someone picks a person with fewer
    // companies. This is the property that actually matters.
    assert.match(
      plan.map((r) => r["QUERY PLAN"]).join("\n"),
      VIEW_PROBE,
      "the view's own scan carries no per-uic qual — the share lookup is no longer correlated",
    );
  },
);

test.skipIf(skip)(
  "company_officers() stays a per-company index probe on the largest company",
  async () => {
    const [big] = await allRows<{ uic: string }>(
      "SELECT uic FROM tr_person_roles GROUP BY uic ORDER BY count(*) DESC, uic LIMIT 1",
    );
    const plan = await allRows<{ "QUERY PLAN": string }>(
      "EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) SELECT * FROM company_officers($1)",
      [big.uic],
    );
    const buffers = sumExecutionBuffers(plan);
    assert.ok(
      buffers < 5000,
      `company_officers(${big.uic}) touched ${buffers} buffers — the uic no longer reaches the view`,
    );
    // Symmetric with person_roles above: the shape, not just the count.
    assert.match(
      plan.map((r) => r["QUERY PLAN"]).join("\n"),
      VIEW_PROBE,
      `company_officers(${big.uic}) no longer pushes uic into the view`,
    );
  },
);
