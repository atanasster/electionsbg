// pnpm run pipeline:plan — print what an ingest run would do, and why.
// Read-only: it never runs, stamps or writes anything except `--out`.
//
//   pnpm run pipeline:plan
//   pnpm run pipeline:plan --json                 # the Plan object on stdout
//   pnpm run pipeline:plan --out <file>           # also write the JSON there
//   pnpm run pipeline:plan --only update-macro,update-prices
//   pnpm run pipeline:plan --bootstrap run|seed|ask   (default ask)

import fs from "node:fs";
import { parseArgs } from "node:util";
import { plan, type BootstrapPolicy } from "../planner";
import { HANDLERS, UNROUTED } from "../registry";
import { renderPlan } from "../render_plan";
import { loadState } from "../state";

const die = (msg: string): never => {
  console.error(`pipeline:plan: ${msg}`);
  process.exit(2);
};

const parse = (): {
  json?: boolean;
  out?: string;
  only?: string;
  bootstrap?: string;
} => {
  try {
    // strict: an unknown flag, a missing value (`--only` at the end) or a flag
    // used as a value (`--out --json`) is an error, never a silent default.
    return parseArgs({
      args: process.argv.slice(2),
      strict: true,
      allowPositionals: false,
      options: {
        json: { type: "boolean" },
        out: { type: "string" },
        only: { type: "string" },
        bootstrap: { type: "string" },
      },
    }).values;
  } catch (e) {
    return die(e instanceof Error ? e.message : String(e));
  }
};
const values = parse();

const bootstrap = (values.bootstrap ?? "ask") as BootstrapPolicy;
if (!["run", "seed", "ask"].includes(bootstrap))
  die(`--bootstrap must be run, seed or ask (got ${bootstrap})`);
if (values.out !== undefined && values.out.startsWith("-"))
  die(`--out needs a file path (got ${values.out})`);

const onlySet = values.only
  ? new Set(
      values.only
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    )
  : undefined;
const unknown = [...(onlySet ?? [])].filter(
  (id) => !HANDLERS.some((h) => h.id === id),
);
if (unknown.length)
  die(`--only names unknown handler(s): ${unknown.join(", ")}`);

const state = loadState();
const p = plan({
  handlers: HANDLERS,
  watch: state.watch,
  ingest: state.ingest,
  acks: state.acks,
  now: new Date(),
  bootstrap,
  only: onlySet,
  exemptUnrouted: new Set(Object.keys(UNROUTED)),
  inputErrors: state.errors,
});
if (values.out) fs.writeFileSync(values.out, JSON.stringify(p, null, 2) + "\n");

process.stdout.write(
  values.json ? JSON.stringify(p, null, 2) + "\n" : renderPlan(p),
);
