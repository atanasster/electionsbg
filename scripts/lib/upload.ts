// Shared GCS upload helpers. Wraps the `gsutil cp -Z` pattern documented in
// commit 5743f3bc3 so each ingest script (scrape_mps, scrape_polls,
// scrape_rollcall, …) doesn't re-invent it.
//
// Bucket conventions (per commit 5743f3bc3):
//   - All JSON/CSV is gzipped in flight (-Z). Storage stores compressed; the
//     SPA's HTTP client transparently decompresses.
//   - Non-text binaries (e.g. .webp photos) are uploaded WITHOUT -Z. Use
//     uploadBinary() for those.
//   - Cache-Control: long immutable for hashed paths, short for index/mutable
//     paths. We default to "no-cache" on JSON because the SPA reads via React
//     Query with staleTime: Infinity and our deploy cycle never relies on the
//     bucket cache.

import { spawn } from "child_process";

const BUCKET = process.env.GCS_BUCKET ?? "gs://data-electionsbg-com";

const run = (cmd: string, args: string[]): Promise<void> =>
  new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "inherit" });
    p.on("error", reject);
    p.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} exited ${code}`));
    });
  });

// Upload one JSON/CSV/text file. gzipped in flight via -Z.
export const uploadText = async (
  localPath: string,
  remoteSubpath: string,
  opts: { cacheControl?: string } = {},
): Promise<void> => {
  const remote = `${BUCKET}/${remoteSubpath.replace(/^\//, "")}`;
  const cache = opts.cacheControl ?? "no-cache, max-age=0";
  await run("gsutil", [
    "-h",
    `Cache-Control:${cache}`,
    "cp",
    "-Z",
    localPath,
    remote,
  ]);
};

// Upload a directory tree of text files, stored gzip-COMPRESSED and served with
// Content-Encoding: gzip so the SPA downloads ~90% fewer bytes.
//
// This used to be `rsync -r -J`, but `-J` is gzip *transport* encoding — it
// compresses the upload transfer only and stores each object `identity`, so the
// bucket served the files uncompressed (a 23 KB rollup / 59 KB reconciliation
// went over the wire in full). `gsutil rsync` has no content-encoding option, so
// to serve compressed we switch to `cp -Z` (the same flag `uploadText` already
// uses for single files, and why parliament/index.json is gzip-served today).
//
// Trade-off: `cp` has no incremental skip. GCS stores the compressed bytes,
// whose checksum can't be compared against the local uncompressed file, so the
// whole tree re-uploads every run — an operator-side cost paid per ingest, in
// exchange for a continuous ~90% bandwidth cut for every visitor. Like the old
// rsync call (no `-d`), this never deletes remote objects absent from the source.
//
// `<dir>/*` uploads the CONTENTS of localDir (not the dir itself), and gsutil's
// wildcard skips dotfiles so .gitkeep / .DS_Store don't leak into the bucket; we
// still prune any nested .DS_Store first, since `-r` would otherwise recurse into
// them.
export const uploadTextTree = async (
  localDir: string,
  remoteSubpath: string,
  opts: { cacheControl?: string } = {},
): Promise<void> => {
  const dir = localDir.replace(/\/$/, "");
  const remote = `${BUCKET}/${remoteSubpath.replace(/^\//, "")}`;
  const cache = opts.cacheControl ?? "no-cache, max-age=0";
  await run("find", [dir, "-name", ".DS_Store", "-delete"]);
  await run("gsutil", [
    "-m",
    "-h",
    `Cache-Control:${cache}`,
    "cp",
    "-Z", // gzip content-encoding: stored compressed, served Content-Encoding: gzip
    "-r",
    `${dir}/*`,
    `${remote}/`,
  ]);
};

// Upload one binary (e.g. .webp). NOT gzipped — already compressed formats
// shouldn't be re-compressed.
export const uploadBinary = async (
  localPath: string,
  remoteSubpath: string,
  opts: { cacheControl?: string } = {},
): Promise<void> => {
  const remote = `${BUCKET}/${remoteSubpath.replace(/^\//, "")}`;
  // Immutable cache for binaries — they're content-addressed where possible
  // (MP photos by id, election charts by hash). Override for mutable assets.
  const cache = opts.cacheControl ?? "public, max-age=31536000, immutable";
  await run("gsutil", [
    "-h",
    `Cache-Control:${cache}`,
    "cp",
    localPath,
    remote,
  ]);
};
