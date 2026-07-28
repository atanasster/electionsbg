// Fold the cached ЦАИС ЕОП annex ("анекси") feed onto the contract shards,
// FLIPPING `amountEur` to the CURRENT (post-annex) contract value in place and
// preserving the original at-signing value in `signingAmountEur`.
//
// Why flip rather than add a column. `amountEur` is the value every aggregate,
// rollup and serving SUM already reads. Making it the current value means the
// whole corpus becomes current-basis (matching SIGMA's default list value) with
// ZERO changes to the ~30 SUM(amount_eur) sites — the current value is the
// headline. The at-signing value lives on in `signingAmountEur` (present only
// when an annex moved the value) for the per-contract Δ and the euro-peg canary.
//
// Background. Each annex record (ingest_anexi.ts cache) carries
// `currentContractValue`, the running post-annex value; the annex with the latest
// publicationDate holds the final current value. This pass indexes every annex,
// folds each contract's annexes to its latest current value, converts to EUR
// (same 1.95583 peg), and flips `amountEur` when it materially differs from
// signing. Idempotent: the signing baseline is always `signingAmountEur ??
// amountEur`, so re-running recomputes from the true signed value.
//
// Identity join, strongest first (mirrors ingest_eop.ts::contentKeys — precision
// over recall; a wrong current value is worse than none):
//   K1  buyerEik + normalized contractNumber + lotIdentifier   (most specific)
//   K2  proper УНП + supplierEik                                (lot-agnostic)
// A value/date fuzzy fallback is deliberately omitted: the annex value is the
// thing that changed, so it can't safely key the match.
//
//   tsx scripts/procurement/anexi_current_value.ts            # dry run (coverage)
//   tsx scripts/procurement/anexi_current_value.ts --apply    # write onto shards
//   tsx scripts/procurement/rebuild_from_cache.ts             # rebuild rollups/derived
//
// Re-runnable: idempotent. Sets currentAmountEur from scratch each run (clears a
// stale value when an annex is later corrected to equal signing). No network.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { command, run, flag, optional, boolean } from "cmd-ts";
import { canonicalJson } from "./validate";
import type { Contract } from "./types";
import { buildAnnexIndex, lookup } from "./lib/annexResolve";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROCUREMENT_DIR = path.resolve(__dirname, "../../data/procurement");
const CONTRACTS_DIR = path.join(PROCUREMENT_DIR, "contracts");

const main = (apply: boolean): void => {
  console.log("→ indexing анекси cache…");
  const { idx, records, days } = buildAnnexIndex();
  console.log(
    `  ${days} published days, ${records} annex value-records; ` +
      `${idx.byContractNo.size.toLocaleString()} contract-no keys, ` +
      `${idx.byUnpSupplier.size.toLocaleString()} УНП+supplier keys`,
  );
  if (records === 0) {
    console.log("No annex cache — run ingest_anexi.ts --backfill first.");
    return;
  }

  const years = fs
    .readdirSync(CONTRACTS_DIR)
    .filter((y) => /^\d{4}$/.test(y))
    .sort();
  let total = 0;
  let matched = 0;
  let changed = 0;
  let cleared = 0;
  let deltaUpEur = 0;
  let deltaDownEur = 0;
  let filesChanged = 0;

  for (const y of years) {
    const dir = path.join(CONTRACTS_DIR, y);
    for (const file of fs.readdirSync(dir).filter((f) => /\.json$/.test(f))) {
      const full = path.join(dir, file);
      const rows = JSON.parse(fs.readFileSync(full, "utf8")) as Contract[];
      let touched = false;
      for (const c of rows) {
        // Strip the superseded field from an earlier model, if present.
        if (
          (c as { currentAmountEur?: number }).currentAmountEur !== undefined
        ) {
          delete (c as { currentAmountEur?: number }).currentAmountEur;
          touched = true;
        }
        if (c.tag !== "contract") continue;
        total++;
        // The true SIGNING value survives in signingAmountEur once flipped; before
        // any flip it is amountEur. Always resolve from it so the pass is idempotent.
        const signed = c.signingAmountEur ?? c.amountEur;
        if (signed == null) continue;
        const cur = lookup(idx, c, signed);
        if (cur != null && Math.abs(cur - signed) >= 0.005) {
          matched++;
          // Flip in place: amountEur becomes the current value; the signing value
          // is preserved for the Δ. amount/currency stay the native SIGNED figures.
          if (c.amountEur !== cur || c.signingAmountEur !== signed) {
            c.signingAmountEur = signed;
            c.amountEur = cur;
            touched = true;
            changed++;
          }
          if (cur > signed) deltaUpEur += cur - signed;
          else deltaDownEur += signed - cur;
        } else if (c.signingAmountEur != null) {
          // A previously-flipped row whose annex no longer moves the value: restore.
          c.amountEur = signed;
          delete c.signingAmountEur;
          touched = true;
          cleared++;
        }
      }
      if (touched && apply) {
        fs.writeFileSync(full, canonicalJson(rows));
        filesChanged++;
      }
    }
  }

  console.log(
    `\n→ ${total.toLocaleString()} contracts scanned; ` +
      `${matched.toLocaleString()} got a current value ≠ signing`,
  );
  console.log(
    `  set/updated ${changed.toLocaleString()}, cleared ${cleared.toLocaleString()} stale`,
  );
  console.log(
    `  Σ increases +€${(deltaUpEur / 1e6).toFixed(1)}M, ` +
      `Σ reductions −€${(deltaDownEur / 1e6).toFixed(1)}M, ` +
      `net €${((deltaUpEur - deltaDownEur) / 1e6).toFixed(1)}M`,
  );
  if (!apply) {
    console.log(
      "\n✓ dry run — pass --apply to write currentAmountEur onto shards",
    );
    return;
  }
  console.log(`→ wrote ${filesChanged} shard(s)`);
  console.log(
    "✓ done. Now rebuild: tsx scripts/procurement/rebuild_from_cache.ts",
  );
};

const cli = command({
  name: "anexi_current_value",
  args: {
    apply: flag({
      type: optional(boolean),
      long: "apply",
      description:
        "Write currentAmountEur onto the month-shards (default dry).",
      defaultValue: () => false,
    }),
  },
  handler: (a) => main(!!a.apply),
});

run(cli, process.argv.slice(2));
