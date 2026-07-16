// Tier 3 (Postgres-native) — procurement ingestion REGRESSION net.
//
// Locks in the data-quality fixes verified in the 2026-07 parity audit
// (docs/procurement-sigma-parity-audit-2026-07-16-v2.md) so that a broken
// ingestion — a dropped coverage guard, a normalize regression, a mis-applied
// amount override, a fold that reverts, a re-run that silently changes values —
// fails LOUDLY here instead of shipping to production.
//
// Two layers:
//   1. STRUCTURAL invariants — data-version-independent rules that must always
//      hold (cais_id derivation, corpus sanity bounds, foreign vendors kept,
//      T-id recovery, no exploding near-zero rows).
//   2. ANCHOR canaries — specific verified contracts with expected values, each
//      guarding ONE fix. Bounds, not exact equality: a mismatch means "an ingest
//      change moved this — investigate", NOT "bump the number". The named УНП are
//      historical (2020–2025) so they are stable across future fortnights.
//
//   npm run test:data
//
// Requires the Postgres store (`db:pg:up` + `db:load:pg`); auto-skips when
// Postgres is unreachable, exactly like the other *.data.test.ts files.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";

const reachable = async (): Promise<boolean> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.contracts') IS NOT NULL AS ok",
    );
    return !!t?.ok;
  } catch {
    return false;
  }
};

const skip = (await reachable())
  ? false
  : "Postgres unreachable / contracts table absent";

after(async () => {
  await end();
});

const num = (v: unknown): number => (v == null ? 0 : Number(v));

/** Per-УНП contract-tag aggregate used by the anchor canaries. */
async function agg(unp: string): Promise<{
  n: number;
  eur: number;
  sign: number;
  ceiks: string[];
  awarders: string[];
}> {
  const [r] = await allRows<{
    n: string;
    eur: string | null;
    sign: string | null;
    ceiks: string | null;
    awarders: string | null;
  }>(
    `SELECT count(*) FILTER (WHERE tag = 'contract')::text                       AS n,
            (sum(amount_eur) FILTER (WHERE tag = 'contract'))::text              AS eur,
            (max(signing_amount_eur) FILTER (WHERE tag = 'contract'))::text      AS sign,
            string_agg(DISTINCT contractor_eik, ',') FILTER (WHERE tag = 'contract') AS ceiks,
            string_agg(DISTINCT awarder_eik, ',') FILTER (WHERE tag = 'contract')    AS awarders
     FROM contracts WHERE unp = $1`,
    [unp],
  );
  return {
    n: num(r?.n),
    eur: num(r?.eur),
    sign: num(r?.sign),
    ceiks: (r?.ceiks ?? "").split(",").filter(Boolean),
    awarders: (r?.awarders ?? "").split(",").filter(Boolean),
  };
}

// ============================================================================
// 1. STRUCTURAL INVARIANTS
// ============================================================================

test(
  "corpus size + value are within sane bounds (catches a half-loaded / doubled ingest)",
  { skip },
  async () => {
    const [r] = await allRows<{ n: string; eur: string }>(
      `SELECT count(*) FILTER (WHERE tag = 'contract')::text            AS n,
              (sum(amount_eur) FILTER (WHERE tag = 'contract'))::text   AS eur
       FROM contracts`,
    );
    const n = num(r.n);
    const eur = num(r.eur);
    // Deliberately wide: the corpus grows every fortnight. A breach means a
    // catastrophic ingest (a whole feed dropped, or a double-count), not growth.
    assert.ok(
      n >= 330_000 && n <= 500_000,
      `contract-tag count ${n} outside [330k, 500k] — a partial or doubled ingest?`,
    );
    assert.ok(
      eur >= 84e9 && eur <= 110e9,
      `Σ amount_eur €${(eur / 1e9).toFixed(1)}bn outside [84, 110]bn`,
    );
  },
);

test(
  "cais_id derivation holds (= unp when present, else the T-id from ocid)",
  { skip },
  async () => {
    // (a) never disagrees with a present УНП (its whole point is to mirror it)
    const [mismatch] = await allRows<{ n: string }>(
      `SELECT count(*)::text AS n FROM contracts
       WHERE unp IS NOT NULL AND unp <> '' AND cais_id IS DISTINCT FROM unp`,
    );
    assert.equal(
      num(mismatch.n),
      0,
      "cais_id must equal unp when unp is present (see 079_contracts_cais_id.sql)",
    );
    // (b) recovers the ЦАИС T-id for the two keyless feeds
    const [bad] = await allRows<{ n: string }>(
      `SELECT count(*)::text AS n FROM contracts
       WHERE (unp IS NULL OR unp = '')
         AND ( (ocid LIKE 'eop-T%'        AND cais_id <> substring(ocid FROM 5))
            OR (ocid LIKE 'ocds-e82gsb-%' AND cais_id <> 'T' || substring(ocid FROM 13)) )`,
    );
    assert.equal(
      num(bad.n),
      0,
      "cais_id must recover the T-id from eop-T* / ocds-e82gsb ocids",
    );
    // (c) the recovery actually populated a meaningful number of rows
    const [{ n }] = await allRows<{ n: string }>(
      `SELECT count(*)::text AS n FROM contracts WHERE cais_id ~ '^T[0-9]+$'`,
    );
    assert.ok(
      num(n) > 5_000,
      `only ${n} T-id cais_ids — the ocid→cais_id recovery may have regressed`,
    );
  },
);

test(
  "foreign-supplier contracts are kept, not dropped by the BG-EIK guard",
  { skip },
  async () => {
    // Foreign vendors keyed by a non-numeric registration id (Stadler `U…`,
    // `HRB…`, etc.). normalize_eop used to drop every non-BG-EIK supplier.
    const [{ n }] = await allRows<{ n: string }>(
      `SELECT count(*)::text AS n FROM contracts
       WHERE tag = 'contract' AND contractor_eik ~ '[A-Za-z]'`,
    );
    assert.ok(
      num(n) > 50,
      `only ${n} foreign-keyed contractors — the foreign-supplier recovery may have regressed`,
    );
  },
);

// ============================================================================
// 2. ANCHOR CANARIES — one verified contract per fix. Bounds, not exact.
// ============================================================================

test(
  "coverage recovery: АПИ consortium road present (00044-2020-0085)",
  { skip },
  async () => {
    const a = await agg("00044-2020-0085"); // Русе–Бяла, split across the consortium
    assert.ok(
      a.n >= 6,
      `00044-2020-0085 has ${a.n} contractor rows (<6) — storage.eop coverage or the split regressed`,
    );
    assert.ok(
      a.eur > 500e6,
      `00044-2020-0085 Σ €${(a.eur / 1e6).toFixed(0)}M (<500M) — missing consortium members`,
    );
  },
);

test(
  "foreign supplier kept: Stadler Polska ≈ €153.65M (00042-2024-0003)",
  { skip },
  async () => {
    const a = await agg("00042-2024-0003");
    assert.equal(
      a.n,
      1,
      `00042-2024-0003 has ${a.n} contract rows (expected 1)`,
    );
    assert.ok(
      a.ceiks.includes("8212477136"),
      `Stadler contractor_eik lost — got [${a.ceiks.join(",")}]`,
    );
    assert.ok(
      a.eur > 150e6 && a.eur < 156e6,
      `Stadler €${(a.eur / 1e6).toFixed(1)}M outside [150, 156]M`,
    );
  },
);

test(
  "duplicate-supplier under-count fix: 00308-2020-0013 carries its full value",
  { skip },
  async () => {
    const a = await agg("00308-2020-0013"); // 183 000 BGN ≈ €93 566; the old ÷4 bug gave ~€23 391
    assert.ok(
      a.eur > 90_000,
      `00308-2020-0013 €${a.eur.toFixed(0)} (<90k) — the duplicate-supplier under-count returned`,
    );
  },
);

test(
  "joint-procurement recovery: 00143-2024-0081 attributed to its primary buyer",
  { skip },
  async () => {
    const a = await agg("00143-2024-0081");
    assert.ok(
      a.n >= 1,
      "00143-2024-0081 dropped — joint-procurement recovery regressed",
    );
    assert.ok(
      a.awarders.includes("115552190"),
      `joint contract not under primary buyer — got [${a.awarders.join(",")}]`,
    );
    assert.ok(
      a.eur > 25e6,
      `00143-2024-0081 €${(a.eur / 1e6).toFixed(1)}M (<25M)`,
    );
  },
);

test(
  "placeholder→estimate fallback: 00120-2021-0004 is not €0",
  { skip },
  async () => {
    const a = await agg("00120-2021-0004"); // source contractValue was a "0,01" stub
    assert.ok(
      a.eur > 10e6,
      `00120-2021-0004 €${(a.eur / 1e6).toFixed(1)}M (<10M) — placeholder reverted to ~€0`,
    );
  },
);

test(
  "amount overrides applied: stotinki ×100 errors corrected, not booked at face",
  { skip },
  async () => {
    const a = await agg("00105-2025-0026"); // raw 102 258 376 → corrected ~€1.02M
    assert.ok(
      a.eur > 0 && a.eur < 2e6,
      `00105-2025-0026 €${(a.eur / 1e6).toFixed(2)}M — the ÷100 override was lost (raw ≈ €102M)`,
    );
    const b = await agg("00621-2020-0008"); // Община Две могили: raw ≈ €14.2M → ~€142k
    assert.ok(
      b.eur > 0 && b.eur < 300_000,
      `00621-2020-0008 €${b.eur.toFixed(0)} — the ÷100 override was lost (raw ≈ €14.2M)`,
    );
  },
);

test(
  "current-value fold intact: 00044-2024-0047 current > signing, both present",
  { skip },
  async () => {
    const a = await agg("00044-2024-0047"); // +50% annex: signing €69.83M → current €104.75M
    assert.ok(
      a.eur > 100e6,
      `00044-2024-0047 current €${(a.eur / 1e6).toFixed(1)}M (<100M) — the fold reverted to signing?`,
    );
    assert.ok(
      a.sign > 60e6 && a.sign < 75e6,
      `00044-2024-0047 signing €${(a.sign / 1e6).toFixed(1)}M outside [60, 75]M`,
    );
    assert.ok(
      a.eur > a.sign,
      "current value must exceed signing for this +50% annex",
    );
  },
);

test(
  "plausibility guard rejects a garbage annex: 00747-2024-0003 stays ~signing",
  { skip },
  async () => {
    const a = await agg("00747-2024-0003"); // source annex jumps ×48 to €105.2M (a data error)
    assert.ok(
      a.eur < 5e6,
      `00747-2024-0003 €${(a.eur / 1e6).toFixed(1)}M (>5M) — the ×48 garbage annex was folded (MAX_MULTIPLE guard?)`,
    );
  },
);

// ============================================================================
// 3. FEATURE CANARY — consortium participation exposed to the company page
// ============================================================================

test(
  "company_procurement exposes consortium participation (МЕДЕКС ООД)",
  { skip },
  async () => {
    const [r] = await allRows<{
      ceur: string | null;
      ccount: string | null;
      total: string | null;
    }>(
      `SELECT (company_procurement('131268894') ->> 'consortiumEur')   AS ceur,
              (company_procurement('131268894') ->> 'consortiumCount') AS ccount,
              (company_procurement('131268894') ->> 'totalEur')        AS total`,
    );
    assert.ok(
      num(r.ceur) > 0,
      "company_procurement.consortiumEur missing / zero",
    );
    assert.ok(
      num(r.ccount) > 0,
      "company_procurement.consortiumCount missing / zero",
    );
    assert.ok(
      num(r.ceur) <= num(r.total),
      "consortium value cannot exceed the company total",
    );
  },
);
