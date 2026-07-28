// Municipal-tier buyers per settlement, read from Postgres.
//
// The My-Area alert builder needs, for each município centroid, the buyers seated there
// whose tier is 'municipal' — it threads them into the contract and tender alert builders.
// It used to read that out of the data/procurement/by_settlement/<ekatte>.json shards; those
// shards are gone (the by-settlement views are served from Postgres now), and this is the
// same information from the source those shards were generated from.
//
// ONE query for every settlement rather than a per-EKATTE call: the alert builder walks ~265
// municípios, and procurement_settlement_detail() runs the full per-settlement aggregation
// each time it is called.
//
// THROWS when Postgres is unreachable or returns nothing, rather than degrading.
//
// The seo_settlements.ts precedent looks similar but is not equivalent: there, a missing
// source costs some /procurement/settlement/* pages from a sitemap. Here, one transient
// database condition would blank the procurement and tender alerts in ALL ~265 per-município
// files and delete every place-tender summary — silently, with exit 0, in a step the
// watch-report orchestrator runs unattended in a repo that auto-commits. The old code could
// not do that: readJson() returned null per-município for a shard the same pipeline had just
// written, so a total wipe was not a reachable state.
//
// ALERTS_ALLOW_EMPTY=1 opts out for a deliberate run without a database.

import { Pool } from "pg";
import { DATABASE_URL } from "./pg";

export type MuniAwarder = { eik: string; name: string; tier: string };

export const readMunicipalAwardersByEkatte = async (): Promise<
  Map<string, MuniAwarder[]>
> => {
  const out = new Map<string, MuniAwarder[]>();
  const pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
  try {
    const { rows } = await pool.query<{
      ekatte: string;
      eik: string;
      name: string;
      tier: string;
    }>(
      // The name comes from the buyer's MOST RECENT contract, not from MIN(name) — a buyer
      // is spelled several ways across the corpus, and the byte-smallest is the SHOUTING
      // variant ("ОБЩИНА БУРГАС" rather than "Община Бургас"). This reproduces the rule the
      // retired shards used (the rollup kept the last row's name) and is the more current
      // spelling besides. `key` breaks same-day ties so the choice is deterministic.
      `SELECT s.ekatte, s.eik, s.tier,
              (SELECT c.awarder_name FROM contracts c
                WHERE c.awarder_eik = s.eik
                ORDER BY c.date DESC NULLS LAST, c.key DESC LIMIT 1) AS name
         FROM awarder_seats s
        WHERE s.source = 'geo' AND s.is_local_hq AND s.tier = 'municipal'
          AND s.ekatte IS NOT NULL
          AND EXISTS (SELECT 1 FROM contracts c WHERE c.awarder_eik = s.eik)
        -- Biggest buyer first, matching the order the retired shards stored them in. The
        -- consumers iterate EVERY awarder, so this does not decide who gets an alert — but
        -- the events are then date-sorted stably and capped, so the order still decides
        -- which same-date events survive the cap.
        --
        -- ROUNDed before sorting: amount_eur is double precision, so an un-rounded SUM
        -- carries per-instance summation noise and two databases with identical corpora can
        -- order two near-equal buyers differently (the rounded-sort-key rule 030 states
        -- inline). Includes 'award' rows because the rollup total this reproduces did.
        ORDER BY (SELECT ROUND(COALESCE(SUM(c.amount_eur), 0)) FROM contracts c
                   WHERE c.awarder_eik = s.eik) DESC, s.eik`,
    );
    for (const r of rows) {
      const list = out.get(r.ekatte) ?? [];
      list.push({ eik: r.eik, name: r.name, tier: r.tier });
      out.set(r.ekatte, list);
    }
  } catch (err) {
    if (process.env.ALERTS_ALLOW_EMPTY === "1") {
      console.warn(
        `[alerts] municipal awarders: Postgres unavailable, continuing without ` +
          `procurement/tender alerts because ALERTS_ALLOW_EMPTY=1 (${
            (err as Error)?.message ?? String(err)
          })`,
      );
      return out;
    }
    throw new Error(
      `[alerts] municipal awarders: Postgres unavailable — refusing to rewrite every ` +
        `alerts file without procurement data. Run \`npm run db:pg:up\` (and ` +
        `db:load:awarder-seats:pg), or set ALERTS_ALLOW_EMPTY=1 to accept empty alerts. ` +
        `Cause: ${(err as Error)?.message ?? String(err)}`,
    );
  } finally {
    await pool.end().catch(() => undefined);
  }
  if (out.size === 0 && process.env.ALERTS_ALLOW_EMPTY !== "1")
    throw new Error(
      "[alerts] municipal awarders: query succeeded but returned no rows — " +
        "awarder_seats is empty or unloaded (run db:load:awarder-seats:pg). Refusing to " +
        "blank every alerts file; set ALERTS_ALLOW_EMPTY=1 to override.",
    );
  return out;
};
