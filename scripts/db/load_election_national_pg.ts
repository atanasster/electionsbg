// Load committed CIK-derived national summaries into migration 195's normalized
// election tables. The loader is idempotent and replaces the snapshot inside a
// transaction without exposing a half-loaded corpus.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { copyRows } from "./lib/copy";
import { end, exec, withClient } from "./lib/pg";
import { readNationalElectionSources } from "./election_national_source";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const SCHEMA = path.join(
  ROOT,
  "scripts/db/schema/pg/195_election_national_results.sql",
);

const run = async () => {
  await exec(readFileSync(SCHEMA, "utf8"));
  const { contests, results } = readNationalElectionSources(
    path.join(ROOT, "data"),
  );
  if (!contests.length || !results.length)
    throw new Error("No national election summaries found");

  await withClient(async (client) => {
    await client.query("BEGIN");
    await client.query(
      "CREATE TEMP TABLE election_contest_stage (LIKE election_contest INCLUDING ALL) ON COMMIT DROP",
    );
    await client.query(
      "CREATE TEMP TABLE election_national_result_stage (LIKE election_national_result INCLUDING ALL) ON COMMIT DROP",
    );
    await copyRows(
      client,
      "election_contest_stage",
      [
        "contest_id",
        "contest_key",
        "election_type",
        "result_grain",
        "election_date",
        "cycle_year",
        "round",
        "registered_voters",
        "actual_voters",
        "pct_denominator_votes",
        "none_of_above_votes",
        "invalid_votes",
        "percentage_basis",
        "source_path",
        "source_sha256",
        "granular_source_path",
        "granular_sha256",
        "granular_reconciled",
      ],
      contests.map((contest) => [
        contest.contestId,
        contest.contestKey,
        contest.electionType,
        contest.resultGrain,
        contest.electionDate,
        contest.cycleYear,
        contest.round,
        contest.registeredVoters,
        contest.actualVoters,
        contest.pctDenominatorVotes,
        contest.noneOfAboveVotes,
        contest.invalidVotes,
        contest.percentageBasis,
        contest.sourcePath,
        contest.sourceSha256,
        contest.granularSourcePath,
        contest.granularSha256,
        contest.granularReconciled,
      ]),
    );
    await copyRows(
      client,
      "election_national_result_stage",
      [
        "contest_id",
        "result_grain",
        "choice_key",
        "choice_kind",
        "choice_number",
        "canonical_party_id",
        "president_name",
        "vice_president_name",
        "choice_name",
        "choice_short",
        "votes",
        "pct",
        "seats",
        "passed_threshold",
      ],
      results.map((result) => [
        result.contestId,
        result.resultGrain,
        result.choiceKey,
        result.choiceKind,
        result.choiceNumber,
        result.canonicalPartyId,
        result.presidentName,
        result.vicePresidentName,
        result.choiceName,
        result.choiceShort,
        result.votes,
        result.pct,
        result.seats,
        result.passedThreshold,
      ]),
    );

    const incomplete = await client.query<{ contest_id: string }>(
      `SELECT c.contest_id
         FROM election_contest_stage c
         LEFT JOIN election_national_result_stage r USING (contest_id)
        GROUP BY c.contest_id
       HAVING count(r.choice_key) = 0`,
    );
    if (incomplete.rows.length)
      throw new Error(
        `Election contests without choices: ${incomplete.rows.map((row) => row.contest_id).join(", ")}`,
      );

    await client.query("DELETE FROM election_national_result");
    await client.query("DELETE FROM election_contest");
    await client.query(
      "INSERT INTO election_contest SELECT * FROM election_contest_stage",
    );
    await client.query(
      "INSERT INTO election_national_result SELECT * FROM election_national_result_stage",
    );
    await client.query("COMMIT");
  });
  console.log(
    `election national results: ${contests.length} contests, ${results.length} choices`,
  );
  await end();
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
