// pnpm run pipeline:publish — publish what the last ingest committed.
//
//   pnpm run pipeline:publish --dry-run            # print the plan, touch nothing
//   pnpm run pipeline:publish                      # asks before touching production
//   pnpm run pipeline:publish --yes                # unattended
//   pnpm run pipeline:publish --yes --start-at "db:load:graph:pg:cloud"
//   pnpm run pipeline:publish --yes --start-at "db:check-cloud"   # re-verify only
//
// --start-at takes any step id (bucket, cloud or verify) at which an earlier
// publish of the SAME manifest failed, timed out or was interrupted.
//
// Exit: 0 published (or nothing pending) · 1 a step failed (manifest kept)
//       · 2 bad arguments / not confirmed / refused · 3 blocked before anything ran.
// The run's report and repair packets are under state/pipeline/runs/<session>/.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { parseArgs } from "node:util";
import { LockHeldError } from "../lock";
import { realPublishDeps, runPublish } from "../publish";
import { REPO } from "../state";

const die = (msg: string, code = 2): never => {
  console.error(`pipeline:publish: ${msg}`);
  process.exit(code);
};

const parse = (): {
  "dry-run"?: boolean;
  yes?: boolean;
  "start-at"?: string;
} => {
  try {
    return parseArgs({
      args: process.argv.slice(2),
      strict: true,
      allowPositionals: false,
      options: {
        "dry-run": { type: "boolean" },
        yes: { type: "boolean" },
        "start-at": { type: "string" },
      },
    }).values;
  } catch (e) {
    return die(e instanceof Error ? e.message : String(e));
  }
};
const values = parse();
const scripts = (
  JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  }
).scripts;
const deps = realPublishDeps(scripts, (l) => console.log(l));

let expectDigest: string | undefined;
if (!values["dry-run"] && !values.yes) {
  const preview = await runPublish(deps, { dryRun: true });
  // Nothing pending, or blocked: the real run touches no production, so
  // there is nothing to confirm — let it write its report.
  if (preview.plan && preview.exitCode === 0) {
    if (!process.stdin.isTTY)
      die(
        "not a terminal and no --yes — refusing to touch production unconfirmed",
      );
    // Show what the bucket sync WOULD copy before asking (gsutil -n: read-only).
    const paths = preview.plan.manifest.paths;
    if (paths.length)
      spawnSync("pnpm", ["run", "-s", "bucket:sync:paths:dry", ...paths], {
        cwd: REPO,
        stdio: "inherit",
      });
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const answer = (
      await rl.question(`Proceed with publish ${preview.plan.digest}? [y/N] `)
    )
      .trim()
      .toLowerCase();
    rl.close();
    if (answer !== "y" && answer !== "yes")
      die("not confirmed — nothing published");
    // The run must publish exactly what was confirmed; a manifest merged
    // while the prompt waited is refused, not shipped.
    expectDigest = preview.plan.digest;
  }
}

try {
  const out = await runPublish(deps, {
    dryRun: values["dry-run"],
    startAt: values["start-at"],
    expectDigest,
  });
  if (out.report) console.log(`\nReport: ${path.relative(REPO, out.report)}`);
  process.exit(out.exitCode);
} catch (e) {
  if (e instanceof LockHeldError) die(e.message, 3);
  throw e;
}
