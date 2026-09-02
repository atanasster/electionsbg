// Enumerate the source files a corpus-wide pattern sweep must see.
//
// WHY THIS EXISTS. Two static gates in this repo ask the same question — „read
// every source file and look for a pattern" — and a third asks a genuinely
// different one (reachability, `src/entryGraph.test.ts`). The two that agree had
// diverged on both of the things that decide whether such a sweep is honest:
//
//   • WHICH DIRECTORIES. `scripts/i18n/key_usage.ts` learned the answer the hard
//     way and CLAUDE.md records it again from the company-connections retirement:
//     „`src/ scripts/ functions/` reported zero readers of the tree and was wrong:
//     `ai/` is none of those. Any 'is this readerless?' sweep must include it."
//     A gate that scans one directory publishes a guarantee it does not hold — and
//     `absenceCaveat.test.ts` shipped exactly that: `src/`-only, while the sentence
//     it claimed had one writer was also written in `scripts/`.
//   • WHAT COUNTS AS A TEST. Hand-maintained ignore lists miss `*.spec.*` and
//     `__tests__/`, and the miss is a silent false NEGATIVE — the gate goes quiet
//     rather than red.
//
// So: one enumerator, the directory set `key_usage.ts` already argued for, and no
// new dependency (`fast-glob` is not in this repo's package.json — it resolves
// only by npm hoisting it out of tailwind, so a tailwind bump can break a gate
// that imports it).
//
// ⚠️ PATHS COME BACK POSIX-SEPARATED on every platform, because callers compare
// them against literal `"src/screens/…"` constants. `path.join` yields backslashes
// on Windows, where a raw comparison would never fire and the gate would pass
// vacuously — the same trap `key_usage.ts`'s `posix()` helper exists for.

import fs from "node:fs";
import path from "node:path";

/** The trees that hold this project's own code. `ai/` is neither `src` nor
 *  `scripts` nor `functions`, and omitting it has already produced one wrong
 *  answer about a live consumer. */
export const SCAN_DIRS = ["src", "scripts", "ai", "functions"] as const;

const CODE_EXT = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const TEST_FILE = /\.(?:test|spec)\.(?:ts|tsx|js|jsx|mjs|cjs)$/;

const posix = (p: string) => p.split(path.sep).join("/");

const walk = (dir: string, root: string, out: string[]): void => {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // a scanned directory need not exist in every checkout
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      // Dot-directories are somebody else's dependencies rather than our code —
      // `ai/m0/.venv` is a Python virtualenv inside a scanned tree, and its 33
      // vendored JS files would make a gate's verdict a function of a developer's
      // working tree instead of of tracked code.
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      walk(p, root, out);
    } else if (e.isFile() && CODE_EXT.test(e.name)) {
      out.push(posix(path.relative(root, p)));
    }
  }
};

/** Every tracked source file under `dirs`, relative to `root`, POSIX-separated.
 *
 *  `includeTests` defaults to false because the sweeps that use this ask about
 *  SHIPPING code: a test may legitimately contain the pattern it asserts on, and
 *  a stale copy there fails loudly on the next revision, which is the correct
 *  signal. A stale copy in shipping code is silent. */
export const sourceFiles = (
  root: string,
  {
    dirs = SCAN_DIRS as readonly string[],
    includeTests = false,
  }: { dirs?: readonly string[]; includeTests?: boolean } = {},
): string[] => {
  const out: string[] = [];
  for (const d of dirs) walk(path.join(root, d), root, out);
  return includeTests ? out : out.filter((f) => !isTestFile(f));
};

/** True for a path this module classifies as a test. A hand-maintained ignore
 *  list is exactly what missed `*.spec.*` and `__tests__/` before, so the rule
 *  lives once and is exported for callers that want to state it in their own
 *  terms rather than re-derive it. */
export const isTestFile = (p: string): boolean => {
  const rel = posix(p);
  return TEST_FILE.test(rel) || rel.split("/").includes("__tests__");
};
