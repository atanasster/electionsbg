// pnpm run pipeline:shadow — compare the planner with past LLM-orchestrated runs.
//
//   pnpm run pipeline:shadow                    # the last 5 sessions
//   pnpm run pipeline:shadow --last 10
//   pnpm run pipeline:shadow --session 20261107T024133Z-6aa7
//   pnpm run pipeline:shadow --json
//
// Report-only, always exit 0 on a completed comparison: a difference is a
// question for a human, not a failure.

import { parseArgs } from "node:util";
import {
  readSessions,
  renderShadow,
  shadowSession,
  type ShadowResult,
} from "../shadow";

const die = (msg: string): never => {
  console.error(`pipeline:shadow: ${msg}`);
  process.exit(2);
};

const parse = (): { last?: string; session?: string; json?: boolean } => {
  try {
    return parseArgs({
      args: process.argv.slice(2),
      strict: true,
      allowPositionals: false,
      options: {
        last: { type: "string" },
        session: { type: "string" },
        json: { type: "boolean" },
      },
    }).values;
  } catch (e) {
    return die(e instanceof Error ? e.message : String(e));
  }
};
const values = parse();
const last = Number(values.last ?? "5");
if (!Number.isInteger(last) || last < 1)
  die(`--last must be a positive integer (got ${values.last})`);

const sessions = readSessions();
const ids = values.session
  ? [values.session]
  : [...sessions.keys()].slice(-last);
const missing = ids.filter((id) => !sessions.has(id));
if (missing.length) die(`no such session in the trace: ${missing.join(", ")}`);

const results: ShadowResult[] = [];
const skipped: string[] = [];
for (const id of ids) {
  const r = shadowSession(id, sessions.get(id) ?? []);
  if (r) results.push(r);
  else skipped.push(id);
}

if (values.json) {
  process.stdout.write(JSON.stringify({ results, skipped }, null, 2) + "\n");
} else {
  const total = (k: "agree" | "plannedOnly" | "ranOnly"): number =>
    results.reduce((n, r) => n + r[k].length, 0);
  process.stdout.write(
    [
      `# Planner shadow vs ${results.length} recorded session(s)`,
      `agree ${total("agree")} · planned-not-run ${total("plannedOnly")} · run-not-planned ${total("ranOnly")}`,
      "",
      ...results.map(renderShadow),
      ...(skipped.length
        ? [
            "",
            `Skipped (no start time or no commit before it): ${skipped.join(", ")}`,
          ]
        : []),
    ].join("\n") + "\n",
  );
}
