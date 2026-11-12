// Argument parsing for pipeline:ingest, kept out of the CLI so it is testable
// (the CLI runs on import).

import { parseArgs } from "node:util";
import type { BootstrapPolicy } from "./planner";
import { HANDLERS } from "./registry";

export const parseIngestArgs = (
  args: string[],
): {
  only?: Set<string>;
  bootstrap: BootstrapPolicy;
  publish: boolean;
  dryRun: boolean;
  noCommit: boolean;
} => {
  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      only: { type: "string" },
      bootstrap: { type: "string" },
      publish: { type: "boolean" },
      "dry-run": { type: "boolean" },
      "no-commit": { type: "boolean" },
    },
  });
  const bootstrap = (values.bootstrap ?? "ask") as BootstrapPolicy;
  if (!["run", "seed", "ask"].includes(bootstrap))
    throw new Error(`--bootstrap must be run, seed or ask (got ${bootstrap})`);
  const only = values.only
    ? new Set(
        values.only
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      )
    : undefined;
  const unknown = [...(only ?? [])].filter(
    (id) => !HANDLERS.some((h) => h.id === id),
  );
  if (unknown.length)
    throw new Error(`--only names unknown handler(s): ${unknown.join(", ")}`);
  return {
    only,
    bootstrap,
    publish: values.publish ?? false,
    dryRun: values["dry-run"] ?? false,
    noCommit: values["no-commit"] ?? false,
  };
};
