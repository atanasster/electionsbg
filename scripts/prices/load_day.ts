// Load one day's КЗП ZIP into Postgres as an SCD-2 delta.
//
// ONE DAY = ~1.4M store×SKU observations, of which only ~1.5% are real price
// changes. So the history table grows by 25-40k rows, not 1.4M.
//
// THE INVARIANT THAT SHAPES THIS FILE (design §3.2):
//   `price_facts` is a step function whose runs close only when a price
//   CHANGES. A delisted SKU's run therefore stays open forever. Measured after
//   only 8 days: 1,899,083 open runs vs 1,400,705 rows actually observed — a
//   36% phantom over-count. So absence CANNOT be inferred from the fact table.
//   It is only knowable at the moment of observation, which is here. That is
//   why this loader also writes:
//     price_current          — today's truth (TRUNCATE + reload)
//     price_grid_days        — the settlement×product aggregate for this day
//     price_chain_grid_days  — each chain's minimum for this day
//     price_chain_days       — which chains reported at all
//   Never reconstruct any of those from price_facts.
//
// A reporting gap means a run's valid_to lands on the day before the chain NEXT
// reported, overstating the interval. That is correct by construction, not a
// bug: price_chain_days records the silence and every read masks accordingly.

import unzipper from "unzipper";
import type { PoolClient } from "pg";
import { withClient, allRows } from "../db/lib/pg";
import { copyRows } from "../db/lib/copy";
import { recordIngestBatch } from "../db/lib/ingest_changelog";
import { parseChainCsv, ChainParseError } from "./lib/normalize";
import { resolvePlace } from "./lib/locations";
import type { PriceRow } from "./types";

export interface DayStats {
  day: string;
  observations: number;
  chains: number;
  stores: number;
  settlements: number;
  factsInserted: number;
  factsClosed: number;
  unresolved: number;
  legacyCodes: number;
  parseErrors: number;
}

/** A day is rejected if its rows OR chains fall this far below the previous
 *  loaded day — a guard against a parse regression quietly wiping price_current
 *  (TRUNCATE+reload) with a fraction of the day. Overridable via --no-floor. */
const SANITY_DROP = 0.2;

interface StageRow extends PriceRow {
  settlement: string;
  obshtina: string;
  oblast: string;
}

/** Parse the ZIP into stage-ready rows. resolvePlace() runs HERE, not later. */
const readZip = async (
  zipPath: string,
): Promise<{
  rows: StageRow[];
  unresolved: number;
  legacyCodes: number;
  parseErrors: number;
}> => {
  const dir = await unzipper.Open.file(zipPath);
  const rows: StageRow[] = [];
  let unresolved = 0;
  let legacyCodes = 0;
  let parseErrors = 0;

  for (const f of dir.files.filter((x) => /\.csv$/i.test(x.path))) {
    const buf = await f.buffer();
    let parsed: PriceRow[];
    try {
      parsed = parseChainCsv(buf.toString("utf8"), f.path);
    } catch (e) {
      // One chain's file failed to parse — log and count, don't drop silently.
      parseErrors++;
      console.error(
        `[prices] ${e instanceof ChainParseError ? e.message : `parse failed for ${f.path}: ${e}`}`,
      );
      continue;
    }
    for (const r of parsed) {
      if (r.productId === 0) {
        legacyCodes++;
        continue;
      }
      // Normalizes the EKATTE, synthesizes the Sofia city node (68134 →
      // SOF46/S23), and drops codes outside the canonical settlement tree.
      const place = resolvePlace(r.ekatte);
      if (!place) {
        unresolved++;
        continue;
      }
      rows.push({
        ...r,
        ekatte: place.ekatte,
        settlement: place.name,
        obshtina: place.obshtina,
        oblast: place.oblast,
      });
    }
  }
  return { rows, unresolved, legacyCodes, parseErrors };
};

/**
 * The SCD-2 price_facts transitions for one day, reading the day's one-row-per-
 * (store, sku) observations from `obsTable` (columns store_id, sku_id, price_eur,
 * promo_eur). Returns how many runs were opened/closed. This IS the code
 * load_day runs; the SCD test drives it directly with a synthetic sequence.
 *
 * (0) Undo any prior load of THIS day so a re-publish/correction or --force
 *     reload is correct rather than corrupting the step function. Re-loading a
 *     day whose price was CORRECTED would otherwise: step 1 closes the open run
 *     at day-1 (inverted interval, valid_from=day > valid_to=day-1), then step
 *     2's `ON CONFLICT (…, valid_from=day) DO NOTHING` silently drops the
 *     correction. So first: (a) delete runs a prior load opened at valid_from =
 *     day; (b) reopen the runs it closed at day-1 to make way for them (only the
 *     latest run per store×sku — the one now left with no successor). On a FRESH
 *     forward load this is a no-op: no run has valid_from = day yet, and
 *     yesterday's runs close at day-2, never day-1.
 * (1) Close runs whose price actually moved. MUST precede (2).
 * (2) Open a run wherever none is now in force (changed or never-seen).
 */
export const applyPriceFactsDelta = async (
  c: PoolClient,
  day: string,
  obsTable: string,
): Promise<{ inserted: number; closed: number }> => {
  await c.query(`DELETE FROM price_facts WHERE valid_from = $1::date`, [day]);
  await c.query(
    `UPDATE price_facts f SET valid_to = NULL
      WHERE f.valid_to = $1::date - 1
        AND NOT EXISTS (
          SELECT 1 FROM price_facts g
           WHERE g.store_id = f.store_id AND g.sku_id = f.sku_id
             AND g.valid_from > f.valid_from)`,
    [day],
  );
  const closed = await c.query(
    `UPDATE price_facts f SET valid_to = $1::date - 1
       FROM ${obsTable} o
      WHERE f.store_id = o.store_id AND f.sku_id = o.sku_id AND f.valid_to IS NULL
        AND (f.price_eur, f.promo_eur) IS DISTINCT FROM (o.price_eur, o.promo_eur)`,
    [day],
  );
  const inserted = await c.query(
    `INSERT INTO price_facts (store_id, sku_id, valid_from, price_eur, promo_eur)
     SELECT o.store_id, o.sku_id, $1::date, o.price_eur, o.promo_eur
       FROM ${obsTable} o
       LEFT JOIN price_facts f
         ON f.store_id = o.store_id AND f.sku_id = o.sku_id AND f.valid_to IS NULL
      WHERE f.store_id IS NULL
     ON CONFLICT (store_id, sku_id, valid_from) DO NOTHING`,
    [day],
  );
  return { inserted: inserted.rowCount ?? 0, closed: closed.rowCount ?? 0 };
};

const STAGE_COLS = [
  "eik",
  "ekatte",
  "settlement",
  "obshtina",
  "oblast",
  "chain_name",
  "store_label",
  "store_label_norm",
  "chain_code",
  "raw_name",
  "name_norm",
  "pid",
  "price_eur",
  "promo_eur",
];

export const loadDay = async (
  zipPath: string,
  day: string,
  opts: { skipFloor?: boolean } = {},
): Promise<DayStats> => {
  const { rows, unresolved, legacyCodes, parseErrors } = await readZip(zipPath);
  if (rows.length === 0)
    throw new Error(`${day}: ZIP produced zero usable rows`);

  const chainsToday = new Set(rows.map((r) => r.eik)).size;

  // Out-of-order loading corrupts the step function irrecoverably, and
  // price_current always reflects the LAST day loaded. Backfill replays
  // oldest-first; guard the daily path.
  const [{ maxday }] = await allRows<{ maxday: string | null }>(
    "SELECT max(valid_from)::text AS maxday FROM price_facts",
  );
  if (maxday && day < maxday) {
    throw new Error(
      `${day}: refusing to load out of order (price_facts already holds ${maxday}). ` +
        `Replay oldest-first, or truncate and rebuild.`,
    );
  }

  // Sanity floor (FINDING-001): price_current is TRUNCATE+reload, so a day that
  // parsed far fewer rows/chains than the last loaded day would silently replace
  // "today's truth" with a fraction. Refuse it. `--force`/backfill can override
  // via skipFloor. Compare against the previous loaded day (price_chain_days).
  if (!opts.skipFloor) {
    const prev = await allRows<{ rows: string; chains: string }>(
      `SELECT sum(rows)::bigint AS rows, count(*)::int AS chains
         FROM price_chain_days
        WHERE day = (SELECT max(day) FROM price_chain_days WHERE day < $1::date)`,
      [day],
    );
    const prevRows = Number(prev[0]?.rows ?? 0);
    const prevChains = Number(prev[0]?.chains ?? 0);
    if (prevRows > 0 && rows.length < prevRows * (1 - SANITY_DROP)) {
      throw new Error(
        `${day}: only ${rows.length.toLocaleString()} rows vs ${prevRows.toLocaleString()} the previous day ` +
          `(>${SANITY_DROP * 100}% drop, ${parseErrors} parse errors). Refusing to overwrite price_current. ` +
          `Investigate the feed, or re-run with --force if the drop is real.`,
      );
    }
    if (prevChains > 0 && chainsToday < prevChains * (1 - SANITY_DROP)) {
      throw new Error(
        `${day}: only ${chainsToday} chains vs ${prevChains} the previous day ` +
          `(>${SANITY_DROP * 100}% drop, ${parseErrors} parse errors). Refusing to overwrite price_current.`,
      );
    }
  }

  return withClient(async (c: PoolClient) => {
    await c.query("BEGIN");
    try {
      await c.query("TRUNCATE price_stage");
      await copyRows(
        c,
        "price_stage",
        STAGE_COLS,
        (function* () {
          for (const r of rows)
            yield [
              r.eik,
              r.ekatte,
              r.settlement,
              r.obshtina,
              r.oblast,
              r.chain,
              r.store,
              r.storeNorm,
              r.chainCode,
              r.product,
              r.productNorm,
              r.productId,
              r.price,
              r.promo,
            ];
        })(),
      );

      // ── dimensions ────────────────────────────────────────────────────
      await c.query(
        `INSERT INTO price_chains (eik, name, first_seen, last_seen)
         SELECT eik, min(chain_name), $1::date, $1::date FROM price_stage GROUP BY eik
         ON CONFLICT (eik) DO UPDATE SET last_seen = $1::date, name = EXCLUDED.name`,
        [day],
      );

      await c.query(
        `INSERT INTO price_stores
           (eik, ekatte, settlement, obshtina, oblast, label, label_norm, first_seen, last_seen)
         SELECT eik, ekatte, min(settlement), min(obshtina), min(oblast),
                min(store_label), store_label_norm, $1::date, $1::date
           FROM price_stage GROUP BY eik, ekatte, store_label_norm
         ON CONFLICT (eik, ekatte, label_norm) DO UPDATE SET last_seen = $1::date`,
        [day],
      );

      // pid CAN change when a chain re-categorizes a listing. There is no
      // intra-day timestamp, so on the rare day one (eik, chain_code, name_norm)
      // carries two pids we take max(pid) — deterministic, if arbitrary. Only
      // affects the price_skus dimension; the grids read pid from price_stage.
      await c.query(
        `INSERT INTO price_skus (eik, chain_code, raw_name, name_norm, pid, first_seen, last_seen)
         SELECT eik, chain_code, min(raw_name), name_norm, max(pid), $1::date, $1::date
           FROM price_stage GROUP BY eik, chain_code, name_norm
         ON CONFLICT (eik, chain_code, name_norm)
         DO UPDATE SET last_seen = $1::date, pid = EXCLUDED.pid`,
        [day],
      );

      await c.query(
        `INSERT INTO price_chain_days (day, eik, rows)
         SELECT $1::date, eik, count(*) FROM price_stage GROUP BY eik
         ON CONFLICT (day, eik) DO UPDATE SET rows = EXCLUDED.rows`,
        [day],
      );

      // ── today's observations, one row per (store, sku) ─────────────────
      // DISTINCT ON, not min(price)+min(promo): a store may list the same SKU
      // twice, and independent aggregates would pair a regular price from one
      // listing with a promo from another (min() also skips NULLs).
      await c.query(`
        CREATE TEMP TABLE obs ON COMMIT DROP AS
        SELECT DISTINCT ON (s.store_id, k.sku_id)
               s.store_id, k.sku_id, s.ekatte, s.eik, k.pid,
               g.price_eur, g.promo_eur, g.store_label
          FROM price_stage g
          JOIN price_stores s
            ON s.eik = g.eik AND s.ekatte = g.ekatte AND s.label_norm = g.store_label_norm
          JOIN price_skus k
            ON k.eik = g.eik AND k.chain_code = g.chain_code AND k.name_norm = g.name_norm
         ORDER BY s.store_id, k.sku_id, g.price_eur ASC`);
      await c.query("CREATE INDEX ON obs (store_id, sku_id)");
      await c.query("ANALYZE obs");

      // The SCD-2 price_facts transitions (undo → close → open). Extracted so
      // scripts/db/tests/prices_facts_scd.data.test.ts exercises the REAL logic
      // rather than a copy that could drift.
      const { inserted, closed } = await applyPriceFactsDelta(c, day, "obs");

      // ── (3) today's truth. TRUNCATE resets the heap: no bloat. ─────────
      await c.query("TRUNCATE price_current");
      await c.query(
        `INSERT INTO price_current (store_id, sku_id, price_eur, promo_eur)
         SELECT store_id, sku_id, price_eur, promo_eur FROM obs`,
      );

      // ── (4) daily aggregates, from the day's OWN observations ──────────
      // Built from price_stage (RAW rows), not obs. parse.ts computes
      // avg/median/max/stores over every raw row, and a store may list the same
      // SKU twice; obs de-duplicates those. Using obs here would silently
      // diverge from the 188 shipped daily grids and break the parity gate.
      //
      // Mirrors CellAgg in types.ts field for field, so build_index's maths
      // ports unchanged. cheapest_eik is the chain holding the settlement
      // minimum; cheapest_store is that observation's free-text store label.
      await c.query(`DELETE FROM price_grid_days WHERE day = $1::date`, [day]);
      await c.query(
        `INSERT INTO price_grid_days
           (day, ekatte, pid, min_eur, avg_eur, max_eur, median_eur,
            promo_min_eur, stores, chains, cheapest_eik, cheapest_store)
         SELECT $1::date, ekatte, pid,
                min(price_eur), avg(price_eur), max(price_eur),
                percentile_cont(0.5) WITHIN GROUP (ORDER BY price_eur),
                min(promo_eur),
                count(DISTINCT (eik, store_label)), count(DISTINCT eik),
                -- store_label is a final tiebreak: when the cheapest eik has
                -- several stores at the same min price, (price, eik) is not a
                -- total order, so which store_label lands at [1] would otherwise
                -- vary across re-loads (grid is DELETE+INSERT). Determinism.
                (array_agg(eik ORDER BY price_eur ASC, eik COLLATE "C" ASC, store_label COLLATE "C" ASC))[1],
                (array_agg(store_label ORDER BY price_eur ASC, eik COLLATE "C" ASC, store_label COLLATE "C" ASC))[1]
           FROM price_stage GROUP BY ekatte, pid`,
        [day],
      );

      await c.query(`DELETE FROM price_chain_grid_days WHERE day = $1::date`, [
        day,
      ]);
      await c.query(
        `INSERT INTO price_chain_grid_days (day, ekatte, eik, pid, min_eur)
         SELECT $1::date, ekatte, eik, pid, min(price_eur)
           FROM price_stage GROUP BY ekatte, eik, pid`,
        [day],
      );

      // ── changelog. Scoped to price_facts_today: recordIngestBatch
      // full-scans opts.table, and pointed at price_facts it would scan the
      // whole 10-70M-row corpus daily. Alias must be `t` — ingest_changelog
      // hardcodes `FROM <table> t`.
      await recordIngestBatch(c, {
        source: "kzp_prices",
        table: "price_facts_today",
        keyExpr: "md5(t.store_id || '|' || t.sku_id || '|' || t.valid_from)",
        rowsTotal: rows.length,
      });

      await c.query("TRUNCATE price_stage");
      await c.query("COMMIT");

      const [agg] = await allRows<{
        chains: string;
        stores: string;
        settlements: string;
      }>(
        `SELECT count(DISTINCT eik) AS chains,
                count(*) AS stores,
                count(DISTINCT ekatte) AS settlements
           FROM price_stores WHERE last_seen = $1::date`,
        [day],
      );

      return {
        day,
        observations: rows.length,
        chains: Number(agg.chains),
        stores: Number(agg.stores),
        settlements: Number(agg.settlements),
        factsInserted: inserted,
        factsClosed: closed,
        unresolved,
        legacyCodes,
        parseErrors,
      };
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    }
  });
};
