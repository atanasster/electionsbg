// Rebuild every per-município votes shard under data/council/votes/ from the
// DURABLE per-resolution shard tree (data/council/<code>/<YYYY>/<id>.json),
// and resync meta.resolutionCount in the index.
//
// It used to read data/council/index.json, on the assumption that the index
// inlined perCouncillor[]. `writeIndex` strips exactly that field, so after
// the first merge the index carried none and this script was a silent no-op.
// Reading the durable tree makes it the repair tool for a votes shard that has
// fallen behind its own município's history.
//
// Idempotent: re-running is safe, and the merge in writeVotesShard is additive
// so it can only ever add entries back.
//
// Run with: tsx scripts/council/rebuild_shards.ts [--allow-shrink]
//
// --allow-shrink overrides the votes-shard shrink guard. Needed only when a
// município's named-vote history has legitimately been reduced; a healthy
// repair only ever ADDS entries back.

import { rebuildShardsFromDurable } from "./lib/index_writer";

const main = async (): Promise<void> => {
  const allowShrink = process.argv.includes("--allow-shrink");
  const r = await rebuildShardsFromDurable({ allowShrink });
  // `resolutionsWithVotes` and `voteRows` differ by ~25x on the real corpus
  // (1,169 vs 29,054), so both are named rather than one being called "rows".
  console.log(
    `[council] rebuilt votes shards + resynced meta.resolutionCount — ` +
      `munis=${r.munis} shardsWritten=${r.shardsWritten} ` +
      `resolutionsWithVotes=${r.resolutionsWithVotes} voteRows=${r.voteRows}`,
  );
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
