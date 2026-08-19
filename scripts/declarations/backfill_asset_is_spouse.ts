/**
 * One-off: restamp `isSpouse` on every asset row of every committed declaration shard,
 * after `isSpouseHolder` gained its separator-only second pass.
 *
 * WHY THIS IS NOT A RE-PARSE. Every other backfill in this directory
 * (`backfill_asset_table_num`, `_fx`, `_held_abroad`) exists because the provenance it
 * stamps lives ONLY in the source XML — the shards cannot answer the question, so those
 * scripts index `raw_data/`, re-parse each filing and match rows positionally, which is why
 * each of them can REFUSE a shard whose row set has since moved. `isSpouse` is different in
 * kind: it is a pure function of two fields the shard already carries, `declarantName` on the
 * declaration and `holderName` on the row. So this reads nothing but the shards, cannot
 * disagree with the parser about which row is which, and has no mismatch class at all.
 *
 * The same property is what makes the change safe to verify: the stored PG column was
 * reproducible from those two columns under the OLD rule for 335,676 of 335,676 rows, so any
 * post-reload disagreement is this script having missed a shard rather than an ambiguity.
 *
 * WHAT MOVES. Only ever `true` -> `false`, and only where the register's hand-typed holder is
 * the declarant under a mangled spelling — a lost space („Николай МихайловКолибаров"), a
 * hyphen standing in for one („Багдатова _ Мизова"), a stray comma, slash or digit. Measured
 * 2026-08-19: 563 of 110,835 marked rows on the asset side, 8 of 4,830 on the stake side
 * (which is rendered live and needs no backfill). See `isSpouseHolder`'s header.
 *
 * Manual by design, per the repo's convention for one-off backfills.
 *
 *   npx tsx scripts/declarations/backfill_asset_is_spouse.ts           # dry run
 *   npx tsx scripts/declarations/backfill_asset_is_spouse.ts --apply
 *
 * Then, in this order — `--resolve` alone does NOT rewrite asset rows:
 *   npm run db:load:declarations:pg
 *   npm run db:load:declarations:pg -- --resolve
 *
 * Cloud side is the `:cloud` twin of both and nothing runs it automatically.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { isSpouseHolder } from "../../src/lib/declarations";
import type { MpAsset } from "../../src/data/dataTypes";

const __filename = fileURLToPath(import.meta.url);
const REPO = path.resolve(path.dirname(__filename), "../..");

// The three shard trees load_declarations_pg.ts reads. `data/judiciary/declarations` is the
// fourth spec there and is deliberately absent: the magistrate tier is derived from ВСС PDFs,
// has no cacbg XML behind it, and the directory is empty.
const TREES = [
  "data/parliament/declarations",
  "data/officials/declarations",
  "data/officials/municipal/declarations",
];

type ShardDecl = { declarantName?: string; assets?: MpAsset[] };

/** Re-serialise a shard in the EXACT format it was already stored in — see
 *  scripts/declarations/formats.ts, whose header ends „Do NOT mass-reformat either family to
 *  unify them". The parliament tree is compact, the officials trees are 2-space indented;
 *  writing one format for both buries the real change in a ~1.4M-line whitespace diff that
 *  the next ingest immediately writes back. Detected from the file's OWN bytes so a family
 *  that changes format later cannot start silently churning. */
const reserialize = (raw: string, obj: unknown): string => {
  const pretty = /^\s*\[\s*\n/.test(raw);
  const body = pretty ? JSON.stringify(obj, null, 2) : JSON.stringify(obj);
  return raw.endsWith("\n") ? body + "\n" : body;
};

const main = (): void => {
  const apply = process.argv.includes("--apply");

  let shards = 0;
  let shardsChanged = 0;
  let decls = 0;
  let rows = 0;
  let noDeclarant = 0;
  let trueBefore = 0;
  let trueAfter = 0;
  let toFalse = 0;
  let toTrue = 0;
  const samples: string[] = [];

  for (const tree of TREES) {
    const dir = path.join(REPO, tree);
    if (!fs.existsSync(dir)) {
      console.warn(`[is_spouse] missing ${tree} — skipping`);
      continue;
    }
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const fp = path.join(dir, file);
      let raw: string;
      let parsed: ShardDecl[];
      try {
        raw = fs.readFileSync(fp, "utf-8");
        parsed = JSON.parse(raw) as ShardDecl[];
      } catch {
        console.warn(`[is_spouse] unreadable ${tree}/${file} — skipping`);
        continue;
      }
      if (!Array.isArray(parsed)) continue;
      shards++;
      let dirty = false;

      for (const d of parsed) {
        if (!d.assets?.length) continue;
        decls++;
        // `isSpouseHolder` fails CLOSED on a blank declarant, so a filing with no name would
        // silently clear every row on it. Count and skip instead: leaving the stored value
        // alone is the only option that asserts nothing. Zero across the corpus today.
        if (!d.declarantName) {
          noDeclarant++;
          continue;
        }
        for (const a of d.assets) {
          rows++;
          const next = isSpouseHolder(a.holderName ?? null, d.declarantName);
          if (a.isSpouse) trueBefore++;
          if (next) trueAfter++;
          if (a.isSpouse === next) continue;
          if (next) toTrue++;
          else toFalse++;
          if (samples.length < 20)
            samples.push(
              `${a.isSpouse} -> ${next}   ${a.holderName ?? "∅"}  ||  ${d.declarantName}`,
            );
          // In-place on a key every row already carries, so the diff stays one token per
          // changed row and no key order moves.
          a.isSpouse = next;
          dirty = true;
        }
      }

      if (dirty) {
        shardsChanged++;
        if (apply) fs.writeFileSync(fp, reserialize(raw, parsed), "utf-8");
      }
    }
  }

  console.log(
    `[is_spouse] ${shards} shards, ${decls} declarations, ${rows} asset rows`,
  );
  console.log(
    `[is_spouse] isSpouse true: ${trueBefore} -> ${trueAfter}  (${toFalse} cleared, ${toTrue} set)`,
  );
  if (noDeclarant)
    console.warn(
      `[is_spouse] ${noDeclarant} declaration(s) name no declarant — left alone`,
    );
  for (const s of samples) console.log(`   ${s}`);
  // A row moving INTO „somebody else" cannot come from a separator fold, which only ever
  // removes a difference. It would mean the shard's stored value disagreed with the rule
  // before this change — worth naming rather than folding into the same count.
  if (toTrue)
    console.warn(
      `[is_spouse] ⚠ ${toTrue} row(s) moved false -> true; the separator fold cannot do that — check for a stale shard`,
    );
  console.log(
    apply
      ? `[is_spouse] wrote ${shardsChanged} shard(s)`
      : `[is_spouse] DRY RUN — ${shardsChanged} shard(s) would change; pass --apply to write`,
  );
};

main();
