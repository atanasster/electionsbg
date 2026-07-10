// Apply AMOUNT_OVERRIDES to the existing contract shards.
//
// The three normalizers now correct these amounts at ingest, but
// data/procurement/contracts/ holds ~300k rows built before that change. This
// patches them in place, the way backfill_unp.ts did.
//
//   npx tsx scripts/procurement/fix_amount_overrides.ts           # dry run
//   npx tsx scripts/procurement/fix_amount_overrides.ts --apply   # write
//
// Multi-supplier awards. A contract's value is split across its suppliers at
// normalize time, so a single shard row holds `total / n`, not the total. We
// therefore group by (ocid, contractId), compare the GROUP SUM against the
// recorded corrupt value, and only then rescale each row by
// `correctedAmount / sourceAmount`. Matching a single row against the total
// would silently skip every consortium award.
//
// Re-runnable: idempotent. Once a group is corrected its sum no longer matches
// `sourceAmount`, so a second run finds nothing. Same guard as overrideAmount().

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { command, run, flag } from "cmd-ts";
import { canonicalJson } from "./validate";
import { AMOUNT_OVERRIDES, type AmountOverride } from "./amount_overrides";
import { toEur } from "@/lib/currency";
import type { Contract } from "./types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONTRACTS_DIR = path.resolve(
  __dirname,
  "../../data/procurement/contracts",
);

// A group sum can drift from the published total by float noise once it has been
// divided by a supplier count and re-added. One stotinka of slack, no more.
const SUM_EPSILON = 0.01;

const lookup = (c: Contract): AmountOverride | undefined =>
  AMOUNT_OVERRIDES.find(
    (o) =>
      c.contractId === o.contractId &&
      ((o.unp && c.unp === o.unp) || (o.ocid && c.ocid === o.ocid)),
  );

const main = command({
  name: "fix_amount_overrides",
  args: { apply: flag({ long: "apply", description: "write onto shards" }) },
  handler: ({ apply }) => {
    let groupsFixed = 0;
    let rowsFixed = 0;
    let eurBefore = 0;
    let eurAfter = 0;
    const skipped: string[] = [];

    for (const year of fs.readdirSync(CONTRACTS_DIR).sort()) {
      const dir = path.join(CONTRACTS_DIR, year);
      if (year === "by-id" || !fs.statSync(dir).isDirectory()) continue;

      for (const f of fs.readdirSync(dir).sort()) {
        if (!f.endsWith(".json")) continue;
        const p = path.join(dir, f);
        const rows = JSON.parse(fs.readFileSync(p, "utf8")) as Contract[];

        // Group the candidate rows by (ocid, contractId) — one signed contract.
        const groups = new Map<
          string,
          { o: AmountOverride; rows: Contract[] }
        >();
        for (const c of rows) {
          if (c.tag === "contractAmendment") continue;
          const o = lookup(c);
          if (!o) continue;
          const k = `${c.ocid}::${c.contractId}`;
          const g = groups.get(k) ?? { o, rows: [] };
          g.rows.push(c);
          groups.set(k, g);
        }
        if (groups.size === 0) continue;

        let touched = false;
        for (const [k, { o, rows: grp }] of groups) {
          const sum = grp.reduce((a, c) => a + (c.amount ?? 0), 0);
          if (Math.abs(sum - o.sourceAmount) > SUM_EPSILON) {
            skipped.push(
              `${k} — sum ${sum.toFixed(2)} ${o.currency} != recorded ${o.sourceAmount.toFixed(2)} (already fixed, or the source changed)`,
            );
            continue;
          }
          const scale = o.correctedAmount / o.sourceAmount;
          for (const c of grp) {
            eurBefore += c.amountEur ?? 0;
            c.amount = (c.amount ?? 0) * scale;
            c.amountEur = toEur(c.amount, c.currency) ?? undefined;
            eurAfter += c.amountEur ?? 0;
            rowsFixed++;
          }
          groupsFixed++;
          touched = true;
          console.log(
            `  ${o.buyer} — ${k}: ${o.sourceAmount.toLocaleString("en-US")} -> ${o.correctedAmount.toLocaleString("en-US")} ${o.currency} (${grp.length} row${grp.length > 1 ? "s" : ""})`,
          );
        }
        if (touched && apply) fs.writeFileSync(p, canonicalJson(rows));
      }
    }

    console.log(
      `\ngroups corrected ${groupsFixed} / ${AMOUNT_OVERRIDES.length} in table`,
    );
    console.log(`rows rewritten   ${rowsFixed}`);
    console.log(
      `EUR removed      ${Math.round(eurBefore - eurAfter).toLocaleString("en-US")} (${Math.round(eurBefore).toLocaleString("en-US")} -> ${Math.round(eurAfter).toLocaleString("en-US")})`,
    );
    if (skipped.length) {
      console.log(`\nskipped (guard did not match): ${skipped.length}`);
      for (const s of skipped) console.log(`  ${s}`);
    }
    if (!apply) console.log("\nDry run — pass --apply to write.");
  },
});

run(main, process.argv.slice(2));
