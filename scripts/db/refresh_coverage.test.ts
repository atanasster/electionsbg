// The regression gate that turns a silent `db:refresh` omission into a build
// failure (docs/plans/db-refresh-loader-gaps-v1.md T6.1/T6.1a). CLAUDE.md
// documents db:refresh as "schema + every loader + resolve + test:data"; this
// held 26/38 for months with nothing red. The contract now: every local
// `db:load:*` / `db:resolve:*` script is either referenced by `db:refresh` or
// carries an explicit entry in REFRESH_EXCLUSIONS — and the exclusion list
// cannot rot (no stale keys, no double-listed loaders).
//
// Deliberately a plain unit test (test:unit, node project), NOT a
// *.data.test.ts: the assertions are pure JSON + git metadata, and an
// auto-skip-when-Postgres-is-down gate would go green on exactly the machines
// where this matters. Precedent: scripts/bucket_sync_paths.test.ts.

import { test } from "vitest";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  REFRESH_EXCLUSIONS,
  TOLERATED_GITIGNORED_INPUTS,
} from "./refresh_coverage";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const pkg = JSON.parse(
  readFileSync(path.join(ROOT, "package.json"), "utf8"),
) as {
  scripts: Record<string, string>;
};

const localLoaders = Object.keys(pkg.scripts).filter(
  (k) => /^db:(load|resolve):/.test(k) && !k.endsWith(":cloud"),
);

// Tokenize the chain — extract exact `npm run <name>` script names rather than
// substring-matching. `includes()` passes today but is one loader name away
// from a false positive (`db:load:agri:pg` inside `db:load:agri:pg-full`), and
// a gate whose purpose is catching silent omissions must not have one.
const refreshChain = pkg.scripts["db:refresh"];
// `?? ""` keeps the module importable if db:refresh is ever removed, so test 1
// reports its intended diagnostic instead of a collection-time TypeError.
const referenced = new Set(
  [...(refreshChain ?? "").matchAll(/npm run ([a-z0-9:_-]+)/g)].map(
    (m) => m[1],
  ),
);

test("db:refresh exists and still chains npm run steps", () => {
  assert.ok(refreshChain, "package.json has no db:refresh script");
  assert.ok(
    referenced.size >= 20,
    `db:refresh tokenized into only ${referenced.size} scripts — the extraction regex no longer matches its shape`,
  );
});

test("every local db:load/db:resolve script is in db:refresh or REFRESH_EXCLUSIONS", () => {
  const uncovered = localLoaders.filter(
    (k) => !referenced.has(k) && !(k in REFRESH_EXCLUSIONS),
  );
  assert.deepEqual(
    uncovered,
    [],
    `loaders neither run by db:refresh nor documented in scripts/db/refresh_coverage.ts: ${uncovered.join(
      ", ",
    )} — add each to db:refresh (absent-tolerant if its input is gitignored) or to REFRESH_EXCLUSIONS with its axis`,
  );
});

test("REFRESH_EXCLUSIONS carries no stale or contradictory keys", () => {
  const gone = Object.keys(REFRESH_EXCLUSIONS).filter(
    (k) => !localLoaders.includes(k),
  );
  assert.deepEqual(
    gone,
    [],
    `excluded loaders that no longer exist in package.json: ${gone.join(", ")}`,
  );
  const both = Object.keys(REFRESH_EXCLUSIONS).filter((k) => referenced.has(k));
  assert.deepEqual(
    both,
    [],
    `loaders both excluded and run by db:refresh — pick one: ${both.join(", ")}`,
  );
});

// T6.1a — the second invariant, scoped to declared inputs. The §1a mis-sort
// happened because "the inputs are present" was measured on a working copy that
// holds gitignored files a fresh clone does not. The declaration list pins
// which inputs are gitignored-and-tolerated; this test keeps the declaration
// honest against git itself, in both directions.
test("TOLERATED_GITIGNORED_INPUTS names real loaders and genuinely untracked paths", () => {
  // Tie the two exported maps together: a tolerated loader must be either run
  // by db:refresh or an (interim) exclusion — an orphan declaration describes a
  // loader nobody decided about, which is the exact state this module exists
  // to make impossible.
  const orphans = Object.keys(TOLERATED_GITIGNORED_INPUTS).filter(
    (k) => !referenced.has(k) && !(k in REFRESH_EXCLUSIONS),
  );
  assert.deepEqual(
    orphans,
    [],
    `tolerated loaders neither in db:refresh nor REFRESH_EXCLUSIONS: ${orphans.join(", ")}`,
  );
  for (const [loader, inputs] of Object.entries(TOLERATED_GITIGNORED_INPUTS)) {
    assert.ok(
      localLoaders.includes(loader),
      `${loader} declared in TOLERATED_GITIGNORED_INPUTS but is not a local loader script`,
    );
    for (const input of inputs) {
      // A path listed as gitignored-and-tolerated must not be tracked: if it
      // gets committed, the tolerance note is stale and the loader's absent
      // branch is dead code that hides real regressions.
      const tracked = execFileSync("git", ["ls-files", "--", input], {
        cwd: ROOT,
        encoding: "utf8",
      }).trim();
      assert.equal(
        tracked,
        "",
        `${loader}: ${input} is declared gitignored-and-tolerated but git tracks it — remove it from TOLERATED_GITIGNORED_INPUTS (a tracked input going missing SHOULD throw)`,
      );
    }
  }
});

// The behavioral half of T6.1a: the declaration promises an absent-tolerant
// branch; this keeps that promise checkable at the source level. For each
// tolerated loader, resolve its entry file from the package.json script, find
// the path constant carrying the declared input, and assert the guard on that
// constant is SKIP-shaped: `if (!existsSync(CONST))` whose block reaches a
// `return` without a `throw`. That is exactly the revert-to-throw regression
// that produced the T1b interim exclusions — a file-level `includes()` grep
// false-passed on it (the throwing versions also contain "existsSync" and the
// basename), which is why this is shape-matched rather than substring-matched.
test("every tolerated gitignored input has a skip-shaped existsSync guard in its loader", () => {
  for (const [loader, inputs] of Object.entries(TOLERATED_GITIGNORED_INPUTS)) {
    const script = pkg.scripts[loader];
    const entry = /(?:^|\s)tsx (\S+\.ts)/.exec(script)?.[1];
    assert.ok(
      entry,
      `${loader}: cannot resolve a tsx entry file from "${script}"`,
    );
    const src = readFileSync(path.join(ROOT, entry!), "utf8");
    for (const input of inputs) {
      // Directory inputs have uselessly short basenames ("fts") — pin the last
      // two segments instead so the staleness check stays meaningful.
      const needle = /\.[a-z0-9]+$/.test(input)
        ? path.basename(input)
        : input.split("/").slice(-2).join("/");
      assert.ok(
        src.includes(needle),
        `${loader}: ${entry} never references its declared input ${needle} — the TOLERATED_GITIGNORED_INPUTS entry is stale`,
      );
      // The constant the path is bound to, e.g. `const JSON_FILE = …"activities.json"…`.
      const constName = new RegExp(
        `const (\\w+) = [^;]*${needle.replace(/[./]/g, "\\$&")}`,
      ).exec(src)?.[1];
      assert.ok(
        constName,
        `${loader}: no path constant in ${entry} carries ${needle}`,
      );
      // The guard block on that constant, up to its terminating return. For the
      // nzok loaders this is the main() skip branch (`return;`); for the
      // ngo-funding FTS directory it is parseFts's `return [];`.
      // Boundary anchor rather than a full `))`: the guard may be compound
      // (`!existsSync(X) || readdirSync(X).length === 0`), but the identifier
      // must still end there — a longer constant sharing the prefix must not
      // satisfy the assertion.
      const guard = new RegExp(
        `if \\(!existsSync\\(${constName}(?:\\)| ?\\|\\|)[\\s\\S]{0,900}?return`,
      ).exec(src)?.[0];
      assert.ok(
        guard,
        `${loader}: ${entry} has no \`if (!existsSync(${constName})) … return\` guard — the absent-input branch is gone`,
      );
      assert.ok(
        !/throw /.test(guard),
        `${loader}: the absent branch for ${constName} in ${entry} throws — that aborts the &&-chained db:refresh on a fresh clone (gaps plan T1.0)`,
      );
    }
  }
});
