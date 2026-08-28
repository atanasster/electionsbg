// CLI: run a package.json `&&`-chain script one link at a time, timing each.
//
//   npm run perf:chain -- db:refresh --run process-watch-report --session "$S"
//
// `db:refresh` is a ~70-link chain and `tr:daily-refresh` is a 7-link one.
// Wrapping the whole thing in `perf:step run` yields ONE number, which answers
// "was it slow" and nothing about WHERE — and "where" is the entire question
// when the chain is an hour long. This expands the chain from package.json and
// runs each link as its own timed step, so the trace names the link.
//
// Semantics are preserved exactly: links run in order, sequentially, and the
// first non-zero exit aborts the rest — which is what `&&` does. The chain text
// is READ FROM package.json rather than restated here, so it cannot drift from
// what `npm run db:refresh` would have done.
//
// One level only: a link that is itself a chain (`npm run tr:daily-refresh`
// inside another chain) is timed as one step. Expand it with its own
// `perf:chain` call when that is the level you need.

import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { splitChain, stepName } from "./chain";
import { appendStep, formatDuration, newSessionId } from "./perf_log";

const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const die = (msg: string): never => {
  console.error(`perf:chain: ${msg}`);
  process.exit(2);
};

const argv = process.argv.slice(2);
const scriptName = argv.find((a) => !a.startsWith("--"));
if (!scriptName)
  die("name a package.json script, e.g. `perf:chain -- db:refresh`");

const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  if (i !== -1) return argv[i + 1];
  return argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
};

const pkg = JSON.parse(
  fs.readFileSync(path.join(REPO, "package.json"), "utf8"),
) as { scripts: Record<string, string> };
const script = pkg.scripts[scriptName!];
if (!script) die(`no package.json script named ${scriptName}`);

let links: string[];
try {
  links = splitChain(script);
} catch (err) {
  die((err as Error).message);
  throw err; // unreachable — die() exits; keeps TS's control flow honest.
}
const run = flag("run") ?? "process-watch-report";
const session = flag("session") ?? newSessionId();
const phase = flag("phase") ?? scriptName!;
const dryRun = argv.includes("--dry-run");
const seqBase = Number(flag("seq-base") ?? 0);

console.log(
  `perf:chain ${scriptName} — ${links.length} link(s), session ${session}${dryRun ? " (dry run)" : ""}`,
);
if (dryRun) {
  links.forEach((l, i) =>
    console.log(`  ${String(i + 1).padStart(2)}. ${stepName(l)}`),
  );
  process.exit(0);
}

let failed = 0;
const t0Chain = Date.now();
for (const [i, link] of links.entries()) {
  const label = stepName(link);
  console.log(`\n── [${i + 1}/${links.length}] ${label}`);
  const startedAt = new Date();
  const t0 = Date.now();
  // `sh -c` because a link is shell text (it can carry `VAR=x cmd`, `--` args
  // and redirections) — the same interpreter `npm run` hands the script to.
  const res = spawnSync("sh", ["-c", link], { stdio: "inherit", cwd: REPO });
  const durationMs = Date.now() - t0;
  const exitCode = res.status ?? (res.error ? 1 : 0);
  appendStep({
    ts: new Date().toISOString(),
    run,
    session,
    seq: seqBase + i + 1,
    step: label,
    phase,
    command: link,
    startedAt: startedAt.toISOString(),
    durationMs,
    status: exitCode === 0 ? "ok" : "error",
    exitCode,
  });
  console.log(
    `   ⏱  ${label} — ${formatDuration(durationMs)}${exitCode === 0 ? "" : ` [exit ${exitCode}]`}`,
  );
  if (exitCode !== 0) {
    failed = exitCode;
    console.error(
      `\nperf:chain: ${label} exited ${exitCode} — aborting the remaining ${links.length - i - 1} link(s), as \`&&\` would.`,
    );
    break;
  }
}

// The chain total is recorded as its own row so a session summary can report
// "db:refresh took X" without re-summing links — and so the two can be compared
// (their difference is this runner's own overhead, which should stay ~0).
appendStep({
  ts: new Date().toISOString(),
  run,
  session,
  seq: seqBase + links.length + 1,
  step: `${scriptName} (whole chain)`,
  phase,
  command: `npm run ${scriptName}`,
  startedAt: new Date(t0Chain).toISOString(),
  durationMs: Date.now() - t0Chain,
  status: failed ? "error" : "ok",
  exitCode: failed,
});
console.log(
  `\nperf:chain ${scriptName} — total ${formatDuration(Date.now() - t0Chain)}${failed ? ` [FAILED]` : ""}`,
);
process.exit(failed);
