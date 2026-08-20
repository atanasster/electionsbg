// A8 — reconcile the ЦАИС ЕОП dossier against the corpus it overlaps.
// docs/plans/tender-dossier-ingest-v1.md §5 (A8), §1.4, §1.5.
//
// The dossier is a SECOND source for two things the corpus already models, and the
// plan's instruction was explicit: reconcile them, do not ship two disagreeing
// figures. This file is that reconciliation, expressed as a gate.
//
//   annexes  — `tender_contract_item.annexes` from the register vs
//              `procurement_annexes` (migration 114), built from the ЦАИС annex
//              cache by a different pipeline
//   place    — `tender_buyer_profile.city` vs `awarder_seats.settlement`, the
//              buyer-HQ crosswalk the by-settlement map is built on
//
// ⚠️ THE THRESHOLDS ARE FLOORS UNDER A MEASUREMENT, NOT TARGETS. Each was measured
// on the 2026-08 capture and set below the observed value, so the gate fires when
// the two sources DIVERGE — it is not an assertion that either is correct. A gate
// pinned at the exact observed number would fail on the next crawl for no reason.

import { describe, test, expect, afterAll } from "vitest";
import { allRows, dbReachable, end } from "../lib/pg";

const haveDb = await dbReachable();
const skip = !haveDb;

afterAll(async () => {
  await end();
});

/**
 * How many rows satisfy a predicate — the non-vacuity probe every gate below runs
 * on its OWN source before measuring agreement.
 *
 * ⚠️ THIS IS THE POINT OF THE FILE, NOT BOILERPLATE. An earlier revision checked
 * only that `tender_dossier` was non-empty and then let each gate `return` early on
 * a small sample. Verified by wiping each source column inside a rolled-back
 * transaction: emptying `annexes`, NULLing `currency_code` and NULLing `city` each
 * left the corresponding gate PASSING, because "no rows to compare" and "the rows
 * agree" took the same branch. Those are exactly the parser regressions A8 exists to
 * catch, and `tender_dossier`'s row count does not move through any of them.
 */
const countWhere = async (sql: string): Promise<number> => {
  const [r] = await allRows<{ n: string }>(sql);
  return Number(r.n);
};

describe.skipIf(skip)("tender dossier reconciliation", () => {
  test("the capture is present — otherwise everything below passes vacuously", async () => {
    expect(
      await countWhere("SELECT count(*)::text AS n FROM tender_dossier"),
    ).toBeGreaterThan(0);
  });

  // ---- annexes -------------------------------------------------------------

  test("annex counts CORROBORATE procurement_annexes where both sources speak", async () => {
    // Non-vacuity: this gate is meaningless if our side carries no annexes at all.
    expect(
      await countWhere(
        "SELECT count(*)::text AS n FROM tender_contract_item WHERE jsonb_array_length(annexes) > 0",
      ),
    ).toBeGreaterThan(0);

    const [r] = await allRows<{ both: string; agree: string }>(
      // ⚠️ count(DISTINCT notice_id), not count(*). `procurement_annexes` is keyed
      // on contract_key and one УНП fans out to one row PER SUPPLIER, so a single
      // annex on a two-supplier contract counts twice. Confirmed on
      // 00311-2020-0018 (notice_id 512960 across two keys).
      //
      // ⚠️ Scoped to `tender_dossier`. 114 covers all ~131k procedures while the
      // capture is a few thousand, so an unscoped comparison measures CRAWL
      // COVERAGE, not agreement — measured, it reported 0.9%.
      `WITH scope AS (SELECT unp FROM tender_dossier),
       ours AS (
         SELECT unp, sum(jsonb_array_length(annexes))::int AS n
           FROM tender_contract_item GROUP BY unp
       ), theirs AS (
         SELECT c.unp, count(DISTINCT pa.notice_id)::int AS n
           FROM procurement_annexes pa JOIN contracts c ON c.key = pa.contract_key
          WHERE c.unp IS NOT NULL GROUP BY c.unp
       )
       SELECT count(*)::text AS both,
              count(*) FILTER (WHERE o.n = t.n)::text AS agree
         FROM scope s JOIN ours o USING (unp) JOIN theirs t USING (unp)
        WHERE o.n > 0 AND t.n > 0`,
    );
    const both = Number(r.both);
    if (both < 20) return; // too small a capture to say anything
    // Measured 2026-08: 100 of 101 (99.0%). The two arrive by completely different
    // routes — ours from GetPublishedContractListItems, 114's from the ЦАИС annex
    // open-data cache — so this is real corroboration, not one source echoing.
    expect(Number(r.agree) / both).toBeGreaterThan(0.9);
  });

  test("the dossier's annex list is SPARSER than 114, and never the reverse at scale", async () => {
    // ⚠️ THE A8 ANSWER, and it is not "the two agree". Compared two-directionally
    // within the capture, only 100 of 182 УНП match: on 69 we report ZERO annexes
    // where 114 has some, spread evenly across 2020–2025 (19/11/12/13/12/2), so it
    // is systematic sparseness rather than an era artifact.
    //
    // Therefore `procurement_annexes` REMAINS THE SOURCE OF TRUTH for annexes, and
    // `tender_contract_item.annexes` is corroboration only. Anything that sums or
    // counts annexes must read 114 — reading this column would under-report by
    // ~38% of the affected procedures.
    //
    // What this gate actually protects is the DIRECTION. Our being sparser is known
    // and tolerated; our reporting annexes 114 has never heard of, at scale, would
    // mean the projection is inventing them — a different and much worse failure.
    const [r] = await allRows<{ we_zero: string; they_zero: string }>(
      `WITH scope AS (SELECT unp FROM tender_dossier),
       ours AS (
         SELECT unp, sum(jsonb_array_length(annexes))::int AS n
           FROM tender_contract_item GROUP BY unp
       ), theirs AS (
         SELECT c.unp, count(DISTINCT pa.notice_id)::int AS n
           FROM procurement_annexes pa JOIN contracts c ON c.key = pa.contract_key
          WHERE c.unp IS NOT NULL GROUP BY c.unp
       )
       SELECT count(*) FILTER (WHERE coalesce(o.n,0) = 0 AND coalesce(t.n,0) > 0)::text AS we_zero,
              count(*) FILTER (WHERE coalesce(o.n,0) > 0 AND coalesce(t.n,0) = 0)::text AS they_zero
         FROM scope s
         LEFT JOIN ours o USING (unp)
         LEFT JOIN theirs t USING (unp)
        WHERE coalesce(o.n,0) > 0 OR coalesce(t.n,0) > 0`,
    );
    const weZero = Number(r.we_zero);
    const theyZero = Number(r.they_zero);
    if (weZero + theyZero < 20) return;
    // Measured 2026-08: 69 vs 12. The inequality is the assertion.
    expect(theyZero).toBeLessThan(weZero);
  });

  // ---- currency ------------------------------------------------------------

  test("currency_code maps to a currency, so value_native is interpretable", async () => {
    // ⚠️ `tender_contract_item.value_native` is in the CONTRACT'S OWN currency and the
    // register identifies it only by an integer. Without this mapping the column cannot be
    // summed or compared across rows at all — 3 is BGN and 1 is EUR, so mixing them
    // silently inflates a total by ~1.96x.
    //
    // ⚠️⚠️ ANCHORED ON THE PEG, NOT ON `contracts.currency`. This test used to infer the
    // mapping by cross-tabbing against that column and requiring 80% agreement, and it
    // FAILED at 73.7% — which reads as "the dossier's currency_code is unreliable" and is
    // the wrong conclusion. `value_native / contracts.amount_eur` settles it: for the rows
    // where the two sources disagree the ratio is ~1.0, not ~1.96, so `value_native` really
    // is in euro and `currency_code = 1 → EUR` is right. It is the CONTRACTS side that is
    // mislabelled there (see the next test). The old comment blamed the 2026-01-01 euro
    // adoption; the year split refutes that too — 2026 is the CLEAN part (100 EUR against
    // 3 BGN) and the disagreement sits in 2021-2023, years with no switch in them.
    //
    // ⚠️ THE SHARE IS THE ASSERTION; THE MEDIAN ALONE CANNOT SEE THE FAILURE IT IS FOR.
    // Simulated in SQL: at 49% euro contamination, code 3's median is still exactly 1.9558
    // and a median-only test passes — it moves off the peg only past 50.0%. A code carrying
    // a MIX of currencies is precisely the state that makes `value_native` unusable, so the
    // test measures how many rows sit at the expected multiplier, not where the middle one
    // lands. Both are kept: the median pins the multiplier, the share pins the mixture.
    const rows = await allRows<{
      currency_code: number;
      n: string;
      median_ratio: string;
      at_peg: string;
    }>(
      `WITH one AS (
         SELECT unp FROM contracts WHERE unp IS NOT NULL GROUP BY unp HAVING count(*) = 1
       ),
       j AS (
         SELECT t.currency_code, t.value_native / c.amount_eur AS ratio
           FROM tender_contract_item t
           JOIN one USING (unp)
           JOIN contracts c ON c.unp = t.unp
          WHERE t.currency_code IS NOT NULL
            AND t.value_native > 0
            AND c.amount_eur > 0
       )
       SELECT currency_code,
              count(*)::text AS n,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY ratio)::text AS median_ratio,
              -- The share sitting within 5% of THIS code's expected multiplier.
              (count(*) FILTER (
                 WHERE abs(ratio - CASE currency_code WHEN 1 THEN 1.0 ELSE 1.95583 END)
                       / CASE currency_code WHEN 1 THEN 1.0 ELSE 1.95583 END < 0.05
               ))::text AS at_peg
         FROM j GROUP BY 1`,
    );
    // Non-vacuity: a NULLed currency_code column would otherwise pass silently.
    expect(
      await countWhere(
        "SELECT count(*)::text AS n FROM tender_contract_item WHERE currency_code IS NOT NULL",
      ),
    ).toBeGreaterThan(0);
    expect(rows.length).toBeGreaterThan(0);

    // Only the two codes with a FIXED multiplier can be anchored this way. Code 2 is USD
    // and code 8 is CHF: both float, so `value_native / amount_eur` is the exchange rate on
    // the contract's own date and no constant can be asserted. They are also tiny (13 and 1
    // row in this join), which is why the mapping for them rests on the label cross-tab
    // below rather than on the peg. Their absence here is a limit of the method, not an
    // oversight — say so, or somebody will "finish the table" with a wrong constant.
    const EXPECT: Record<number, { ratio: number; label: string }> = {
      1: { ratio: 1.0, label: "EUR" },
      3: { ratio: 1.95583, label: "BGN" },
    };
    const MIN_ROWS = 50;
    const seen: number[] = [];
    for (const r of rows) {
      const want = EXPECT[r.currency_code];
      if (!want || Number(r.n) < MIN_ROWS) continue;
      seen.push(r.currency_code);
      const got = Number(r.median_ratio);
      expect(
        Math.abs(got - want.ratio) / want.ratio,
        `currency_code ${r.currency_code} should mean ${want.label} ` +
          `(value_native/amount_eur ≈ ${want.ratio}); measured median ${got} over ${r.n} rows`,
      ).toBeLessThan(0.05);
      // Measured 2026-08-20: 88.5% for code 1, 93.6% for code 3.
      const share = Number(r.at_peg) / Number(r.n);
      expect(
        share,
        `currency_code ${r.currency_code} carries a MIXTURE: only ${(share * 100).toFixed(1)}% ` +
          `of ${r.n} rows sit at the ${want.label} multiplier, so value_native cannot be summed`,
      ).toBeGreaterThan(0.8);
    }
    // Both anchorable codes must actually have been reached — otherwise a join that
    // silently returned nothing for one of them passes this test by skipping it.
    expect(seen.sort()).toEqual([1, 3]);
  });

  // ⚠️ `contracts.currency` IS STILL ASSERTED, and deliberately so. The peg test above
  // dropped that column, and this file's docblock calls cross-source agreement the point of
  // the file — verified by the mutation this repo prescribes: with `UPDATE contracts SET
  // currency = NULL` in a rolled-back transaction, a peg-only pair of tests stays green.
  //
  // What is asserted is the DOMINANT label per code, not per-row agreement: the ~26% of
  // code-1 rows the contracts side calls BGN are the contracts side being wrong, and a
  // per-row bar would fail on somebody else's defect.
  test("the dominant contracts.currency per code still agrees with the register", async () => {
    const rows = await allRows<{
      currency_code: number;
      currency: string;
      n: string;
    }>(
      `WITH one AS (
         SELECT unp FROM contracts WHERE unp IS NOT NULL GROUP BY unp HAVING count(*) = 1
       ),
       tally AS (
         SELECT t.currency_code, c.currency, count(*) AS n
           FROM tender_contract_item t
           JOIN one USING (unp)
           JOIN contracts c ON c.unp = t.unp
          WHERE t.currency_code IS NOT NULL AND c.currency IS NOT NULL
          GROUP BY 1, 2
       )
       -- ⚠️ ORDER BY tally.n, not the output column: the SELECT casts n to text for the
       -- driver, and an unqualified n binds to that OUTPUT column, so the sort becomes
       -- LEXICOGRAPHIC — '57' sorts above '160' and the dominant label comes back wrong.
       SELECT DISTINCT ON (currency_code) currency_code, currency, tally.n::text AS n
         FROM tally ORDER BY currency_code, tally.n DESC`,
    );
    const dominant = new Map(rows.map((r) => [r.currency_code, r.currency]));
    expect(dominant.get(1)).toBe("EUR");
    expect(dominant.get(3)).toBe("BGN");
    // Code 2 = USD and code 8 = CHF have no peg to check them against, so this is the ONLY
    // evidence for what they mean. Asserted when present rather than required to exist:
    // they are 13 and 1 row, and a partial crawl may hold neither.
    if (dominant.has(2)) expect(dominant.get(2)).toBe("USD");
    if (dominant.has(8)) expect(dominant.get(8)).toBe("CHF");
  });

  // The finding the peg test uncovered, recorded so it is not re-derived as a dossier
  // defect a third time: these rows carry `currency_code = 1` (EUR) from the register while
  // `contracts.currency` says BGN, and the ratio says the register is right. It is a
  // CONTRACTS-side labelling problem, and it matters because `amount_eur` derives from that
  // label.
  //
  // ⚠️ A RATE, NOT A COUNT. The dossier capture covers 25,244 of 134,070 УНП and grows, so
  // an absolute ceiling would be breached by ordinary crawling with no new mislabelling —
  // the same defect this session fixed in the fold-residue gate. Measured 2026-08-20:
  // 57 of 217 code-1 rows, 26.3%.
  test("the contracts-side currency mislabelling has not spread", async () => {
    const [row] = await allRows<{ bad: string; total: string }>(
      `WITH one AS (
         SELECT unp FROM contracts WHERE unp IS NOT NULL GROUP BY unp HAVING count(*) = 1
       )
       SELECT count(*) FILTER (WHERE c.currency = 'BGN')::text AS bad,
              count(*)::text AS total
         FROM tender_contract_item t
         JOIN one USING (unp)
         JOIN contracts c ON c.unp = t.unp
        WHERE t.currency_code = 1 AND c.currency IS NOT NULL`,
    );
    const total = Number(row.total);
    expect(total).toBeGreaterThan(50);
    expect(
      Number(row.bad) / total,
      `${row.bad} of ${row.total} euro-coded rows are labelled BGN by the contracts corpus`,
    ).toBeLessThan(0.35);
  });

  // ---- place ---------------------------------------------------------------

  test("buyer-profile city agrees with awarder_seats where both know the buyer", async () => {
    // Measured 2026-08: 504 of 511 agree (98.6%). A drop here means one of the two
    // place sources has moved, and the by-settlement map is built on the other.
    // Non-vacuity: NULLing city must not read as "the sources agree".
    expect(
      await countWhere(
        "SELECT count(*)::text AS n FROM tender_buyer_profile WHERE city IS NOT NULL AND city <> ''",
      ),
    ).toBeGreaterThan(0);

    const [r] = await allRows<{ both: string; agree: string }>(
      // The settlement-type prefix appears BOTH abbreviated and spelled out
      // ("гр.София" / "град София" / "с. Динково" / "село Динково"). Stripping only
      // the abbreviated form counted 3 pure formatting differences as substantive
      // disagreements — 504/511 → 507/511.
      // ⚠️ THE DOT IS REQUIRED for the abbreviated forms and a SPACE for the
      // spelled-out ones. Making the dot optional turns "с" into a bare
      // first-letter strip, so "софия" becomes "офия" — measured, that alone took
      // agreement from 98.6% to 66%.
      `WITH j AS (
         SELECT regexp_replace(lower(trim(p.city)), '^(гр\\.|с\\.|град\\s|село\\s)\\s*', '') AS ours,
                regexp_replace(lower(trim(a.settlement)), '^(гр\\.|с\\.|град\\s|село\\s)\\s*', '') AS theirs
           FROM tender_buyer_profile p
           JOIN awarder_seats a ON a.eik = p.eik
          WHERE p.city IS NOT NULL AND p.city <> '' AND a.settlement IS NOT NULL
       )
       SELECT count(*)::text AS both,
              count(*) FILTER (WHERE ours = theirs)::text AS agree
         FROM j`,
    );
    const both = Number(r.both);
    if (both < 50) return;
    expect(Number(r.agree) / both).toBeGreaterThan(0.9);
  });

  test("the dossier can place buyers awarder_seats has never resolved", async () => {
    // This is §1.5's whole point: the flat ЦАИС feed carries no buyer address, so
    // those awarders never resolve to an EKATTE and are absent from the
    // by-settlement map. The buyer profile carries one.
    //
    // Asserted as "every buyer we hold that awarder_seats lacks has a city we could
    // place it from" — measured 135 of 135. If that ratio falls, the fill is no
    // longer available and the gap is not closable from this source.
    const [r] = await allRows<{ missing: string; with_city: string }>(
      `SELECT count(*)::text AS missing,
              count(*) FILTER (WHERE p.city IS NOT NULL AND p.city <> '')::text AS with_city
         FROM tender_buyer_profile p
         LEFT JOIN awarder_seats a ON a.eik = p.eik
        WHERE p.eik IS NOT NULL AND a.eik IS NULL`,
    );
    const missing = Number(r.missing);
    if (missing === 0) return; // awarder_seats already covers everything we hold
    expect(Number(r.with_city) / missing).toBeGreaterThan(0.9);
  });

  test("no buyer profile claims an EIK that is not 9 or 13 digits", async () => {
    // The EIK is the join key to awarder_seats, company_politicians and the whole
    // contractor graph. A malformed one joins to nothing and is invisible.
    const [r] = await allRows<{ n: string }>(
      `SELECT count(*)::text AS n FROM tender_buyer_profile
        WHERE eik IS NOT NULL AND eik !~ '^[0-9]{9}([0-9]{4})?$'`,
    );
    expect(Number(r.n)).toBe(0);
  });
});
