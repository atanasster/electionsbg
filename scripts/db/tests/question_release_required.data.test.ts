import { afterAll, describe, expect, it } from "vitest";
import { dbReachable, end, getPool, pinLocalDatabase } from "../lib/pg";

pinLocalDatabase();
const reachable = await dbReachable();

afterAll(async () => end());

describe("required question release database gate", () => {
  it("fails instead of skipping when the release job has no database", () => {
    if (process.env.REQUIRE_QUESTION_DB === "1") expect(reachable).toBe(true);
  });

  it.skipIf(!reachable)(
    "serves independent facts under the production timeout",
    async () => {
      const client = await getPool().connect();
      try {
        await client.query("BEGIN TRANSACTION READ ONLY");
        await client.query("SET LOCAL statement_timeout = '8s'");
        expect((await client.query("SHOW statement_timeout")).rows[0]).toEqual({
          statement_timeout: "8s",
        });
        const result = await client.query(`SELECT
        (SELECT count(*) FROM election_national_results('parliamentary', '2026_04_19', NULL))::text AS parliamentary,
        (SELECT count(DISTINCT choice_key) FROM election_national_results('parliamentary', '2026_04_19', NULL))::text AS distinct_choices,
        (SELECT choice_key FROM election_national_results('parliamentary', '2026_04_19', NULL) LIMIT 1) AS parliamentary_winner,
        (SELECT votes::text FROM election_national_results('parliamentary', '2026_04_19', NULL) LIMIT 1) AS parliamentary_votes,
        (SELECT seats FROM election_national_results('parliamentary', '2026_04_19', NULL) LIMIT 1) AS parliamentary_seats,
        (SELECT percentage_basis FROM election_national_results('parliamentary', '2026_04_19', NULL) LIMIT 1) AS parliamentary_basis,
        (SELECT none_of_above_votes::text FROM election_national_results('parliamentary', '2026_04_19', NULL) LIMIT 1) AS parliamentary_none,
        (SELECT invalid_votes::text FROM election_national_results('parliamentary', '2026_04_19', NULL) LIMIT 1) AS parliamentary_invalid,
        (SELECT source_sha256 FROM election_national_results('parliamentary', '2026_04_19', NULL) LIMIT 1) AS source_sha256,
        (SELECT count(*) FROM election_national_results('presidential', '2021_11_14_pvr', 2))::text AS presidential,
        (SELECT choice_key FROM election_national_results('presidential', '2021_11_14_pvr', 2) LIMIT 1) AS presidential_winner,
        (SELECT votes::text FROM election_national_results('presidential', '2021_11_14_pvr', 2) LIMIT 1) AS presidential_votes,
        (SELECT seats IS NULL FROM election_national_results('presidential', '2021_11_14_pvr', 2) LIMIT 1) AS presidential_seats_absent,
        (SELECT count(*) FROM election_national_results('presidential', '2011_10_23_pvr', 2))::text AS unreconciled`);
        expect(result.rows[0]).toMatchObject({
          parliamentary: "25",
          distinct_choices: "25",
          parliamentary_winner: "party:p_20",
          parliamentary_votes: "1444920",
          parliamentary_seats: 131,
          parliamentary_basis: "party_votes_excluding_none_of_above",
          parliamentary_none: "50733",
          parliamentary_invalid: "69222",
          presidential: "2",
          presidential_winner: "ticket:2021_11_14_pvr:6",
          presidential_votes: "1539650",
          presidential_seats_absent: true,
          unreconciled: "0",
        });
        expect(result.rows[0].source_sha256).toMatch(/^[a-f0-9]{64}$/);
      } finally {
        await client.query("ROLLBACK").catch(() => {});
        client.release();
      }
    },
  );
});
