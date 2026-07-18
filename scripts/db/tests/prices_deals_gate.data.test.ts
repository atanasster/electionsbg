// The promo "deals" quality gate (methodology), asserted against the live
// price_payloads + price_current. DB-backed: auto-skips without DB_VERIFY=1 and
// a loaded Postgres, exactly like the other *.data.test.ts gates.
//
// The gate itself lives in ONE place — promoQualityCte in
// scripts/prices/build_payloads.ts — and that SQL is the source of truth; we do
// NOT reimplement it in JS (a twin would drift). Instead these tests assert the
// gate's PROMISES two ways:
//   1. arithmetic invariants readable straight off the emitted payload
//      (discount band, promo < baseline regular, absolute floor, monotone order);
//   2. the corroboration claim (≥3 promo store listings across ≥2 distinct
//      chains) re-derived INDEPENDENTLY from price_current, so a regression that
//      loosened the CTE would surface here rather than pass tautologically.
//
// See the 2026-07 accuracy audit (docs/plans/consumption-pg-v1-implementation.md)
// and the constants MIN_PROMO_STORES / MIN_PROMO_CHAINS / MIN_DISC / MAX_DISC /
// MIN_PROMO_EUR in build_payloads.ts.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";

afterAll(async () => {
  await end();
});

const RUN = process.env.DB_VERIFY === "1";

// Mirror of the gate constants (build_payloads.ts). Kept here as the EXPECTED
// contract: if the gate is retuned, this test must be updated deliberately.
const MIN_DISC_PCT = 15; // MIN_DISC 0.15 → round(0.15*100)
const MAX_DISC_PCT = 70; // MAX_DISC 0.70 → round(0.70*100)
const MIN_PROMO_EUR = 0.1;
const MIN_PROMO_STORES = 3;
const MIN_PROMO_CHAINS = 2;
const NATIONAL_CAP = 48;

interface DealRow {
  slug: string;
  title: string;
  promo: number;
  reg: number;
  discPct: number;
  eik: string;
  chain: string;
}

const readDeals = async (
  kind: "deals" | "deals-muni",
): Promise<{ key: string; deals: DealRow[] }[]> => {
  const rows = await allRows<{
    key: string;
    payload: { latestDate: string; deals: DealRow[] };
  }>(`SELECT key, payload FROM price_payloads WHERE kind = '${kind}'`);
  return rows.map((r) => ({ key: r.key, deals: r.payload.deals }));
};

test.skipIf(!RUN)(
  "national deals obey the gate invariants (band, promo<reg, floor, cap, order)",
  async () => {
    const blobs = await readDeals("deals");
    assert.equal(blobs.length, 1, "expected exactly one national deals blob");
    const deals = blobs[0].deals;
    // Vacuous-safe: a day with no qualifying promo yields an empty board.
    assert.ok(deals.length <= NATIONAL_CAP, "national board over the 48 cap");

    for (const d of deals) {
      assert.ok(
        d.discPct >= MIN_DISC_PCT && d.discPct <= MAX_DISC_PCT,
        `${d.slug}: discPct ${d.discPct} outside [${MIN_DISC_PCT}, ${MAX_DISC_PCT}]`,
      );
      // The discount is measured against the chain-deduped baseline regular,
      // shown as `reg`; the promo must sit strictly below it.
      assert.ok(d.promo < d.reg, `${d.slug}: promo ${d.promo} !< reg ${d.reg}`);
      assert.ok(
        d.promo >= MIN_PROMO_EUR,
        `${d.slug}: promo ${d.promo} below the ${MIN_PROMO_EUR} floor`,
      );
    }

    // Ordered by the RAW discount desc, so the rounded discPct must be
    // non-increasing. (Asserting a full slug order here would be wrong: two raw
    // discounts can round to the same percent — the rounded-sort-key trap that
    // makes an exact-order assertion flaky. Monotonicity is the correct, stable
    // invariant.)
    for (let i = 1; i < deals.length; i++)
      assert.ok(
        deals[i].discPct <= deals[i - 1].discPct,
        `deals not discount-ordered at index ${i}`,
      );
  },
);

test.skipIf(!RUN)(
  "every national deal is corroborated: ≥3 promo stores across ≥2 chains",
  async () => {
    const deals = (await readDeals("deals"))[0]?.deals ?? [];
    if (deals.length === 0) return; // vacuous — no promos today

    const slugs = deals.map((d) => d.slug);
    // Re-derive corroboration straight from price_current — independent of the
    // gate's own CTE. n_promo_stores = promo listings for the product;
    // n_promo_chains = distinct chain EIKs running a promo on it.
    const stats = await allRows<{
      slug: string;
      n_promo_stores: string;
      n_promo_chains: string;
    }>(
      `SELECT pp.slug,
              count(*) FILTER (WHERE pc.promo_eur IS NOT NULL) AS n_promo_stores,
              count(DISTINCT st.eik) FILTER (WHERE pc.promo_eur IS NOT NULL)
                AS n_promo_chains
         FROM price_products pp
         JOIN price_skus ps ON ps.product_id = pp.product_id
         JOIN price_current pc ON pc.sku_id = ps.sku_id
         JOIN price_stores st ON st.store_id = pc.store_id
        WHERE pp.slug = ANY($1::text[])
        GROUP BY pp.slug`,
      [slugs],
    );
    const byslug = new Map(stats.map((s) => [s.slug, s]));

    for (const slug of slugs) {
      const s = byslug.get(slug);
      assert.ok(s, `${slug}: no price_current rows (a deal with no source?)`);
      assert.ok(
        Number(s.n_promo_stores) >= MIN_PROMO_STORES,
        `${slug}: only ${s.n_promo_stores} promo stores (< ${MIN_PROMO_STORES})`,
      );
      assert.ok(
        Number(s.n_promo_chains) >= MIN_PROMO_CHAINS,
        `${slug}: only ${s.n_promo_chains} promo chains (< ${MIN_PROMO_CHAINS})`,
      );
    }
  },
);

test.skipIf(!RUN)(
  "per-município deals obey the same band + promo<reg invariants",
  async () => {
    const blobs = await readDeals("deals-muni");
    // Vacuous-safe: no promos in the latest day → no muni blobs.
    for (const { key, deals } of blobs) {
      assert.ok(key.length > 0, "deals-muni key must be an obshtina code");
      assert.ok(deals.length <= 24, `deals-muni/${key} over the 24 cap`);
      for (const d of deals) {
        assert.ok(
          d.discPct >= MIN_DISC_PCT && d.discPct <= MAX_DISC_PCT,
          `deals-muni/${key} ${d.slug}: discPct ${d.discPct} out of band`,
        );
        assert.ok(
          d.promo < d.reg,
          `deals-muni/${key} ${d.slug}: promo ${d.promo} !< reg ${d.reg}`,
        );
        assert.ok(
          d.promo >= MIN_PROMO_EUR,
          `deals-muni/${key} ${d.slug}: promo below floor`,
        );
      }
      for (let i = 1; i < deals.length; i++)
        assert.ok(
          deals[i].discPct <= deals[i - 1].discPct,
          `deals-muni/${key} not discount-ordered at index ${i}`,
        );
    }
  },
);
