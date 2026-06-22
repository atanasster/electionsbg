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
 * Returns the number of shards written. */
export const writeMpByIdShards = (
  mps: ReadonlyArray<{ id: number }>,
  outDir: string,
): number => {
  const dir = path.join(outDir, "by-id");
  fs.mkdirSync(dir, { recursive: true });
  let written = 0;
  for (const mp of mps) {
    if (mp.id == null) continue;
    fs.writeFileSync(path.join(dir, `${mp.id}.json`), JSON.stringify(mp));
    written += 1;
  }
  return written;
};
