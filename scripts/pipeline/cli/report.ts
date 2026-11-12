// pnpm run pipeline:report — print a run's report (default: the latest).
//
//   pnpm run pipeline:report
//   pnpm run pipeline:report --session 20261112T001348Z-51f9
//   pnpm run pipeline:report --json            # run.json instead
//   pnpm run pipeline:report --list            # recent runs, one line each

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { readRecord, RUNS_DIR } from "../report/record";

const fail = (msg: string): never => {
  console.error(`pipeline:report: ${msg}`);
  process.exit(2);
};

const parse = (): { session?: string; json?: boolean; list?: boolean } => {
  try {
    return parseArgs({
      args: process.argv.slice(2),
      strict: true,
      allowPositionals: false,
      options: {
        session: { type: "string" },
        json: { type: "boolean" },
        list: { type: "boolean" },
      },
    }).values;
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
};
const values = parse();

const sessions = fs.existsSync(RUNS_DIR)
  ? fs
      .readdirSync(RUNS_DIR)
      .filter((d) => fs.existsSync(path.join(RUNS_DIR, d, "run.json")))
      .sort()
  : [];

if (values.list) {
  for (const s of sessions.slice(-20)) {
    const r = readRecord(s);
    console.log(
      `${s}  ${r.kind.padEnd(7)} ${(r.verdict ?? "unfinished").padEnd(9)} exit ${r.exitCode ?? "?"}  ${r.units.length} unit(s)`,
    );
  }
  process.exit(0);
}

const session = values.session ?? sessions.at(-1);
if (!session) fail("no pipeline runs recorded yet");
const dir = path.join(RUNS_DIR, session as string);
if (!fs.existsSync(dir)) fail(`no run ${session}`);
process.stdout.write(
  fs.readFileSync(
    path.join(dir, values.json ? "run.json" : "report.md"),
    "utf8",
  ),
);
