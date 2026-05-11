// CLI: stamp a per-skill ingest marker so the orchestrator knows this skill
// ran successfully and ingested everything up to "now". Invoked by
// /process-watch-report after each successful Skill call.
//
// Usage:
//   npx tsx scripts/stamp-ingest.ts <skill-name> [--summary "<text>"] [--at <iso>]
//
// Examples:
//   npx tsx scripts/stamp-ingest.ts update-rollcall
//   npx tsx scripts/stamp-ingest.ts update-financing --summary "15 years tracked, otcheti only"
//
// Idempotent: writes state/ingest/<skill>.json with the timestamp + optional
// summary. Output goes through writeIngestState's stable stringify so
// repeated runs at the same UTC second produce identical bytes.

import { command, run, option, optional, string, positional } from "cmd-ts";
import { writeIngestState } from "./lib/ingest-state";

const cli = command({
  name: "stamp-ingest",
  description: "Stamp state/ingest/<skill>.json with lastSuccessfulIngest=now",
  args: {
    skill: positional({
      type: string,
      displayName: "skill",
      description: "Skill name, e.g. update-rollcall",
    }),
    summary: option({
      type: optional(string),
      long: "summary",
      description: "Optional one-line recap of what this run did",
    }),
    at: option({
      type: optional(string),
      long: "at",
      description: "Override the timestamp (ISO UTC). Default: now.",
    }),
  },
  handler: (args) => {
    const state = writeIngestState(args.skill, {
      summary: args.summary,
      at: args.at,
    });
    console.log(
      `✓ stamped ${state.skill} at ${state.lastSuccessfulIngest}` +
        (state.summary ? ` — ${state.summary}` : ""),
    );
  },
});

run(cli, process.argv.slice(2));
