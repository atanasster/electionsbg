// Gates for the TED cross-check (migration 172, plan P10).
//
// TED exists here to say what is MISSING from the national corpus, so every
// failure mode of this table manufactures exactly that finding: a short crawl, a
// dropped year, or a buyer key that stops joining all read as „this procurement
// was never published nationally".

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";

const haveDb = await dbReachable();
const [{ n } = { n: "0" }] = haveDb
  ? await allRows<{ n: string }>(
      "SELECT count(*)::text n FROM ted_notice",
    ).catch(() => [{ n: "0" }])
  : [{ n: "0" }];
const skip = !haveDb
  ? "Postgres unreachable"
  : n === "0"
    ? "ted_notice is empty — run npm run db:load:ted:pg"
    : false;

afterAll(async () => {
  await end();
});

test.skipIf(skip)("the corpus is whole", async () => {
  const [r] = await allRows<Record<string, string>>(
    `SELECT count(*)::text n, count(DISTINCT buyer_eik)::text buyers,
            min(publication_date)::text first, max(publication_date)::text last
       FROM ted_notice`,
  );
  assert.ok(
    Number(r.n) > 100000,
    `only ${r.n} TED notices — Bulgaria publishes ~17-32k a year and the crawl ` +
      `covers 2016→now. A short corpus reads as „these procurements were never ` +
      `published in TED", the exact false finding this table exists to prevent.`,
  );
  assert.ok(Number(r.buyers) > 1000, `only ${r.buyers} distinct buyers`);
});

test.skipIf(skip)("the buyer key joins our corpus", async () => {
  // `buyer-identifier` is the ЕИК and is what makes TED comparable at all. If
  // this collapses, TED has changed the field's meaning and every reconciliation
  // built on it is silently comparing nothing.
  const [r] = await allRows<{ pct: string; joined: string }>(
    `SELECT round(100.0 * count(*) FILTER (WHERE buyer_eik IS NOT NULL) / count(*), 1)::text pct,
            (SELECT count(DISTINCT t.buyer_eik)::text FROM ted_notice t
              WHERE EXISTS (SELECT 1 FROM contracts c
                             WHERE c.tag='contract' AND c.awarder_eik = t.buyer_eik)) joined
       FROM ted_notice`,
  );
  assert.ok(
    Number(r.pct) > 95,
    `only ${r.pct}% of TED notices carry a buyer ЕИК (was 100%). The field's ` +
      `meaning has changed — reconciliation by name is NOT an acceptable fallback.`,
  );
  assert.ok(
    Number(r.joined) > 500,
    `only ${r.joined} TED buyers join contracts.awarder_eik — the key has drifted`,
  );
});

test.skipIf(skip)("no year is recorded as zero", async () => {
  // TED's v3 index returns nothing for 2015 and ramps through 2016. Those years
  // must be ABSENT, never stored as 0 — a zero would plot as „no above-threshold
  // procurement that year".
  const zeros = await allRows<{ year: string }>(
    "SELECT year::text FROM ted_coverage WHERE notices = 0",
  );
  assert.deepEqual(
    zeros.map((z) => z.year),
    [],
    "a zero-notice year reached ted_coverage — the ingest is meant to drop it",
  );
});

test.skipIf(skip)("the coverage ramp is legible", async () => {
  // The point of ted_coverage: a consumer must be able to SEE that the early
  // years are the API's index deepening rather than procurement growing.
  const rows = await allRows<{ year: number; notices: number }>(
    "SELECT year, notices FROM ted_coverage ORDER BY year",
  );
  assert.ok(rows.length >= 5, `only ${rows.length} years of coverage recorded`);
  const first = rows[0];
  const mid = rows[Math.floor(rows.length / 2)];
  assert.ok(
    first.notices < mid.notices,
    `the first covered year (${first.year}: ${first.notices}) is not smaller ` +
      `than the middle one (${mid.year}: ${mid.notices}) — if TED has backfilled ` +
      `its index, the ramp caveat in 172's header is now wrong and should go.`,
  );
});

test.skipIf(skip)(
  "a 13-digit branch ЕИК folds to its parent before reconciling",
  async () => {
    // ⚠️ THE DEFECT THIS PINS. TED files ЕСО's regional districts under branch
    // numbers (1752013040134 = parent 175201304 + branch 0134); our corpus
    // awards them all under the parent. Without the fold the 2024
    // reconciliation reported 318 buyers „missing from our corpus", of which
    // **252 were branches whose parent awards 920 contracts that year** — 252
    // false claims that a named public buyer's procurement is absent from the
    // national register. With it, 66.
    const [f] = await allRows<{ p: string }>(
      "SELECT ted_eik_parent('1752013040134') AS p",
    );
    assert.equal(f.p, "175201304", "the branch suffix is not being dropped");
    const [keep] = await allRows<{ p: string }>(
      "SELECT ted_eik_parent('175201304') AS p",
    );
    assert.equal(
      keep.p,
      "175201304",
      "a 9-digit ЕИК must pass through unchanged",
    );

    const missing = await allRows<{ buyer_eik: string }>(
      `SELECT buyer_eik FROM ted_buyer_reconciliation($1,$2) WHERE our_contracts = 0`,
      ["2024-01-01", "2024-12-31"],
    );
    const falseGaps = [];
    for (const m of missing) {
      const [p] = await allRows<{ n: string }>(
        `SELECT count(*)::text n FROM contracts
          WHERE tag='contract' AND awarder_eik = left($1, 9)`,
        [m.buyer_eik],
      );
      if (m.buyer_eik.length === 13 && Number(p.n) > 0)
        falseGaps.push(m.buyer_eik);
    }
    assert.deepEqual(
      falseGaps,
      [],
      `${falseGaps.length} „missing" buyers are 13-digit branches whose parent ` +
        `does award in our corpus — the fold is not being applied.`,
    );
  },
);

test.skipIf(skip)("the reconciliation refuses an unscoped window", async () => {
  // ted_buyer_reconciliation takes an explicit range on purpose: an all-time
  // comparison mixes years TED barely indexed with years it fully did, so the
  // „missing from our corpus" figure would be dominated by the API's history.
  const rows = await allRows<{ buyer_eik: string; ted_notices: string }>(
    "SELECT buyer_eik, ted_notices::text FROM ted_buyer_reconciliation($1,$2) LIMIT 5",
    ["2024-01-01", "2024-12-31"],
  );
  assert.ok(rows.length > 0, "the 2024 reconciliation returned nothing");
  assert.ok(
    Number(rows[0].ted_notices) > 0,
    "the top buyer has no TED notices in its own window",
  );
});
