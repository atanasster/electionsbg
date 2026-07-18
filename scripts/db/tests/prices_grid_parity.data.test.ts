// Parity net: price_grid_days must reproduce the shipped daily grid that
// scripts/prices/parse.ts has been writing to data/prices/_cache/daily/.
//
// This is the load-bearing check of the whole migration. If it passes, the
// Jevons index built on top of price_grid_days is the same index the site has
// been serving.
//
// NOTE: this deliberately does NOT reconstruct the grid from `price_facts`. It
// cannot be done: a run closes only on a price change, so delisted SKUs leave
// open runs forever — 1,899,083 open runs vs 1,400,705 rows actually observed
// after 8 days, a 36% phantom over-count. The grid is written from each day's
// own observations. See design §3.2.
//
// Requires DB_VERIFY=1, a loaded local Postgres, and the _cache fixture.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import { allRows, end } from "../lib/pg";
import type { DailyGrid } from "../../prices/types";

// lib/pg holds a module-level singleton Pool with keepalive; without this the
// db:verify runner hangs at completion (matches the sibling DB tests).
afterAll(async () => {
  await end();
});

const RUN = process.env.DB_VERIFY === "1";
const DAY = process.env.PRICES_PARITY_DAY ?? "2026-07-08";
const FIXTURE = `data/prices/_cache/daily/${DAY}.json`;

// avg and median are decimal aggregates in Postgres and IEEE-754 means in JS.
// Some chains publish EUR converted from BGN (÷1.95583), so prices carry many
// decimals and the two disagree in the ~6th place. Compare within tolerance;
// min/max/stores/chains are exact and are what the index actually consumes.
const TOL = 1e-5;

interface GridRow {
  ekatte: string;
  pid: number;
  min_eur: string;
  avg_eur: string;
  max_eur: string;
  median_eur: string;
  promo_min_eur: string | null;
  stores: number;
  chains: number;
  cheapest_eik: string | null;
}

test.skipIf(!RUN)(
  "price_grid_days reproduces the shipped daily grid",
  async () => {
    if (!fs.existsSync(FIXTURE)) {
      assert.fail(
        `missing fixture ${FIXTURE} — run the ingest for ${DAY} first`,
      );
    }
    const grid: DailyGrid = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
    const rows = await allRows<GridRow>(
      "SELECT * FROM price_grid_days WHERE day = $1",
      [DAY],
    );

    const jsonCells = Object.values(grid.cells).reduce(
      (s, m) => s + Object.keys(m).length,
      0,
    );
    // Positive floor: without it, a zero-row day would pass 0 === 0 and the
    // per-cell loop would never iterate (FINDING-015).
    assert.ok(jsonCells > 0, "fixture has no cells — parity check is vacuous");
    assert.equal(rows.length, jsonCells, "cell count");

    const chainMins = await allRows<{
      ekatte: string;
      eik: string;
      pid: number;
      min_eur: string;
    }>(
      "SELECT ekatte, eik, pid, min_eur FROM price_chain_grid_days WHERE day = $1",
      [DAY],
    );
    const chainMin = new Map(
      chainMins.map((r) => [
        `${r.ekatte}|${r.eik}|${r.pid}`,
        Number(r.min_eur),
      ]),
    );

    for (const r of rows) {
      const c = grid.cells[r.ekatte]?.[String(r.pid)];
      assert.ok(c, `cell ${r.ekatte}/${r.pid} missing from fixture`);

      // exact — these drive the index and the shipped shards
      assert.equal(Number(r.min_eur), c.min, `min ${r.ekatte}/${r.pid}`);
      assert.equal(Number(r.max_eur), c.max, `max ${r.ekatte}/${r.pid}`);
      assert.equal(Number(r.stores), c.stores, `stores ${r.ekatte}/${r.pid}`);
      assert.equal(Number(r.chains), c.chains, `chains ${r.ekatte}/${r.pid}`);
      assert.equal(
        r.promo_min_eur == null ? null : Number(r.promo_min_eur),
        c.promoMin,
        `promoMin ${r.ekatte}/${r.pid}`,
      );

      // within decimal-vs-float tolerance
      assert.ok(
        Math.abs(Number(r.avg_eur) - c.avg) < TOL,
        `avg ${r.ekatte}/${r.pid}`,
      );
      assert.ok(
        Math.abs(Number(r.median_eur) - c.median) < TOL,
        `median ${r.ekatte}/${r.pid}`,
      );

      // cheapest_eik: the JSON's tie-break is row order (an artifact of the ZIP);
      // ours is (price, eik COLLATE "C") — deterministic, as payload determinism
      // requires. So assert VALIDITY, not equality: our chain must actually attain
      // the settlement minimum.
      const m = chainMin.get(`${r.ekatte}|${r.cheapest_eik}|${r.pid}`);
      assert.ok(
        m != null && Math.abs(m - Number(r.min_eur)) < 1e-9,
        `cheapest_eik ${r.cheapest_eik} does not attain min at ${r.ekatte}/${r.pid}`,
      );
    }
  },
);

test.skipIf(!RUN)("price_chain_grid_days cell count matches", async () => {
  if (!fs.existsSync(FIXTURE)) assert.fail(`missing fixture ${FIXTURE}`);
  const grid: DailyGrid = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
  const jsonCC = Object.values(grid.chainCells).reduce(
    (s, byEik) =>
      s + Object.values(byEik).reduce((t, m) => t + Object.keys(m).length, 0),
    0,
  );
  assert.ok(jsonCC > 0, "fixture has no chain cells — vacuous");
  const [{ n }] = await allRows<{ n: string }>(
    "SELECT count(*) AS n FROM price_chain_grid_days WHERE day = $1",
    [DAY],
  );
  assert.equal(Number(n), jsonCC);
});

test.skipIf(!RUN)(
  "price_facts must NOT be used to reconstruct a day",
  async () => {
    // Once data is loaded, open runs must STRICTLY exceed today's observations
    // (the 36% phantom over-count). `>=` alone is satisfied by 0 >= 0 on an
    // empty DB, which would pass vacuously (FINDING-015).
    const [{ open }] = await allRows<{ open: string }>(
      "SELECT count(*) AS open FROM price_facts WHERE valid_to IS NULL",
    );
    const [{ cur }] = await allRows<{ cur: string }>(
      "SELECT count(*) AS cur FROM price_current",
    );
    assert.ok(Number(cur) > 0, "price_current is empty — run the ingest first");
    assert.ok(
      Number(open) > Number(cur),
      "open runs must strictly exceed today's observations (phantom over-count)",
    );
  },
);
