// Rebuild every per-município votes shard under data/council/votes/ from the
// DURABLE per-resolution shard tree (data/council/<code>/<YYYY>/<id>.json),
// resync meta.resolutionCount, and PRUNE index rows that have no durable
// shard.
//
// It used to read data/council/index.json, on the assumption that the index
// inlined perCouncillor[]. `writeIndex` strips exactly that field, so after
// the first merge the index carried none and this script was a silent no-op.
// Reading the durable tree makes it the repair tool for a votes shard that has
// fallen behind its own município's history.
//
// Idempotent: re-running is safe (the second run prunes nothing). The
// votes-shard side is additive and can only ever add entries back; the INDEX
// side can now REMOVE rows — see the prune below.
//
// The prune is what makes this the repair tool for a purge. Before 2026-08-25
// it resynced the COUNT and left the ROWS: `cbbcd220e4` purged 84 phantom
// resolutions, ran this, and reported "the shards and index rebuilt to match"
// — the counts were then re-broken by the next scrape and the 84 rows survived
// in the committed artifact for three days.
//
// Run with: tsx scripts/council/rebuild_shards.ts [--allow-shrink] [--allow-prune]
//
// --allow-shrink overrides the votes-shard shrink guard. Needed only when a
// município's named-vote history has legitimately been reduced; a healthy
// repair only ever ADDS entries back.
//
// --allow-prune overrides the index-prune ceiling. The ceiling refuses a drop
// that is both large in absolute terms and a majority of a município's window,
// because that is what a missing or misdirected shard tree looks like —
// measured, an absent tree took 300 of 300 rows and exited 0.
//
// PREFER THE SCOPED FORM: `--allow-prune=RSE01,PVN01` disarms the ceiling only
// for the municipalities you have actually inspected. The bare
// `--allow-prune` disarms it for the whole corpus, including whichever
// município is genuinely broken — whose window then goes to zero in the same
// commit. Either way, check the shard tree is where you think it is before
// overriding: a refusal is much more often a wrong COUNCIL_DATA_DIR or a
// partial checkout than a real purge.

import { rebuildShardsFromDurable } from "./lib/index_writer";
import { parseAllowPrune } from "./lib/allow_prune";

const main = async (): Promise<void> => {
  const allowShrink = process.argv.includes("--allow-shrink");
  const allowPrune = parseAllowPrune(process.argv);
  const r = await rebuildShardsFromDurable({ allowShrink, allowPrune });
  // `resolutionsWithVotes` and `voteRows` differ by ~25x on the real corpus
  // (1,169 vs 29,054), so both are named rather than one being called "rows".
  console.log(
    `[council] rebuilt votes shards + resynced meta.resolutionCount + pruned ` +
      `shard-less index rows — ` +
      `munis=${r.munis} shardsWritten=${r.shardsWritten} ` +
      `resolutionsWithVotes=${r.resolutionsWithVotes} voteRows=${r.voteRows} ` +
      `rowsPruned=${r.rowsPruned}`,
  );
  // A prune is newsworthy: it deletes rows from a committed artifact, and the
  // per-município detail is on stderr above. Say so on the summary line too,
  // so it is not lost in a 16-município run's output.
  if (r.rowsPruned > 0) {
    console.log(
      `[council] ${r.rowsPruned} index row(s) had no durable shard and were ` +
        `dropped — review the diff to data/council/index.json before committing`,
    );
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
