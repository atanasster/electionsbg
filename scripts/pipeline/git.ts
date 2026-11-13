// Git operations the runners need, under the repo's rules: commit by explicit
// pathspec only (never `git add -A`, never a bare commit — a concurrent
// auto-committer and other sessions leave the index dirty), straight to the
// current branch, no trailer.

import { execFileSync } from "node:child_process";
import { REPO } from "./state";

/** Generous on purpose: a whole-tree status under data/officials alone is
 *  ~23k paths, past execFileSync's 1 MB default, which would throw ENOBUFS
 *  and read as a failed commit. */
const MAX_BUFFER = 256 * 1024 * 1024;

const gitRaw = (args: string[], cwd: string, input?: string): string =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    timeout: 120_000,
    maxBuffer: MAX_BUFFER,
    ...(input === undefined ? {} : { input }),
  });

const git = (args: string[], cwd: string, input?: string): string =>
  gitRaw(args, cwd, input).trim();

/** Run a git command over an explicit file list fed through stdin
 *  (`--pathspec-from-file=- --pathspec-file-nul`): the list can be tens of
 *  thousands of paths, and as argv it exceeds macOS's ARG_MAX (E2BIG). The
 *  paths are LITERAL — a file name with `*` or `[` is not a glob. */
const gitWithPaths = (
  args: string[],
  files: readonly string[],
  cwd: string,
): string =>
  git(
    [
      "--literal-pathspecs",
      ...args,
      "--pathspec-from-file=-",
      "--pathspec-file-nul",
    ],
    cwd,
    files.join("\0"),
  );

/** `git diff` and `git status` take no --pathspec-from-file, so a long file
 *  list is split into argv-sized batches instead (well under ARG_MAX, which
 *  also has to hold the environment). Literal pathspecs, as above. */
const ARGV_BATCH_BYTES = 128 * 1024;
const gitBatched = (
  args: string[],
  files: readonly string[],
  cwd: string,
): string[] => {
  const outs: string[] = [];
  let batch: string[] = [];
  let bytes = 0;
  const flush = (): void => {
    if (!batch.length) return;
    // Untrimmed: a porcelain record starts with a significant space.
    outs.push(gitRaw(["--literal-pathspecs", ...args, "--", ...batch], cwd));
    batch = [];
    bytes = 0;
  };
  for (const f of files) {
    const n = Buffer.byteLength(f) + 1;
    if (bytes + n > ARGV_BATCH_BYTES) flush();
    batch.push(f);
    bytes += n;
  }
  flush();
  return outs;
};

/** The readable part of a failed execFileSync: stderr, else stdout (git
 *  prints "nothing to commit" there), else the message. */
const errorText = (e: unknown): string => {
  const err = e as {
    stderr?: Buffer | string;
    stdout?: Buffer | string;
    message?: string;
  };
  const stderr = String(err.stderr ?? "").trim();
  const stdout = String(err.stdout ?? "").trim();
  return (
    [stderr, stdout].filter(Boolean).join("\n") ||
    String(err.message ?? e).trim()
  ).slice(0, 500);
};

export const headSha = (cwd: string = REPO): string | null => {
  try {
    return git(["rev-parse", "HEAD"], cwd);
  } catch {
    return null;
  }
};

/** Is `ancestor` reachable from HEAD (equal counts)? */
export const isAncestorOfHead = (
  ancestor: string,
  cwd: string = REPO,
): boolean => {
  try {
    git(["merge-base", "--is-ancestor", ancestor, "HEAD"], cwd);
    return true;
  } catch {
    return false;
  }
};

/** `git status --porcelain -z` → paths. NUL-separated so a path with spaces,
 *  quotes or non-ASCII characters is never quoted or escaped; a rename record
 *  carries its source as a second NUL field, which is skipped. */
export const parsePorcelainZ = (out: string): string[] => {
  const fields = out.split("\0");
  const paths: string[] = [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    if (f.length < 4) continue;
    paths.push(f.slice(3));
    if (f[0] === "R" || f[0] === "C") i++; // skip the rename source
  }
  return paths;
};

/** Paths under `pathspecs` that differ from HEAD or are untracked. */
export const changedUnder = (
  pathspecs: readonly string[],
  cwd: string = REPO,
): string[] => {
  if (!pathspecs.length) return [];
  const out = execFileSync(
    "git",
    [
      "status",
      "--porcelain",
      "-z",
      "--untracked-files=all",
      "--",
      ...pathspecs,
    ],
    {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
      maxBuffer: MAX_BUFFER,
    },
  );
  return parsePorcelainZ(out);
};

/** Of an explicit file list, the ones that still differ from HEAD (staged,
 *  unstaged or untracked). Fed through stdin like every long file list. */
const stillChanged = (files: readonly string[], cwd: string): string[] =>
  gitBatched(
    ["status", "--porcelain", "-z", "--untracked-files=all"],
    files,
    cwd,
  ).flatMap(parsePorcelainZ);

/** Paths under `pathspecs` that are STAGED already — someone else's work,
 *  since the runners never stage before they commit. */
export const stagedUnder = (
  pathspecs: readonly string[],
  cwd: string = REPO,
): string[] => {
  if (!pathspecs.length) return [];
  return gitBatched(["diff", "--cached", "--name-only", "-z"], pathspecs, cwd)
    .flatMap((o) => o.split("\0"))
    .filter(Boolean);
};

export type CommitResult =
  | { status: "committed"; sha: string; files: string[] }
  | { status: "nothing" }
  | { status: "failed"; error: string };

/** Commit exactly the changes under `pathspecs`, minus `exclude` (files a
 *  failed step left behind, files someone else staged). New files are added
 *  first (`git add` on those paths only); nothing else is staged. A
 *  deleted tracked file is recorded as a deletion.
 *
 *  Two races with the concurrent auto-committer are handled rather than
 *  reported as failures: when it committed the files first, git says
 *  "nothing to commit" (on STDOUT, exit 1) — that is `nothing`, not a
 *  failure; when it committed SOME of them, the rest are retried once. A
 *  commit that really fails unstages exactly what this call staged, so the
 *  next run does not mistake them for someone else's staged work. */
export const commitPaths = (
  message: string,
  pathspecs: readonly string[],
  cwd: string = REPO,
  exclude: readonly string[] = [],
): CommitResult => {
  const skip = new Set(exclude);
  let files: string[];
  try {
    files = changedUnder(pathspecs, cwd).filter((f) => !skip.has(f));
  } catch (e) {
    return { status: "failed", error: errorText(e) };
  }
  for (let attempt = 0; ; attempt++) {
    if (!files.length) return { status: "nothing" };
    let stagedBefore: Set<string>;
    try {
      stagedBefore = new Set(stagedUnder(files, cwd));
    } catch (e) {
      return { status: "failed", error: errorText(e) };
    }
    try {
      // Explicit paths only (never -A). Adding a deleted path stages the
      // deletion.
      gitWithPaths(["add"], files, cwd);
      gitWithPaths(["commit", "-q", "-m", message], files, cwd);
      return {
        status: "committed",
        sha: git(["rev-parse", "HEAD"], cwd),
        files,
      };
    } catch (e) {
      const error = errorText(e);
      let left: string[];
      try {
        left = stillChanged(files, cwd);
      } catch {
        left = files;
      }
      // Someone committed exactly these changes in between.
      if (!left.length) return { status: "nothing" };
      const ours = files.filter((f) => !stagedBefore.has(f));
      try {
        if (ours.length) gitWithPaths(["reset", "-q"], ours, cwd);
      } catch {
        // No HEAD yet, or the index is locked — nothing more to undo here.
      }
      // Some were committed by someone else: retry the rest once.
      if (attempt === 0 && left.length < files.length) {
        const keep = new Set(left);
        files = files.filter((f) => keep.has(f));
        continue;
      }
      return { status: "failed", error };
    }
  }
};

/** Paths under `pathspecs` that differ from `sinceSha` (committed since, or
 *  modified in the working tree) or are untracked. `sinceSha` null = HEAD. */
export const differingFrom = (
  sinceSha: string | null,
  pathspecs: readonly string[],
  cwd: string = REPO,
): string[] => {
  if (!pathspecs.length) return [];
  const opts = {
    cwd,
    encoding: "utf8" as const,
    stdio: ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"],
    timeout: 120_000,
    maxBuffer: 256 * 1024 * 1024,
  };
  const tracked = execFileSync(
    "git",
    ["diff", "--name-only", "-z", sinceSha ?? "HEAD", "--", ...pathspecs],
    opts,
  );
  const untracked = execFileSync(
    "git",
    ["ls-files", "--others", "--exclude-standard", "-z", "--", ...pathspecs],
    opts,
  );
  return [
    ...new Set(
      [...tracked.split("\0"), ...untracked.split("\0")].filter(Boolean),
    ),
  ];
};
