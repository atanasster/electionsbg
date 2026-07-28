// Load per-annex contract modifications into procurement_annexes (migration 114)
// from the raw ЦАИС ЕОП cache. Each stored row is one published modification,
// attributed to a contract by the SAME K2→K1 keys + three guards the
// current-value fold uses (scripts/procurement/lib/annexResolve.ts) — reused, not
// re-derived, so the two never disagree about "this contract's annexes".
//
//   npm run db:load:annexes:pg          (needs `npm run db:pg:up`)
//   npm run db:load:annexes:pg:cloud    (against the Cloud SQL proxy)
//
// Both variants recompute from the LOCAL cache and COPY into whatever
// DATABASE_URL points at — the cache is small (~26k records), so there is no
// build-vs-ship split (unlike the normalcy caches). The migration is applied by
// this loader, so a fresh DB needs nothing else.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool, exec, withTx, end } from "./lib/pg";
import { copyRows } from "./lib/copy";
import { recordIngestBatch } from "./lib/ingest_changelog";
import {
  buildAnnexIndex,
  resolveAnnexKey,
  type AnnexRecordRow,
} from "../procurement/lib/annexResolve";
import type { Contract } from "../procurement/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = path.join(
  __dirname,
  "schema",
  "pg",
  "114_procurement_annexes.sql",
);

const COLS = [
  "contract_key",
  "match_via",
  "notice_id",
  "lot_identifier",
  "publication_date",
  "contract_date",
  "currency",
  "last_value_eur",
  "current_value_eur",
  "value_diff_eur",
  "change_reason",
  "change_reason_description",
  "change_description",
  "direct_award_justification",
];

type ContractRow = {
  key: string;
  unp: string | null;
  awarder_eik: string | null;
  contractor_eik: string | null;
  contract_id: string | null;
  signing_amount_eur: number | null;
  amount_eur: number | null;
};

const main = async (): Promise<void> => {
  console.log("→ applying 114_procurement_annexes.sql…");
  await exec(readFileSync(MIGRATION, "utf8"));

  console.log("→ indexing анекси cache (with per-annex rows)…");
  const { idx, records, days } = buildAnnexIndex({ retainRecords: true });
  console.log(`  ${days} published days, ${records} annex value-records`);
  if (records === 0) {
    console.log(
      "  No annex cache — run `tsx scripts/procurement/ingest_anexi.ts --backfill` first.",
    );
    await end();
    return;
  }

  console.log("→ resolving contracts → annexes…");
  // ~401k contract rows buffered at once (7 small columns ≈ 80-150MB). Fine for
  // an offline batch loader; if the corpus grows an order of magnitude, switch
  // to a server-side cursor (pg-query-stream) here.
  const contracts = (
    await getPool().query<ContractRow>(
      `SELECT key, unp, awarder_eik, contractor_eik, contract_id,
              signing_amount_eur, amount_eur
         FROM contracts WHERE tag = 'contract'`,
    )
  ).rows;

  // De-dup on (contract_key, notice_id, lot) keeping the latest publication —
  // the feed republishes a notice as its value evolves. A notice_id identifies
  // the publication, so republications collapse; but when notice_id is NULL we
  // cannot tell one modification from another by id, so those rows are keyed
  // additionally on (publicationDate, currentValueEur) — otherwise several
  // distinct null-notice annexes on the same contract+lot would collapse to one
  // and silently drop real modifications.
  const emitted = new Map<
    string,
    { key: string; via: "unp" | "contract_no"; row: AnnexRecordRow }
  >();
  let matched = 0;

  for (const cr of contracts) {
    const signed = cr.signing_amount_eur ?? cr.amount_eur;
    if (signed == null) continue;
    const c = {
      unp: cr.unp ?? undefined,
      contractorEik: cr.contractor_eik ?? undefined,
      awarderEik: cr.awarder_eik ?? undefined,
      contractId: cr.contract_id ?? undefined,
    } as Contract;
    const hit = resolveAnnexKey(idx, c, signed);
    if (!hit) continue;
    matched++;
    const rows =
      (hit.via === "unp"
        ? idx.recordsByUnpSupplier?.get(hit.key)
        : idx.recordsByContractNo?.get(hit.key)) ?? [];
    for (const row of rows) {
      const noticeKey =
        row.noticeId != null
          ? `${row.noticeId}`
          : `null:${row.publicationDate ?? ""}:${row.currentValueEur ?? ""}`;
      const dedupe = `${cr.key}|${noticeKey}|${row.lotIdentifier ?? ""}`;
      const prev = emitted.get(dedupe);
      if (
        !prev ||
        (row.publicationDate ?? "") > (prev.row.publicationDate ?? "")
      )
        emitted.set(dedupe, { key: cr.key, via: hit.via, row });
    }
  }

  // Sort before COPY so the surrogate `id` is assigned deterministically across
  // reloads (the contracts query has no ORDER BY, so Map insertion order is not
  // stable). Nobody references the id, but a deterministic load is cheap.
  const rows = [...emitted.values()].sort((a, b) => {
    if (a.key !== b.key) return a.key < b.key ? -1 : 1;
    const an = a.row.noticeId ?? -1;
    const bn = b.row.noticeId ?? -1;
    if (an !== bn) return an - bn;
    const al = a.row.lotIdentifier ?? "";
    const bl = b.row.lotIdentifier ?? "";
    if (al !== bl) return al < bl ? -1 : 1;
    return (a.row.publicationDate ?? "") < (b.row.publicationDate ?? "")
      ? -1
      : 1;
  });
  console.log(
    `  ${matched.toLocaleString()} contracts matched; ${rows.length.toLocaleString()} annex rows`,
  );

  await withTx(async (c) => {
    await c.query("TRUNCATE procurement_annexes");
    await copyRows(
      c,
      "procurement_annexes",
      COLS,
      (function* () {
        for (const { key, via, row } of rows)
          yield [
            key,
            via,
            row.noticeId,
            row.lotIdentifier,
            row.publicationDate,
            row.contractDate,
            row.currency,
            row.lastValueEur,
            row.currentValueEur,
            row.valueDiffEur,
            row.changeReason,
            row.changeReasonDescription,
            row.changeDescription,
            row.directAwardJustification,
          ];
      })(),
    );
    // recent_updates: a real PG-migrated dataset, so it registers like the rest.
    await recordIngestBatch(c, {
      source: "procurement_annex",
      table: "procurement_annexes",
      keyExpr:
        "t.contract_key || '|' || coalesce(t.notice_id::text,'') || '|' || coalesce(t.lot_identifier,'')",
      nameExpr: "t.change_reason",
      detailExpr: "t.change_reason_description",
      amountExpr: "t.value_diff_eur::double precision",
      rowsTotal: rows.length,
    });
  });

  // Fresh TRUNCATE+COPY leaves reltuples=0 until autovacuum; ANALYZE so the first
  // contract_annexes() call plans against real stats.
  await exec("ANALYZE procurement_annexes");
  console.log("✓ done");
  await end();
};

main().catch(async (e) => {
  console.error(
    "✗ load_annexes_pg failed:",
    e instanceof Error ? e.message : e,
  );
  await end().catch(() => {});
  process.exit(1);
});
