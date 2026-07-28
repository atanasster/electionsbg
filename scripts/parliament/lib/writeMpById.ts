import fs from "fs";
import path from "path";

/** Emit one tiny shard per MP (`<out>/by-id/<id>.json`) holding that single
 * roster entry, exactly as it appears in `index.json`'s `mps[]`.
 *
 * The candidate page resolves an MP by id straight from the URL, so a former /
 * off-ballot MP's dashboard can render its header + drive its per-MP data hooks
 * without downloading the whole ~950 KB `index.json` roster just to read one
 * entry. See src/data/parliament/useMpEntry.tsx + CandidateMpContext.
 *
 * SWEEPS ORPHANS. An id that leaves `index.json` — the name-dedupe drops one of two
 * records for the same person, or parliament.bg retires an id — used to leave its shard
 * behind forever. `useMpEntry` resolves a shard straight from a URL id and never
 * consults the roster, so a stale deep-link kept serving an entry that no longer exists
 * and, worse, one frozen at whatever schema it was written with: after `seatedRegion`
 * was added, the single orphan was the only entry in the tree without it. Same sweep
 * scripts/procurement/by_id.ts:117 does for the same reason.
 *
 * Returns the number of shards written. */
export const writeMpByIdShards = (
  mps: ReadonlyArray<{ id: number }>,
  outDir: string,
): number => {
  const dir = path.join(outDir, "by-id");
  fs.mkdirSync(dir, { recursive: true });
  const live = new Set<string>();
  let written = 0;
  for (const mp of mps) {
    if (mp.id == null) continue;
    const file = `${mp.id}.json`;
    fs.writeFileSync(path.join(dir, file), JSON.stringify(mp));
    live.add(file);
    written += 1;
  }
  for (const f of fs.readdirSync(dir))
    if (f.endsWith(".json") && !live.has(f)) fs.unlinkSync(path.join(dir, f));
  return written;
};
