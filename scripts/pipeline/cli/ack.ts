// pnpm run pipeline:ack <handler> <operator-step> — record that a human did
// what an operator item asked (the manual download, the hand edit).
//
// The ack is timestamped and covers only source changes that happened BEFORE
// it: the next release of the same source asks again (planner.ts).
//
//   pnpm run pipeline:ack update-defense defense-readiness-read
//   pnpm run pipeline:ack --list

import fs from "node:fs";
import path from "node:path";
import { HANDLERS } from "../registry";
import { ACKS_FILE, REPO } from "../state";

const args = process.argv.slice(2);
const read = (): Record<string, string> =>
  fs.existsSync(ACKS_FILE)
    ? (JSON.parse(fs.readFileSync(ACKS_FILE, "utf8")) as Record<string, string>)
    : {};

if (args[0] === "--list") {
  for (const [k, v] of Object.entries(read()).sort()) console.log(`${v}  ${k}`);
  process.exit(0);
}
const [handler, step] = args;
if (!handler || !step || args.length !== 2) {
  console.error("usage: pipeline:ack <handler> <operator-step> | --list");
  process.exit(2);
}
const h = HANDLERS.find((x) => x.id === handler);
if (!h) {
  console.error(`pipeline:ack: unknown handler ${handler}`);
  process.exit(2);
}
// A missing marker is not acknowledged — it is decided:
// `pipeline:ingest --only <handler> --bootstrap run|seed`.
if (step === "bootstrap") {
  console.error(
    `pipeline:ack: a bootstrap is decided, not acknowledged — run \`pnpm run pipeline:ingest --only ${handler} --bootstrap run\` (or \`seed\`)`,
  );
  process.exit(2);
}
const known = (h.operator ?? []).map((o) => o.id);
if (!known.includes(step)) {
  console.error(
    `pipeline:ack: ${handler} has no operator step ${step}; it has: ${known.join(", ") || "none"}`,
  );
  process.exit(2);
}
const acks = read();
acks[`${handler}:${step}`] = new Date().toISOString();
fs.mkdirSync(path.dirname(ACKS_FILE), { recursive: true });
fs.writeFileSync(
  ACKS_FILE,
  JSON.stringify(Object.fromEntries(Object.entries(acks).sort()), null, 2) +
    "\n",
);
console.log(
  `acknowledged ${handler}:${step} → ${path.relative(REPO, ACKS_FILE)} (commit it with the run, or let the next pipeline run commit it)`,
);
