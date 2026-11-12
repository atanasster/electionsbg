// pnpm run pipeline:nightly — the whole unattended chain: watcher → ingest →
// publish (only when the ingest's publish gate passes).
//
// The watcher runs through the same executor as every other step, so its
// log, timing and failure class land in the same run folder. A watcher that
// crashes outright (exit 2) stops the night: planning on half-written state
// would ingest a guess. Per-source watcher errors are not a crash — they are
// in the watcher's own report and the ingest runs on what it has.
//
// Exit codes are the ingest's (see cli/ingest.ts), plus 5 when the watcher
// itself crashed.

import fs from "node:fs";
import path from "node:path";
import { newSessionId } from "../../perf/perf_log";
import { runStep } from "../exec/executor";
import { runIngest } from "../ingest";
import { realIngestDeps } from "../ingest_wiring";
import { acquireLock, LockHeldError } from "../lock";
import { logDir } from "../report/record";
import { REPO } from "../state";

const scripts = (
  JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  }
).scripts;

const session = newSessionId();
// Held across the watcher too: a second nightly started while this one's
// watcher runs must not plan on half-written watcher state.
let held: ReturnType<typeof acquireLock>;
try {
  held = acquireLock(session);
} catch (e) {
  if (e instanceof LockHeldError) {
    console.error(`pipeline:nightly: ${e.message}`);
    process.exit(3);
  }
  throw e;
}
process.once("exit", () => held.release());
let seq = 0;
const watch = await runStep(
  {
    id: "watch",
    run: "pnpm run watch",
    phase: "plan",
    timeoutMin: 120,
    db: "inherit",
  },
  {
    perfRun: "process-watch-report",
    session,
    logDir: logDir(session),
    nextSeq: () => ++seq,
  },
);
if (watch.status !== "ok") {
  console.error(
    `pipeline:nightly: the watcher failed (${watch.failure?.class}: ${watch.firstError ?? "no output"}) — log ${watch.log}. Nothing ingested.`,
  );
  process.exit(5);
}

try {
  const out = await runIngest(
    realIngestDeps(scripts, (l) => console.log(l)),
    {
      session,
      publish: true,
    },
  );
  if (out.report) console.log(`\nReport: ${path.relative(REPO, out.report)}`);
  process.exit(out.exitCode);
} catch (e) {
  if (e instanceof LockHeldError) {
    console.error(`pipeline:nightly: ${e.message}`);
    process.exit(3);
  }
  throw e;
}
