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
    // ⚠️ `tender_contract_item.value_native` is in the CONTRACT'S OWN currency and
    // the register identifies it only by an integer. Without this mapping the
    // column cannot be summed or compared across rows at all — 3 is BGN and 1 is
    // EUR, so mixing them silently inflates a total by ~1.96x.
    //
    // Joined on УНП with exactly one contract, because a multi-contract УНП can
    // legitimately span currencies and would confound the inference.
    const rows = await allRows<{
      currency_code: number;
      currency: string;
      n: string;
    }>(
      `WITH one AS (
         SELECT unp FROM contracts WHERE unp IS NOT NULL GROUP BY unp HAVING count(*) = 1
       )
       SELECT t.currency_code, c.currency, count(*)::text AS n
         FROM tender_contract_item t
         JOIN one USING (unp)
         JOIN contracts c ON c.unp = t.unp
        WHERE t.currency_code IS NOT NULL AND c.currency IS NOT NULL
        GROUP BY 1, 2`,
    );
    // Non-vacuity: a NULLed currency_code column would otherwise pass silently.
    expect(
      await countWhere(
        "SELECT count(*)::text AS n FROM tender_contract_item WHERE currency_code IS NOT NULL",
      ),
    ).toBeGreaterThan(0);
    if (!rows.length) return;
    // Dominant currency per code.
    const best = new Map<number, { cur: string; n: number; total: number }>();
    for (const r of rows) {
      const n = Number(r.n);
      const cur = best.get(r.currency_code) ?? {
        cur: r.currency,
        n: 0,
        total: 0,
      };
      cur.total += n;
      if (n > cur.n) {
        cur.cur = r.currency;
        cur.n = n;
      }
      best.set(r.currency_code, cur);
    }
    // Measured 2026-08: 3→BGN (643 vs 1), 1→EUR (92 vs 7), 2→USD (1).
    // The ~7% noise on code 1 is consistent with the 2026-01-01 euro adoption,
    // where the two corpora disagree about a contract straddling the switch.
    const three = best.get(3);
    if (three && three.total >= 50) {
      expect(three.cur).toBe("BGN");
      expect(three.n / three.total).toBeGreaterThan(0.9);
    }
    const one = best.get(1);
    if (one && one.total >= 50) {
      expect(one.cur).toBe("EUR");
      expect(one.n / one.total).toBeGreaterThan(0.8);
    }
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
