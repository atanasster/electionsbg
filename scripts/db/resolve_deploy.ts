// Resolver-driven deploy emission (docs/plans/cloud-deploy-speed-v1.md §v2-e, part 1).
//
// A thin CLI over resolveDeploySet: given the base datasets that changed this publish,
// print the MINIMAL, ORDERED list of Cloud SQL publish commands. This turns the v2-d
// resolver into something the process-watch-report operator (or an agent following the
// skill) can RUN, rather than reading a hand-maintained Step-8 table by eye.
//
//   npm run deploy:resolve -- contracts tenders
//   npm run deploy:resolve -- tr_companies
//
// SCOPE. This is the NON-invasive half of v2-e: it computes and prints the commands.
// It does NOT run them and does NOT touch the loaders — the per-loader double-refresh
// suppression (the invasive half) is deferred (its win shrank to ~5 min of a 24-min
// publish once the instance was upgraded; see §v2-e / §v2.1). Today it is a cross-check
// tool beside the hand-maintained Step-8 table, not a replacement for it.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveDeploySet } from "./lib/deployResolver";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/** The npm scripts that exist, so we can tell a loader with a `:cloud` publish from an
 *  artifact generator (db:gen-*) that ships a committed file via bucket:sync instead. */
export const cloudScripts = (): Set<string> => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
  ) as { scripts: Record<string, string> };
  return new Set(Object.keys(pkg.scripts));
};

export interface DeployCommands {
  /** ordered `npm run <loader>:cloud` lines — the actual publish */
  commands: string[];
  /** advisories: committed artifacts to regenerate+sync, manual loads owed, cycles */
  notes: string[];
}

/** Loaders whose `:cloud` wrapper is a no-op or an error WITHOUT a flag, so a bare
 *  `npm run <loader>:cloud` would silently publish nothing. Bake the flag in. */
const REQUIRED_FLAGS: Record<string, string> = {
  "kzk:rejoin": "-- --apply", // dry-run (silent no-op) without it
  "db:load:funds:pg": "-- --full", // exits 1 without a scope flag; --full = re-ingest
};

/** Loaders that need a documented FOLLOW-UP beyond the single emitted command. */
const FOLLOWUP_NOTES: Record<string, string> = {
  "db:load:funds:pg":
    "verify --full (re-ingest, beneficiaries/projects moved) vs --payloads-only " +
    "(only payloads changed) — see update-funds",
  "db:load:declarations:pg":
    "declarations is two-phase — follow with " +
    "`npm run db:load:declarations:pg:cloud -- --resolve`",
};

/** Parse the changed-table names out of argv (dropping any -flags). */
export const parseChanged = (argv: readonly string[]): string[] =>
  argv.filter((a) => !a.startsWith("-"));

/**
 * Turn a set of changed base datasets into the ordered publish commands + advisories.
 *
 * @param changed base table names reloaded this publish.
 * @param scripts the set of defined npm scripts (injectable for tests).
 */
export const deployCommands = (
  changed: readonly string[],
  scripts: Set<string> = cloudScripts(),
): DeployCommands => {
  const plan = resolveDeploySet(changed);
  const commands: string[] = [];
  const notes: string[] = [];
  for (const loader of plan.loaders) {
    if (scripts.has(`${loader}:cloud`)) {
      const flag = REQUIRED_FLAGS[loader];
      commands.push(`npm run ${loader}:cloud${flag ? ` ${flag}` : ""}`);
      if (FOLLOWUP_NOTES[loader])
        notes.push(`# ${loader}: ${FOLLOWUP_NOTES[loader]}`);
    } else {
      // no :cloud publish — the two db:gen-* generators write a COMMITTED artifact
      // (hub_stats.json / sector_stats.json) that reaches prod via bucket:sync.
      notes.push(
        `# ${loader}: no :cloud publish — regenerate the committed artifact locally, ` +
          `commit, then bucket:sync`,
      );
    }
  }
  for (const t of plan.unmappedChanges)
    // A changed table with no base loader. If it cascaded (objects were emitted), its
    // base load is a manual crawl (e.g. kzk_appeals). If it cascaded to nothing, it is
    // simply not modelled in the deploy registry and is published by its own skill
    // (e.g. prices). One note covers both so the wording is never false.
    notes.push(
      `# ${t}: no loader in the deploy registry — if it cascades, its downstream is ` +
        `emitted above and only the base load is manual (a crawl); if not, it is ` +
        `published by its own skill (e.g. prices)`,
    );
  if (plan.cyclic)
    notes.push(
      `# WARNING: the dependency graph had a cycle — the order above may be ` +
        `incomplete; verify before running`,
    );
  return { commands, notes };
};

const main = (): void => {
  const changed = parseChanged(process.argv.slice(2));
  if (changed.length === 0) {
    console.error(
      "usage: npm run deploy:resolve -- <changed-table> [<changed-table> …]\n" +
        "  e.g. npm run deploy:resolve -- contracts tenders",
    );
    process.exit(1);
  }
  const { commands, notes } = deployCommands(changed);
  if (commands.length === 0 && notes.length === 0) {
    console.log(
      "# nothing to publish — no served object depends on those datasets",
    );
    return;
  }
  for (const c of commands) console.log(c);
  if (notes.length) {
    console.log("");
    for (const n of notes) console.log(n);
  }
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
