// Apply migration 156, load the EU peer bands, and refresh the hub stat cache.
//
//   npm run db:load:budget-hub:pg
//   npm run db:load:budget-hub:pg:cloud
//
// Plan: docs/plans/budget-hub-v1.md T4.
//
// IN the db:refresh chain, after db:load:budget-muni:pg — which applies 152-155.
// This one adds 156 on top, so it must run second; the ORDER_PAIRS entry holds
// that. Its only file input is `data/macro_peers.json`, which is COMMITTED, so
// absence is a defect rather than the fresh-clone state.
//
// The matview is built over tables that may be EMPTY (152/153's filler is in
// REFRESH_EXCLUSIONS). That is fine and deliberate: it yields zero rows, and
// `budget_hub_stats()` then returns NULL, which every consumer degrades on. What
// it must never do is report zeroes as figures.

import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  allRows,
  exec,
  withTx,
  end,
  refreshMatviewConcurrently,
  vacuumAfterReload,
} from "./lib/pg";
import { copyRows } from "./lib/copy";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "../..");
const SCHEMA = resolve(__dirname, "schema/pg/156_budget_hub_stats.sql");
const PEERS = resolve(REPO, "data/macro_peers.json");

/** The three na_items /budget renders. macro_peers.json carries more; the hub
 *  needs exactly these, which is the whole point of not fetching the file. */
const PEER_ITEMS = ["TR", "TE", "B9"] as const;

interface PeerBand {
  year: number;
  bgPctGdp: number | null;
  euAvgPctGdp: number | null;
  rank: number | null;
  total: number | null;
}
interface MacroPeersFile {
  distribution?: Partial<Record<string, PeerBand>>;
}

export const loadBudgetHubPg = async (): Promise<{
  peerBands: number;
  years: number;
}> => {
  await exec(readFileSync(SCHEMA, "utf8"));

  if (!existsSync(PEERS)) {
    throw new Error(
      "data/macro_peers.json is missing. It is COMMITTED, so this is not the " +
        "fresh-clone case — restore it or run the macro ingest.",
    );
  }
  const peers = JSON.parse(readFileSync(PEERS, "utf8")) as MacroPeersFile;
  const rows: Array<Array<string | number | null>> = [];
  for (const k of PEER_ITEMS) {
    const b = peers.distribution?.[k];
    if (b) rows.push([k, b.year, b.bgPctGdp, b.euAvgPctGdp, b.rank, b.total]);
  }

  if (rows.length !== PEER_ITEMS.length) {
    // Refusing rather than loading a subset: a missing band renders as no chip
    // at all, which reads as „no EU comparison exists" rather than „this one
    // did not load".
    throw new Error(
      `macro_peers.json carries ${rows.length} of ${PEER_ITEMS.length} required bands ` +
        `(${PEER_ITEMS.join(", ")}). Refusing to publish a partial comparison.`,
    );
  }

  await withTx(async (c) => {
    await c.query("TRUNCATE budget_peer_band");
    await copyRows(
      c,
      "budget_peer_band",
      ["na_item", "year", "bg_pct_gdp", "eu_avg_pct_gdp", "rank", "total"],
      rows,
    );
  });

  // CONCURRENTLY, which the plain-column unique index in 156 is what makes
  // possible. A plain REFRESH takes an AccessExclusiveLock and blocks every
  // /budget view for its duration.
  await refreshMatviewConcurrently("budget_hub_stats_cache");

  // TRUNCATE + COPY in one transaction is exactly the shape that leaves
  // relallvisible = 0 for ever.
  await vacuumAfterReload("budget_peer_band");

  const [n] = await allRows<{ n: string }>(
    "SELECT count(*)::text n FROM budget_hub_stats_cache",
  );
  return { peerBands: rows.length, years: Number(n.n) };
};

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  loadBudgetHubPg()
    .then((r) => {
      console.log(
        `[budget-hub] ${r.peerBands} peer band(s), ${r.years} fiscal year(s) cached`,
      );
      if (r.years === 0) {
        console.warn(
          "[budget-hub] the cache is EMPTY — 152/153 carry no rows here. That is " +
            "expected on a fresh clone (db:load:budget:pg is in REFRESH_EXCLUSIONS); " +
            "run it to fill the state corpus.",
        );
      }
      return end();
    })
    .catch(async (e) => {
      console.error(e);
      await end();
      process.exit(1);
    });
}
