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

// Upload a directory tree of text files (rsync, gzipped). Only changed files
// are re-uploaded thanks to gsutil rsync's checksum compare.
export const uploadTextTree = async (
  localDir: string,
  remoteSubpath: string,
  opts: { cacheControl?: string } = {},
): Promise<void> => {
  const remote = `${BUCKET}/${remoteSubpath.replace(/^\//, "")}`;
  const cache = opts.cacheControl ?? "no-cache, max-age=0";
  await run("gsutil", [
    "-m",
    "-h",
    `Cache-Control:${cache}`,
    "rsync",
    "-r",
    "-J", // gzip in flight for all uploaded files
    "-x",
    "(\\.DS_Store$|\\.gitkeep$)",
    localDir,
    remote,
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
