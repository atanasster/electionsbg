// One-shot rebuilder: takes the existing (unstripped) data/council/index.json
// — which currently inlines perCouncillor[] inside each resolution — and
// regenerates the slim index + per-município votes shards under
// data/council/votes/<obshtinaCode>.json.
//
// Idempotent: re-running is safe. Once this has run once, mergeMuniResult
// in lib/index_writer.ts keeps the two files in sync incrementally so this
// script doesn't need to be wired into the watcher.
//
// Run with: tsx scripts/council/rebuild_shards.ts

import { rebuildShardsFromIndex } from "./lib/index_writer";

const main = async (): Promise<void> => {
  const r = await rebuildShardsFromIndex();
  console.log(
    `[council] rebuilt index + votes shards — munis=${r.munis} shardsWritten=${r.shardsWritten} totalRows=${r.votesTotal}`,
  );
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
