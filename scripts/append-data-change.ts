// CLI: append a new entry to data/data-changes.json. Invoked by
// /process-watch-report after each successful stamp-ingest call so the SPA's
// /data-changes page can show "what changed on which date".
//
// Usage:
//   npx tsx scripts/append-data-change.ts <skill-name> \
//     --summary "<one-line recap>" \
//     [--source "<upstream label>"] \
//     [--at <iso>]
//
// Examples:
//   npx tsx scripts/append-data-change.ts update-macro \
//     --summary "22 indicators refreshed; 7 series got new releases through 2026 Q1" \
//     --source "Eurostat macro (BG)"
//
// Idempotent across re-runs at the same timestamp (it does NOT dedupe, but
// stamp-ingest runs ~once per skill per orchestrator run, so collisions are
// unexpected). On collision the latest entry wins for the date grouping.

import { command, run, option, optional, string, positional } from "cmd-ts";
import { appendDataChange, isNoChangeSummary } from "./lib/data-changes";

const cli = command({
  name: "append-data-change",
  description: "Append a row to data/data-changes.json",
  args: {
    skill: positional({
      type: string,
      displayName: "skill",
      description: "Skill name, e.g. update-macro",
    }),
    summary: option({
      type: string,
      long: "summary",
      description: "One-line recap of what was ingested",
    }),
    source: option({
      type: optional(string),
      long: "source",
      description: "Upstream label, e.g. 'Eurostat macro (BG)'",
    }),
    at: option({
      type: optional(string),
      long: "at",
      description: "Override the timestamp (ISO UTC). Default: now.",
    }),
  },
  handler: (args) => {
    if (isNoChangeSummary(args.summary)) {
      console.log(
        `· skipped ${args.skill} — summary describes a no-op (bootstrap / unchanged / fetchedAt-only). Nothing appended.`,
      );
      return;
    }
    const entry = appendDataChange({
      skill: args.skill,
      summary: args.summary,
      source: args.source,
      at: args.at,
    });
    console.log(
      `✓ appended ${entry.skill} @ ${entry.timestamp} — ${entry.summary}`,
    );
  },
});

run(cli, process.argv.slice(2));
