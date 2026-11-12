// Git operations the runners need, under the repo's rules: commit by explicit
// pathspec only (never `git add -A`, never a bare commit — a concurrent
// auto-committer and other sessions leave the index dirty), straight to the
// current branch, no trailer.

import { execFileSync } from "node:child_process";
import { REPO } from "./state";

const git = (args: string[], cwd: string): string =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60_000,
  }).trim();

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
      timeout: 60_000,
    },
  );
  return parsePorcelainZ(out);
};

/** Paths under `pathspecs` that are STAGED already — someone else's work,
 *  since the runners never stage before they commit. */
export const stagedUnder = (
  pathspecs: readonly string[],
  cwd: string = REPO,
): string[] => {
  if (!pathspecs.length) return [];
  return git(["diff", "--cached", "--name-only", "--", ...pathspecs], cwd)
    .split("\n")
    .filter(Boolean);
};

export type CommitResult =
  | { status: "committed"; sha: string; files: string[] }
  | { status: "nothing" }
  | { status: "failed"; error: string };

/** Commit exactly the changes under `pathspecs`. New files under them are
 *  added first (`git add --` on those paths only); nothing else is staged. A
 *  deleted tracked file is recorded as a deletion. */
export const commitPaths = (
  message: string,
  pathspecs: readonly string[],
  cwd: string = REPO,
): CommitResult => {
  try {
    const files = changedUnder(pathspecs, cwd);
    if (!files.length) return { status: "nothing" };
    // Explicit paths only. `git add <deleted path>` stages the deletion.
    git(["add", "--", ...files], cwd);
    git(["commit", "-q", "-m", message, "--", ...files], cwd);
    return { status: "committed", sha: git(["rev-parse", "HEAD"], cwd), files };
  } catch (e) {
    const err = e as { stderr?: Buffer | string; message?: string };
    return {
      status: "failed",
      error: String(err.stderr ?? err.message ?? e)
        .trim()
        .slice(0, 500),
    };
  }
};
