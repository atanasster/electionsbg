// Load company NKID (НКИД/КИД-2008 = NACE) + the NACE→CPV crosswalk into LOCAL
// Postgres, for the procurement declared-activity mismatch flag
// (docs/plans/nkid-cpv-mismatch-v1.md, plan §8 B1).
//
// Two data sources, ONE loader:
//   • company_nkid  ← the cached CR Deeds store (parse CR_F_6a_L per company).
//   • nace_cpv_allow + nace_cpv_opinion + nace_cpv_universal  ← the committed TS
//     crosswalk artifact (src/lib/naceCpv.ts), the single source of truth the SQL
//     cache (112) + TS scorer both read. Seeded every run so a crosswalk edit ships
//     by re-running the loader.
//
//   npm run db:load:cr-nkid:pg          # local, from the CR store + artifact
//   (then) npm run db:load:cr-nkid:pg:cloud   # ship to Cloud SQL
//
// Applies migration 140 itself (idempotent), so it works on a cold DB. The company_nkid
// half is mtime-gated on the CR store (like db:load:cr-founding:pg) — but the crosswalk
// tables are ALWAYS reseeded (cheap, ~170 rows) so an artifact-only change lands without
// a --force. No-op company_nkid when no crawl has run yet.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CrDeedsStore } from "../declarations/tr/cr_deeds_store";
import { CR_DEEDS_DB } from "../declarations/tr/fetch_cr_deeds";
import { parseCrDeed } from "../declarations/tr/parse_cr_deeds";
import {
  naceCpvAllowRows,
  naceCpvOpinionDivisions,
  naceCpvUniversalDivisions,
} from "../../src/lib/naceCpv";
import { exec, withTx, end } from "./lib/pg";
import { copyRows } from "./lib/copy";
import { refreshRiskIndexesIfPresent } from "./lib/refreshRiskIndexes";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = path.join(__dirname, "schema/pg/140_nkid_cpv.sql");
const FOLD_MARKER = `${CR_DEEDS_DB}.nkid`;

/** Reseed the crosswalk tables from the TS artifact — the single source of truth. */
const seedCrosswalk = async (): Promise<{
  allow: number;
  opinion: number;
  universal: number;
}> => {
  const allow = naceCpvAllowRows();
  const opinion = naceCpvOpinionDivisions();
  const universal = naceCpvUniversalDivisions();
  await withTx(async (c) => {
    await c.query(
      "TRUNCATE nace_cpv_allow, nace_cpv_opinion, nace_cpv_universal",
    );
    for (const [nace, cpv] of allow)
      await c.query(
        "INSERT INTO nace_cpv_allow (nace_div, cpv_div) VALUES ($1,$2)",
        [nace, cpv],
      );
    for (const div of opinion)
      await c.query("INSERT INTO nace_cpv_opinion (nace_div) VALUES ($1)", [
        div,
      ]);
    for (const div of universal)
      await c.query("INSERT INTO nace_cpv_universal (cpv_div) VALUES ($1)", [
        div,
      ]);
  });
  return {
    allow: allow.length,
    opinion: opinion.length,
    universal: universal.length,
  };
};

const main = async () => {
  const force = process.argv.includes("--force");
  await exec(fs.readFileSync(MIGRATION, "utf8")); // idempotent CREATE IF NOT EXISTS

  const cw = await seedCrosswalk();
  console.log(
    `✓ crosswalk: ${cw.allow} allow rows, ${cw.opinion} opinion divisions, ${cw.universal} universal divisions (from src/lib/naceCpv.ts)`,
  );

  if (!fs.existsSync(CR_DEEDS_DB)) {
    console.log(
      `· no CR Deeds store at ${CR_DEEDS_DB} — company_nkid left as-is (run tr:cr-deeds first).`,
    );
    await end();
    return;
  }

  const storeMtime = fs.statSync(CR_DEEDS_DB).mtimeMs;
  if (!force && fs.existsSync(FOLD_MARKER)) {
    const last = Number(fs.readFileSync(FOLD_MARKER, "utf8").trim());
    if (Number.isFinite(last) && storeMtime <= last) {
      console.log(
        "· CR Deeds store unchanged since the last NKID fold — company_nkid kept (pass --force to re-fold).",
      );
      await end();
      return;
    }
  }

  // Parse each capture's NACE. Only rows with a division are companies we can key on.
  const store = new CrDeedsStore(CR_DEEDS_DB);
  const rows: Array<[string, string | null, string, string | null]> = [];
  try {
    for (const { uic, body } of store.captured()) {
      const parsed = parseCrDeed(body);
      if (parsed?.naceDivision)
        rows.push([uic, parsed.naceCode, parsed.naceDivision, parsed.nkid]);
    }
  } finally {
    store.close();
  }

  // The load below is a whole-table DELETE+INSERT, so an empty parse result would
  // WIPE a previously-populated served table (a truncated store, a parse
  // regression, or a fresh crawl that captured only unparseable deeds). Keep
  // company_nkid as-is in that case — mirrors load_cr_founding_pg's guard. No
  // marker write, so the next run retries once the store yields real rows.
  if (rows.length === 0) {
    console.log(
      "· CR Deeds store yielded no company with a NACE division — company_nkid kept as-is.",
    );
    await end();
    return;
  }

  // Stage + swap: company_nkid is a served table, so replace it in one transaction
  // (RowExclusiveLock only) rather than TRUNCATE-ing the live table under readers.
  await withTx(async (c) => {
    await c.query(
      "CREATE TEMP TABLE _nkid (eik text, nace_code text, nace_div text, label text) ON COMMIT DROP",
    );
    await copyRows(c, "_nkid", ["eik", "nace_code", "nace_div", "label"], rows);
    await c.query("DELETE FROM company_nkid");
    await c.query(
      `INSERT INTO company_nkid (eik, nace_code, nace_div, label, source)
       SELECT eik, nace_code, nace_div, label, 'registryagency:CR/Deeds' FROM _nkid`,
    );
  });
  fs.writeFileSync(FOLD_MARKER, String(storeMtime));
  console.log(
    `✓ company_nkid: loaded ${rows.length} companies with a NACE division.`,
  );

  // company_nkid feeds the nkidByEik key of procurement_risk_indexes_cache (033),
  // a MATERIALIZED VIEW — new rows sit in the table but never reach the SPA/server
  // until the cache is refreshed. Any writer of a table that payload embeds must
  // refresh it (guarded no-op when the matview isn't present yet).
  await refreshRiskIndexesIfPresent();
  await end();
};

main().catch(async (e) => {
  console.error(
    "✗ load_cr_nkid_pg failed:",
    e instanceof Error ? e.message : e,
  );
  await end().catch(() => {});
  process.exit(1);
});
