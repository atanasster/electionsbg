// Load the Council of Ministers spending decrees crawled from Държавен вестник
// (raw_data/budget/dv_decrees.sqlite, gitignored) into `budget_spending_decree` +
// `budget_spending_decree_clause` (migration 209).
//
//   pnpm run db:load:budget-decrees:pg
//   pnpm run db:load:budget-decrees:pg:cloud
//
// Re-parses every stored decree, so a parser fix needs no re-crawl. Skips and warns
// when the store is absent (a fresh clone): `pnpm run budget:dv-decrees` builds it. The
// store only ever grows and a decree never changes once promulgated, so the tables are
// replaced from it whole — one transaction, RowExclusiveLock only.

import fs from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { end, exec, vacuumAfterReload, withTx } from "./lib/pg";
import { copyRows } from "./lib/copy";
import { recordIngestBatch } from "./lib/ingest_changelog";
import {
  parseSpendingDecree,
  type DvHeader,
  type SpendingDecree,
} from "../budget/decrees/dv_decree";
import { DvStore } from "../budget/decrees/dv_store";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = path.resolve(__dirname, "schema/pg");
const STORE_FILE = path.resolve(
  __dirname,
  "../../raw_data/budget/dv_decrees.sqlite",
);

/** Above this share of stored decrees yielding no amount, assume the wording of Чл. 1
 *  changed and refuse rather than publish decrees with their money missing. */
const MAX_NO_AMOUNT = 0.1;

export type LoadedDecree = SpendingDecree & { idMat: number; header: DvHeader };

/** Parse every stored decree page. Other ПМС kept in the store (a decree that is not
 *  „за одобряване на допълнителни разходи/трансфери") are skipped — and counted, so a
 *  change in DV's wording shows up as a number rather than as missing decrees. */
export const parseStore = (
  pages: Iterable<{ id: number; header: DvHeader; html: string }>,
): { decrees: LoadedDecree[]; noAmount: number[]; skipped: number } => {
  const decrees: LoadedDecree[] = [];
  const noAmount: number[] = [];
  let skipped = 0;
  for (const p of pages) {
    const d = parseSpendingDecree(p.html, p.header);
    if (!d) {
      skipped++;
      continue;
    }
    if (!d.clauses.length) noAmount.push(p.id);
    decrees.push({ ...d, idMat: p.id, header: p.header });
  }
  return { decrees, noAmount, skipped };
};

const main = async (): Promise<void> => {
  for (const f of [
    "000_search_fns.sql",
    "005_ingest_tracking.sql",
    "209_budget_spending_decree.sql",
  ])
    await exec(fs.readFileSync(path.join(SCHEMA_DIR, f), "utf8"));

  if (!existsSync(STORE_FILE)) {
    console.warn(
      `→ schema applied; no ${path.relative(process.cwd(), STORE_FILE)} — run ` +
        "`pnpm run budget:dv-decrees` first.",
    );
    await end();
    return;
  }

  const store = new DvStore(STORE_FILE);
  const { decrees, noAmount, skipped } = parseStore(store.decrees());
  store.close();
  if (!decrees.length) {
    console.warn("→ the DV store holds no spending decree — nothing to load");
    await end();
    return;
  }
  if (noAmount.length > decrees.length * MAX_NO_AMOUNT)
    throw new Error(
      `${noAmount.length}/${decrees.length} decrees yielded no amount (first idMat ` +
        `${noAmount[0]}) — the wording of Чл. 1 likely changed; refusing to load.`,
    );

  let rowsNew = 0;
  await withTx(async (c) => {
    await c.query("DELETE FROM budget_spending_decree");
    await copyRows(
      c,
      "budget_spending_decree",
      [
        "id_mat",
        "decree_no",
        "decree_date",
        "kind",
        "budget_of",
        "budget_year",
        "title",
        "issue_no",
        "issue_date",
        "body",
      ],
      decrees.map((d) => [
        d.idMat,
        d.number,
        d.date,
        d.kind,
        d.budgetOf,
        d.budgetYear,
        d.header.title,
        d.header.issueNo,
        d.header.issueDate,
        d.text,
      ]),
    );
    await copyRows(
      c,
      "budget_spending_decree_clause",
      [
        "id_mat",
        "seq",
        "amount_native",
        "currency",
        "amount_eur",
        "up_to",
        "purpose",
      ],
      decrees.flatMap((d) =>
        d.clauses.map((k) => [
          d.idMat,
          k.seq,
          k.native,
          k.currency,
          k.eur,
          k.upTo,
          k.purpose,
        ]),
      ),
    );
    const r = await recordIngestBatch(c, {
      source: "budget_spending_decree",
      table: "budget_spending_decree",
      keyExpr: "t.id_mat::text",
      nameExpr: "t.title",
      detailExpr: "t.budget_of",
      rowsTotal: decrees.length,
    });
    rowsNew = r.rowsNew;
  });
  await vacuumAfterReload(
    "budget_spending_decree",
    "budget_spending_decree_clause",
  );
  console.log(
    `✓ budget_spending_decree: ${decrees.length} decree(s) · ${rowsNew} new` +
      (noAmount.length ? ` · ${noAmount.length} without an amount` : "") +
      ` · ${skipped} other ПМС in the store not modelled`,
  );
  await end();
};

if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch(async (e) => {
    console.error(e instanceof Error ? e.message : e);
    await end().catch(() => {});
    process.exit(1);
  });
