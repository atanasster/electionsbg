// pnpm run pipeline:doctor — check what this machine can run right now.
//
//   pnpm run pipeline:doctor
//   pnpm run pipeline:doctor --json
//   pnpm run pipeline:doctor --require pg-local,egress:non-bg   # exit 3 if unmet
//
// Exit 0 otherwise: an unmet need is not an error on its own — the planner
// blocks only the handlers that need it. Exit 2 on bad arguments, which are
// rejected BEFORE the machine is probed, so a bad call prints no report.

import { parseArgs } from "node:util";
import { renderDoctor, runDoctor } from "../doctor";
import { NEEDS, type Need } from "../registry";

const die = (msg: string): never => {
  console.error(`pipeline:doctor: ${msg}`);
  process.exit(2);
};

const parse = (): { json?: boolean; require?: string } => {
  try {
    return parseArgs({
      args: process.argv.slice(2),
      strict: true,
      allowPositionals: false,
      options: { json: { type: "boolean" }, require: { type: "string" } },
    }).values;
  } catch (e) {
    return die(e instanceof Error ? e.message : String(e));
  }
};
const values = parse();

const isNeed = (s: string): s is Need =>
  (NEEDS as readonly string[]).includes(s);
const requested = (values.require ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const unknown = requested.filter((n) => !isNeed(n));
if (unknown.length)
  die(
    `--require names unknown need(s): ${unknown.join(", ")} (known: ${NEEDS.join(", ")})`,
  );
const required = requested.filter(isNeed);

const result = await runDoctor();
process.stdout.write(
  values.json
    ? JSON.stringify(
        { ...result, unmet: Object.fromEntries(result.unmet) },
        null,
        2,
      ) + "\n"
    : renderDoctor(result),
);

const missing = required.filter((n) => result.unmet.has(n));
if (missing.length) {
  console.error(
    `pipeline:doctor: required need(s) unmet: ${missing.join(", ")}`,
  );
  process.exit(3);
}
