// Fold the CR Deeds founding dates into LOCAL company_founded — the replacement
// for scripts/procurement/fetch_company_founded.ts's write path (that crawler is
// retired by the CR Deeds full-capture; docs/plans/cr-deeds-capture-v1.md deliv. 4).
//
// company_founded stays LOCAL-authored: this loader derives founding dates from the
// cached raw store (raw_data/tr/cr_deeds.sqlite) and upserts them here. The existing
// db:load:company-founded:pg:cloud then ships local → Cloud SQL. Nothing to fetch —
// the rate-limited step already happened (fetch_cr_deeds.ts).
//
//   npm run db:load:cr-founding:pg          # local upsert from the CR store
//   (then) npm run db:load:company-founded:pg:cloud   # ship local → Cloud SQL
//
// ⚠️ Needs migration 033's http_status/attempts on the target (upsertFoundingDates
// preflights and throws with the apply command otherwise). No-op when no crawl has
// run yet (no cr_deeds.sqlite / an empty store).

import fs from "node:fs";
import { CrDeedsStore } from "../declarations/tr/cr_deeds_store";
import { CR_DEEDS_DB } from "../declarations/tr/fetch_cr_deeds";
import {
  foundingDatesFromStore,
  upsertFoundingDates,
} from "../declarations/tr/project_cr_deeds";
import { allRows, end, withTx } from "./lib/pg";
import { refreshRiskIndexesIfPresent } from "./lib/refreshRiskIndexes";
import { recordIngestBatch } from "./lib/ingest_changelog";

// The CR-sourced slice of company_founded — the changelog's corpus (as a subquery
// so recordIngestBatch's `FROM ${table} t` records first-seen over exactly it).
const CR_FOUNDED =
  "(SELECT eik, founded_date FROM company_founded WHERE source = 'registryagency:CR/Deeds')";

// Sidecar marking the store mtime we last folded. The crawl is a rare, manual
// operator action, but this loader rides the DAILY tr:daily-refresh — so without a
// change gate every quiet day would re-parse the whole ~478k-body corpus and take a
// non-concurrent AccessExclusive lock on the risk matview for nothing. `--force`
// overrides (e.g. after applying 033 or a manual company_founded edit).
const FOLD_MARKER = `${CR_DEEDS_DB}.folded`;

const main = async () => {
  const force = process.argv.includes("--force");

  if (!fs.existsSync(CR_DEEDS_DB)) {
    console.log(
      `· no CR Deeds store at ${CR_DEEDS_DB} — run the crawl (tr:cr-deeds) first. Nothing to load.`,
    );
    await end();
    return;
  }

  // Change gate: skip when the store hasn't been re-captured since the last fold.
  const storeMtime = fs.statSync(CR_DEEDS_DB).mtimeMs;
  if (!force && fs.existsSync(FOLD_MARKER)) {
    const lastFold = Number(fs.readFileSync(FOLD_MARKER, "utf8").trim());
    if (Number.isFinite(lastFold) && storeMtime <= lastFold) {
      console.log(
        "· CR Deeds store unchanged since the last fold — nothing to load (pass --force to re-fold).",
      );
      await end();
      return;
    }
  }

  const store = new CrDeedsStore(CR_DEEDS_DB);
  let founding;
  try {
    founding = foundingDatesFromStore(store);
  } finally {
    store.close();
  }
  if (founding.length === 0) {
    console.log("· CR Deeds store is empty — nothing to load.");
    fs.writeFileSync(FOLD_MARKER, String(storeMtime));
    await end();
    return;
  }

  const written = await upsertFoundingDates(founding);
  console.log(
    `✓ company_founded: upserted ${written} founding date(s) from ${founding.length} capture(s).`,
  );

  // Changelog (PG-changelog rule): record first-seen for the CR-sourced founding
  // rows so the ingest surfaces in recent_updates like every other PG dataset.
  // Scoped via CR_FOUNDED so it tracks the CR fold only, not the retired crawler's
  // legacy rows. Runs POST-COMMIT (upsertFoundingDates owns its own connection and
  // already committed), so it is deliberately not atomic with the data write — the
  // data is what matters and it already succeeded. rowsTotal is the CR CORPUS size,
  // not this fold's `written` delta, so the summary line reads coherently (the first
  // fold summarises the whole ~15.8k legacy corpus in one "N new · N total" line).
  const [{ n }] = await allRows<{ n: string }>(
    `SELECT count(*)::text AS n FROM ${CR_FOUNDED} t`,
  );
  const changelog = await withTx((c) =>
    recordIngestBatch(c, {
      source: "cr_deeds_founding",
      table: CR_FOUNDED,
      keyExpr: "t.eik",
      nameExpr: "t.eik",
      detailExpr: "'основано ' || COALESCE(t.founded_date::text, '—')",
      rowsTotal: Number(n),
    }),
  );
  console.log(`  changelog: ${changelog.rowsNew} new (${changelog.mode} mode)`);

  // The risk-indexes payload embeds foundedByEik, so the SPA only sees the new dates
  // once the cache is rebuilt.
  await refreshRiskIndexesIfPresent();

  // Record the fold so a subsequent no-change refresh is a fast no-op.
  fs.writeFileSync(FOLD_MARKER, String(storeMtime));
  await end();
};

main().catch(async (e) => {
  console.error(
    "✗ load_cr_founding_pg failed:",
    e instanceof Error ? e.message : e,
  );
  await end().catch(() => {});
  process.exit(1);
});
