// pnpm run pipeline:ingest — run every due handler, then the post-steps,
// commit, write the upload manifest, and report.
//
//   pnpm run pipeline:ingest                       # due handlers, no publish
//   pnpm run pipeline:ingest --publish             # publish too if the gate passes
//   pnpm run pipeline:ingest --only update-prices
//   pnpm run pipeline:ingest --only X --bootstrap run|seed
//   pnpm run pipeline:ingest --dry-run             # = pipeline:plan --doctor
//   pnpm run pipeline:ingest --no-commit           # local experiment
//
// Exit: 0 clean or degraded (operator/agent items only) · 1 a handler or
// post-step failed · 2 bad arguments · 3 another run holds the lock ·
// 4 ingest ok but the publish was held or failed.

import fs from "node:fs";
import path from "node:path";
import { monitorFor } from "../exec/monitor";
import { newSessionId } from "../../perf/perf_log";
import { runIngest } from "../ingest";
import { logDir } from "../report/record";
import { realIngestDeps } from "../ingest_wiring";
import { LockHeldError } from "../lock";
import { parseIngestArgs } from "../ingest_args";
import { renderPlan } from "../render_plan";
import { REPO } from "../state";

const die = (msg: string, code = 2): never => {
  console.error(`pipeline:ingest: ${msg}`);
  process.exit(code);
};

const main = async (): Promise<void> => {
  let args: ReturnType<typeof parseIngestArgs>;
  try {
    args = parseIngestArgs(process.argv.slice(2));
  } catch (e) {
    return die(e instanceof Error ? e.message : String(e));
  }
  const scripts = (
    JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    }
  ).scripts;
  const session = newSessionId();
  // Orchestrator lines go to the same run.log as the steps' start/end lines,
  // so `tail -f logs/pipeline/<session>/run.log` is the whole run in order.
  const log = args.dryRun
    ? (l: string) => console.log(l)
    : (l: string) => monitorFor(session, logDir(session)).line(l);
  if (!args.dryRun)
    console.log(
      `Live: tail -f ${path.relative(REPO, logDir(session))}/run.log (status.json beside it)`,
    );
  try {
    const out = await runIngest(realIngestDeps(scripts, log), {
      ...args,
      session,
    });
    if (args.dryRun) process.stdout.write(renderPlan(out.plan));
    if (out.report) log(`Report: ${path.relative(REPO, out.report)}`);
    if (!args.dryRun)
      monitorFor(session, logDir(session)).close(
        `ingest finished — exit ${out.exitCode}`,
      );
    process.exit(out.exitCode);
  } catch (e) {
    if (e instanceof LockHeldError) die(e.message, 3);
    throw e;
  }
};

await main();
