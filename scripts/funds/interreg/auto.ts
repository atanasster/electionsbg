// The unattended Interreg refresh: crawl keep.eu, then ingest — one pipeline
// step, so a crawl that keep.eu refuses never reaches the ingest.
//
//   pnpm run funds:interreg-auto
//
// The crawl runs with `--auto` (crawl.ts → autoFullReason): incremental by
// default, escalating to the ~2 h `--full` walk only when the last full walk
// is older than FULL_WALK_MAX_AGE_DAYS or did not complete. Both modes are
// resumable, so a run killed at its timeout costs one wave, not the walk.
//
// Exit codes, read by the pipeline handler (update-funds):
//   0 — crawled and ingested;
//   3 — the CRAWL failed (keep.eu down, rate-limited, pages unrecovered). The
//       ingest is NOT run, so the committed corpus stays on its previous,
//       complete vintage; the handler turns this into an operator item without
//       holding the night's publish, and the next run retries (an incomplete
//       manifest makes --auto pick a full walk).
//   anything else — the INGEST failed: a real defect, which must hold the
//       publish like any other failed step.

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CRAWL_FAILED_EXIT = 3;

const here = path.dirname(fileURLToPath(import.meta.url));
const tsx = (script: string, args: string[] = []): number => {
  const r = spawnSync(
    "pnpm",
    ["exec", "tsx", path.join(here, script), ...args],
    { stdio: "inherit" },
  );
  return r.status ?? 1;
};

const main = (): number => {
  const crawl = tsx("crawl.ts", ["--auto"]);
  if (crawl !== 0) {
    console.error(
      `interreg-auto: the keep.eu crawl exited ${crawl} — ingest skipped, the ` +
        "committed corpus is unchanged. Probe with `pnpm run funds:crawl-interreg " +
        "--index-only --max-pages 1`; the next run retries with a full walk.",
    );
    return CRAWL_FAILED_EXIT;
  }
  return tsx("ingest.ts");
};

process.exitCode = main();
