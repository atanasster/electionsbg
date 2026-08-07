// Write-to-temp-then-rename, for a file whose truncation would be a data loss.
//
// `fs.writeFileSync` truncates the target BEFORE writing, so a crash (or a kill,
// or a full disk) mid-write leaves a half-file where a good one used to be.
// `rename` is atomic on the same filesystem, so a reader sees either the old
// contents or the new ones and never a prefix of the new.
//
// Use it for any file that is the only copy of something expensive: a crawl
// manifest, an unregenerable outcome corpus, a resume checkpoint. It is NOT
// needed for a file a build step rewrites from committed inputs.
//
// The temp file sits beside the target rather than in os.tmpdir(), because
// rename across filesystems is not atomic (and on macOS the scratch volume
// frequently is a different one).

import fs from "fs";
import path from "path";

export const atomicWriteFileSync = (
  file: string,
  data: string | Buffer,
): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
};

/** `atomicWriteFileSync` with JSON.stringify. `space` defaults to compact. */
export const atomicWriteJsonSync = (
  file: string,
  value: unknown,
  space?: number,
): void => atomicWriteFileSync(file, JSON.stringify(value, null, space));
