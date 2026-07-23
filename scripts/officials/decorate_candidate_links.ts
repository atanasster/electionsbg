// CLI wrapper around ./candidate_links.ts.
//
//   npx tsx scripts/officials/decorate_candidate_links.ts [--dry-run]
//
// The work itself lives in ./candidate_links.ts so scripts/officials/municipal.ts
// can chain it in-process without this `run(...)` firing on import.

import { command, run, flag, boolean } from "cmd-ts";
import { decorateCandidateLinks } from "./candidate_links";

const cli = command({
  name: "decorate-candidate-links",
  description:
    "Decorate data/officials/municipal/by_obshtina/<obshtina>.json shards with a `candidateLink` field per entry, joining cacbg roster rows to the most recent local-election slate (party, listPos, prefVotes, isElected) and to the parliament MP index (photo URL where the councillor also served in NS).",
  args: {
    dryRun: flag({
      type: boolean,
      long: "dry-run",
      description:
        "Report eligible-entry counts without writing the shards back.",
    }),
  },
  handler: ({ dryRun }) => decorateCandidateLinks(dryRun),
});

run(cli, process.argv.slice(2));
