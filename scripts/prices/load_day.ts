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
//     price_current          — today's truth (merged from today's observations)
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
import { withClient, allRows, vacuumAfterReload } from "../db/lib/pg";
import { copyRows } from "../db/lib/copy";
import { recordIngestBatch } from "../db/lib/ingest_changelog";
import {
  parseChainCsv,
  parseChainFromFilename,
  ChainParseError,
} from "./lib/normalize";
import {
  reconcileRowLoss,
  describeReconciliation,
  chainsAccountedFor,
  cliffVerdict,
  RESIDUE_TOLERANCE,
} from "./lib/chain_reconcile";
import { resolvePlace } from "./lib/locations";
import {
  COVERAGE_WINDOW_DAYS,
  COVERAGE_FLOOR,
  trailingChainMedian,
  clearsCoverageFloor,
} from "./lib/coverage";
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
  /** Rows the last-known layer accepted, and rows a corrected re-publish
   *  withdrew. Reported because a refusal (a newer `as_of` already stored — the
   *  correct behaviour under --backfill) is otherwise indistinguishable from a
   *  write that never happened. */
  lastSeenWritten: number;
  lastSeenWithdrawn: number;
  /** Set when the day's reporter count fell below COVERAGE_FLOOR of its
   *  trailing median. The day is still loaded — see the guard's note — so this
   *  is how the run's summary can report a slide the per-day floor cannot see. */
  coverageShortfall: { chains: number; trailingMedian: number } | null;
}

/** A day is rejected if its rows OR chains fall this far below the previous
 *  loaded day — a guard against a parse regression quietly wiping price_current
 *  (fully replaced by each day's observations) with a fraction of the day.
 *
 *  ⚠️ This compares against YESTERDAY, which a monotone slide passes every
 *  single day. Measured on the real 2026-08 collapse (203 → 140 → 132 → 115 →
 *  107 → 101 → 98 chains, −52%), it fires exactly ONCE. The trailing-median
 *  check in the guard below is the arm that catches the ratchet; this one
 *  catches a cliff, and only this one can refuse a day.
 *
 *  --backfill, --force and --no-floor downgrade it to a printed warning. They
 *  no longer skip it in silence, which is the part that mattered: the day the
 *  cliff check would have caught in 2026-08 was loaded through a bypass that
 *  said nothing at all. */
export const SANITY_DROP = 0.2;

interface StageRow extends PriceRow {
  settlement: string;
  obshtina: string;
  oblast: string;
}

/** Parse the ZIP into stage-ready rows. resolvePlace() runs HERE, not later.
 *
 *  Exported for `load_day.test.ts`, which pins the one ordering in this
 *  function that is safety-critical: `archiveEiks` is recorded ABOVE the parse
 *  (see the note at the call site). */
export const readZip = async (
  zipPath: string,
): Promise<{
  rows: StageRow[];
  unresolved: number;
  legacyCodes: number;
  parseErrors: number;
  /** Every chain EIK whose CSV was PRESENT in the archive, whatever came of
   *  parsing it. This is "the source published a file for this chain today",
   *  which is not the same as "we ended up with rows from it" — the difference
   *  is what lets the guard tell a chain that stopped filing from a file we
   *  failed to read. */
  archiveEiks: Set<string>;
}> => {
  const dir = await unzipper.Open.file(zipPath);
  const rows: StageRow[] = [];
  const archiveEiks = new Set<string>();
  let unresolved = 0;
  let legacyCodes = 0;
  let parseErrors = 0;

  for (const f of dir.files.filter((x) => /\.csv$/i.test(x.path))) {
    // Recorded BEFORE the parse, so a file that fails to read still counts as
    // published. Otherwise a parse failure would masquerade as the chain not
    // having filed, which is the one confusion this set exists to prevent.
    //
    // `parseChainFromFilename` deliberately never throws — on a name with no
    // `_` it returns the whole basename as the eik. That is the right trade on
    // a path that must not abort the read: a stray non-chain CSV adds a junk
    // key, and the set is only ever probed with `has()`. The shape check keeps
    // the junk out anyway, so a junk key can never mark a real chain absent.
    const { eik: fileEik } = parseChainFromFilename(f.path);
    if (/^\d{9,13}$/.test(fileEik)) archiveEiks.add(fileEik);
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
  return { rows, unresolved, legacyCodes, parseErrors, archiveEiks };
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
  const { rows, unresolved, legacyCodes, parseErrors, archiveEiks } =
    await readZip(zipPath);
  if (rows.length === 0)
    throw new Error(`${day}: ZIP produced zero usable rows`);

  const rowsByEik = new Map<string, number>();
  const chainNames = new Map<string, string>();
  for (const r of rows) {
    rowsByEik.set(r.eik, (rowsByEik.get(r.eik) ?? 0) + 1);
    if (!chainNames.has(r.eik)) chainNames.set(r.eik, r.chain);
  }
  const chainsToday = rowsByEik.size;

  let coverageShortfall: DayStats["coverageShortfall"] = null;

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

  // Sanity floor (FINDING-001): price_current is fully replaced by each day's
  // observations (upsert-all + delete-absent), so a day that parsed far fewer
  // rows/chains than the last loaded day would silently replace "today's truth"
  // with a fraction. Refuse it.
  //
  // TWO reference points, because they fail differently, and they are NOT both
  // hard floors:
  //
  //   the per-day CLIFF (below) throws. A day that parses to a fraction of
  //   yesterday is most likely a parse regression, and price_current — which
  //   the product ladder, search and deals all read — is fully replaced by
  //   each day's observations.
  //
  //   the trailing-median RATCHET (after it) only WARNS. It must not throw,
  //   and the reason is structural: `price_chain_days` receives a row only for
  //   a day that was LOADED, so a refused day never joins the baseline the
  //   next day is judged against. Measured on the current corpus — trailing
  //   median 203, floor 162.4, feed at 98 — a throwing ratchet refuses every
  //   subsequent day until the feed recovers by +66%, and since ingest.ts has
  //   no per-day catch it exits before rebuilding the payloads too. The site
  //   would go stale on a corpus that is fine.
  //
  // The publisher already owns the decision this guard must not make: T0.4's
  // `headlineDate` withholds a thin day from the headline while still shipping
  // it in the series. So the ingest's job here is to RECORD and to be LOUD,
  // never to lose data the source genuinely published.
  //
  // What no path may do is pass silently. --backfill and --force used to skip
  // the cliff check with no output at all, which is how the 2026-08-09 day (a
  // −31% drop the check would have caught) entered the corpus unremarked; they
  // now downgrade it to a printed warning instead.
  {
    // ONE statement, one snapshot, one basis. The aggregate and the per-chain
    // breakdown used to be two independent round-trips each re-resolving
    // `max(day)`, so `prevRows` had two derivations with nothing asserting they
    // described the same day. ~200 rows unconditionally is nothing against a
    // 1.4M-row load.
    //
    // The JOIN is what lets `describeReconciliation` name a chain that filed
    // NOTHING today: names harvested from today's rows necessarily miss exactly
    // the absent chains the message exists to identify.
    const prevRowsByEik = await allRows<{
      eik: string;
      rows: string;
      name: string | null;
    }>(
      `SELECT d.eik, d.rows::text AS rows, c.name
         FROM price_chain_days d
         LEFT JOIN price_chains c USING (eik)
        WHERE d.day = (SELECT max(day) FROM price_chain_days WHERE day < $1::date)`,
      [day],
    );
    const prevByEik = new Map<string, number>();
    for (const r of prevRowsByEik) {
      prevByEik.set(r.eik, Number(r.rows));
      if (r.name && !chainNames.has(r.eik)) chainNames.set(r.eik, r.name);
    }
    let prevRows = 0;
    for (const n of prevByEik.values()) prevRows += n;
    const prevChains = prevByEik.size;
    const cliff: string[] = [];
    if (prevRows > 0 && rows.length < prevRows * (1 - SANITY_DROP))
      cliff.push(
        `${rows.length.toLocaleString()} rows vs ${prevRows.toLocaleString()} the previous day`,
      );
    if (prevChains > 0 && chainsToday < prevChains * (1 - SANITY_DROP))
      cliff.push(`${chainsToday} chains vs ${prevChains} the previous day`);
    if (cliff.length) {
      // The cliff fired. Before refusing, ask WHY the day is smaller: a drop
      // that identified chains account for is the feed shrinking (real, and the
      // day must load), while a drop spread across chains that are all still
      // filing is the shape a parse regression takes.
      //
      const rec = reconcileRowLoss(
        prevByEik,
        rowsByEik,
        parseErrors,
        archiveEiks,
      );
      const why = describeReconciliation(
        rec,
        (eik) => chainNames.get(eik) ?? eik,
      );
      const detail =
        `${day}: ${cliff.join("; ")} ` +
        `(>${SANITY_DROP * 100}% drop${parseErrors ? `, ${parseErrors} parse errors` : ""}).`;

      // F006: the cliff has two arms and either can fire it. A row verdict does
      // not answer a chain-count trigger, so the chains that went missing must
      // ALSO be the ones we identified.
      const chainsOk = chainsAccountedFor(
        rec,
        chainsToday,
        prevChains,
        SANITY_DROP,
      );

      const verdict = cliffVerdict(rec, chainsOk, !!opts.skipFloor);

      if (verdict === "load") {
        // Attributable, and the parse was clean. This is the case the blanket
        // --no-floor used to be needed for; the daily path no longer needs it.
        console.warn(
          `[prices] ⚠ ${detail} ${why} — within the ${RESIDUE_TOLERANCE * 100}% ` +
            `residue tolerance, so the drop is the feed rather than the parse. Loading.`,
        );
      } else if (verdict === "warn-bypass") {
        // Never silent. The bypass exists so a backfill is not stopped by a
        // real historical dip, and so a deliberate re-load can proceed — but
        // it says so, every time.
        console.warn(
          `[prices] ⚠ ${detail} ${why} Loading anyway (floor bypassed). If this is a ` +
            `parse regression it has now replaced price_current.`,
        );
      } else
        throw new Error(
          `${detail} ${why}. Refusing to overwrite price_current: the loss is ` +
            (chainsOk
              ? `NOT attributable to collapsed chains`
              : `NOT attributable: ${chainsToday} chains today + ${rec.collapsed.length} ` +
                `identified as collapsed does not account for ${prevChains} yesterday`) +
            (parseErrors > 0
              ? ` (and ${parseErrors} file(s) failed to parse, which forbids attribution)`
              : "") +
            `. Investigate the feed, or re-run with --no-floor if the drop is real.`,
        );
    }

    // …and against the trailing median, which a slide cannot drag with it.
    const trail = await allRows<{ chains: string }>(
      `SELECT count(*)::text AS chains
         FROM price_chain_days
        WHERE day < $1::date
        GROUP BY day
        ORDER BY day DESC
        LIMIT $2`,
      [day, COVERAGE_WINDOW_DAYS],
    );
    // Query returns newest-first; trailingChainMedian expects chronological
    // order with the judged day at index `i`.
    const chainsPerDay = trail.map((r) => Number(r.chains)).reverse();
    const median = trailingChainMedian(chainsPerDay, chainsPerDay.length);
    if (!clearsCoverageFloor(chainsToday, median)) {
      // WARN, never throw — see the note above. This is the arm that makes a
      // ratchet visible: a slide clears the per-day check at every step while
      // compounding without limit (measured, 203 → 98 over six days trips the
      // per-day floor exactly once).
      console.warn(
        `[prices] ⚠ ${day}: ${chainsToday} chains against a trailing median of ` +
          `${median} over the last ${chainsPerDay.length} loaded days ` +
          `(<${COVERAGE_FLOOR * 100}% of normal). The previous day alone does not ` +
          `catch this. Loading it — the day is real and the publisher withholds ` +
          `it from the headline (index.json coverage.headlineDate) — but the ` +
          `feed is materially smaller than it was. Investigate.`,
      );
      // clearsCoverageFloor is false only when median is non-null.
      coverageShortfall = { chains: chainsToday, trailingMedian: median! };
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

      // ── (3) today's truth, MERGED from obs — never TRUNCATE + INSERT ───
      // This used to be `TRUNCATE price_current; INSERT … FROM obs`, inside this
      // same transaction. TRUNCATE's AccessExclusiveLock was therefore held from
      // here until the COMMIT below (the grids, the changelog scan) — and
      // /api/db/price-product reads price_current. Readers hit the serving pool's
      // 2 s lock_timeout and 500'd in bursts on every ingest (measured on prod:
      // 2026-07-27 23:36, 07-29 00:55, 07-30 16:28). The upsert and the anti-join
      // delete take RowExclusiveLock instead, which readers do not conflict with;
      // obs already carries a unique (store_id, sku_id) and an index on it.
      //
      // The cost of losing TRUNCATE is dead tuples rather than a reset heap, so
      // the upsert is guarded by IS DISTINCT FROM: on a normal day most of the
      // ~1.4M store-facts are unchanged and are not rewritten at all.
      await c.query(
        `INSERT INTO price_current (store_id, sku_id, price_eur, promo_eur)
         SELECT store_id, sku_id, price_eur, promo_eur FROM obs
         ON CONFLICT (store_id, sku_id) DO UPDATE
            SET price_eur = excluded.price_eur, promo_eur = excluded.promo_eur
          WHERE (price_current.price_eur, price_current.promo_eur)
            IS DISTINCT FROM (excluded.price_eur, excluded.promo_eur)`,
      );
      // Delisted since yesterday: absence is only knowable at observation time,
      // so what today's feed omits must go (048's header rule).
      await c.query(
        `DELETE FROM price_current pc
          WHERE NOT EXISTS (SELECT 1 FROM obs o
                             WHERE o.store_id = pc.store_id AND o.sku_id = pc.sku_id)`,
      );
      // Parity guard: after upsert-all + delete-absent, price_current must equal
      // today's observations exactly. A mismatch is a merge bug — fail rather
      // than serve a corrupted "today's truth" (the old TRUNCATE made this
      // structurally impossible, so replacing it means asserting it).
      const parity = await c.query<{ live: string; obs: string }>(
        `SELECT (SELECT count(*) FROM price_current) AS live,
                (SELECT count(*) FROM obs) AS obs`,
      );
      if (parity.rows[0].live !== parity.rows[0].obs)
        throw new Error(
          `price_current merge parity check failed: live=${parity.rows[0].live} obs=${parity.rows[0].obs}`,
        );

      // ── (3b) last-known price per (store, sku) ─────────────────────────
      // The same observations, upserted and NEVER deleted. price_current above
      // is "today's truth" and drops what today's feed omits; this is "the last
      // price we ever saw, and when" — which is what lets a chain that stopped
      // filing keep a page instead of being pruned out of the served layer.
      //
      // Deliberately AFTER the parity guard: that assertion is about
      // price_current alone, and this table must never be able to influence it.
      const lastSeenUpsert = await c.query(
        `INSERT INTO price_last_seen (store_id, sku_id, price_eur, promo_eur, as_of)
         SELECT store_id, sku_id, price_eur, promo_eur, $1::date FROM obs
         ON CONFLICT (store_id, sku_id) DO UPDATE
            SET price_eur = excluded.price_eur,
                promo_eur = excluded.promo_eur,
                as_of     = excluded.as_of
          WHERE price_last_seen.as_of <= excluded.as_of`,
        [day],
      );
      // Re-publish repair. Every other day-scoped write in this loader is
      // idempotent by REPLACEMENT (price_facts step 0 undoes a prior load of the
      // day; the two grids delete the day and rebuild it). Without the same arm
      // here, a corrected re-publish that WITHDRAWS a (store, sku) leaves this
      // table asserting a price stamped with that day which the corrected feed
      // says was never filed — attributed to a named retailer, which is the
      // invention the plan rejects.
      //
      // The row is removed rather than reverted to its pre-D value: that value
      // is not recoverable from this table alone. It does NOT breach "never
      // delete a chain's record" — price_facts, price_chain_days and the
      // dimensions are untouched — but it does mean a re-published day can
      // shrink the table, so any future non-shrink gate must exempt it.
      const lastSeenWithdrawn = await c.query(
        `DELETE FROM price_last_seen pls
          WHERE pls.as_of = $1::date
            AND NOT EXISTS (SELECT 1 FROM obs o
                             WHERE o.store_id = pls.store_id
                               AND o.sku_id  = pls.sku_id)`,
        [day],
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
      // Not optional: step 3b rewrites every observed row every day, so
      // price_last_seen's visibility map is zeroed and no scan over it can go
      // index-only. VACUUM cannot run inside a transaction block, so it lives
      // here rather than above. price_current is in the same position.
      await vacuumAfterReload("price_last_seen", "price_current");

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
        lastSeenWritten: lastSeenUpsert.rowCount ?? 0,
        lastSeenWithdrawn: lastSeenWithdrawn.rowCount ?? 0,
        coverageShortfall,
      };
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    }
  });
};
